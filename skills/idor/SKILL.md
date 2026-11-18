---
name: idor
description: Enumerate and exploit Insecure Direct Object Reference (IDOR) and broken access control flaws using two-account harness testing, identifier enumeration, JWT sub-claim manipulation, mass assignment, and authorization bypass verification across web, API, GraphQL, mobile, and gRPC surfaces.
---

# IDOR & Broken Access Control

Insecure Direct Object Reference and its superset, Broken Access Control (OWASP Top 10 #1), arise when the server trusts a client-supplied identifier without verifying that the authenticated principal is *authorized* for that object. This skill covers the full lifecycle: identifier discovery and classification, systematic authorization testing, identifier manipulation deep dives, advanced chaining vectors, API-specific abuse, and evidence-grade reporting.

## When to use this skill

- Web or API application testing where objects (accounts, documents, invoices, orders, messages) are addressed by client-controlled identifiers.
- Any endpoint accepting `id`, `user`, `account`, `org`, `token`, GUID, hash, or base64 reference in URL, body, header, or cookie.
- Multi-tenant SaaS reviews where workspace/org isolation is the core trust boundary.
- GraphQL, batch, export, webhook, websocket, mobile-only, and gRPC endpoint assessments.
- Regression testing authorization fixes delivered by engineering, or post-breach triage where unauthorized data exposure is suspected.

## Methodology

### 1. Identifier Discovery & Classification

Enumerate every parameter that addresses an object and classify its format before testing:

| ID type | Example | Notes |
|---|---|---|
| Sequential integer | `/api/invoices/1042` | Trivially enumerable; test ranges |
| UUIDv1 | `52fdfc07-2182-...` | Leaks MAC + timestamp; predictable |
| UUIDv4 | random 122 bits | Unguessable; test for leakage elsewhere |
| Hex-encoded int | `a412` (=42002) | Decode and re-encode |
| Base64-encoded int | `MTA0Mg==` | `echo MTA0Mg== \| base64 -d` → `1042` |
| Hash (MD5/SHA1 of int) | `0d4406d2...` | Precompute rainbow of ints 1–10⁶ |
| Hashids / short-id | `B6tY4qz` | Salt brute-force from JS bundles/repos |
| Username-as-ID | `/api/users/alice/settings` | Swap usernames; test case/unicode confusables |

Quick crypto-reversal snippet for hashed integers:

```bash
for i in $(seq 1 1000000); do echo -n "$i" | md5sum | cut -d' ' -f1 | sed "s/^/$i /"; done > md5_ints.txt
grep -i "^0d4406d2\|^$(md5 -s 1042 | awk '{print $1}' | cut -c1-8)" md5_ints.txt
```

Decode UUIDv1 to extract the embedded timestamp and MAC address — the timestamp predicts neighboring IDs and the MAC reveals internal host inventory:

```python
import uuid, datetime
def decode_uuid1(value):
    u = uuid.UUID(value)
    if u.version != 1:
        return {"version": u.version, "note": "not time-based"}
    ts = (u.time - 0x01B21DD213814000) / 1e7
    return {
        "created": datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).isoformat(),
        "mac": ':'.join(f'{b:02x}' for b in u.node.to_bytes(6, 'big')) if u.node else "random",
        "clock_seq": u.clock_seq,
    }
print(decode_uuid1("52fdfc07-2182-11ea-978f-2e728ce88125"))
```

Decode Hashids by harvesting the salt from public JavaScript bundles, mobile APK strings, or open-source SDKs, then re-encode candidate integers locally to map public handles back to internal IDs.

### 2. Two-Account Harness Setup

Set up the harness before any testing — never test IDOR against third-party accounts, only owned ones:

- **Account A** = attacker session (low-privilege or normal user).
- **Account B** = victim session (own second account; different org/workspace for tenant tests).
- **Account C** = admin session (replay admin-only requests with A's session to baseline the 200-response shape).

### 3. Systematic Authorization Testing

Intercept-and-replace identifiers in every parameter position, one at a time, holding all other credentials constant:

| Position swapped | Detects |
|---|---|
| Cookie (`session=B`) | Session-bound check missing entirely |
| Header (`Authorization: Bearer B`) | Token-based check missing while cookie check exists |
| Header (`X-User-Id: B`) | Server trusting client-asserted identity headers |
| Body (`user_id` = B, session = A) | Server trusting client-asserted identity |
| Path (`/api/invoices/1041` with A's session) | Classic IDOR — the real test |
| JWT `sub` claim rewritten to B | Signature verification or claim-trust failure |

Run the HTTP method matrix on the same object — authorization is frequently implemented on GET only:

```text
GET    /api/v2/invoices/1042   -> 200 (A's own)
GET    /api/v2/invoices/1041   -> 403 (B's)  [checked]
POST   /api/v2/invoices/1041   -> 200  [NOT checked]
PUT    /api/v2/invoices/1041   -> 200  [NOT checked]
PATCH  /api/v2/invoices/1041   -> 200  [NOT checked]
DELETE /api/v2/invoices/1041   -> 204  [NOT checked]
```

Apply negative testing: send nonexistent IDs (`999999999`), zero/negative (`-1`, `0`), type juggling (`1042.0`, `0x412`, `"1042"`), and oversized values — 200 vs 404/403 differentials reveal whether the check runs *before or after* lookup. Distinguish horizontal (same privilege, different object) from vertical (different privilege, e.g. A reaches admin functions) access; test both separately since one can pass while the other fails.

### 4. JWT Payload Manipulation

Manipulate the `sub`, `uid`, `role`, and `tenant` claims directly. Test `alg: none` first, then key-confusion attacks:

```python
import base64, json
def b64(d):
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=")
header = b64({"alg": "none", "typ": "JWT"})
payload = b64({"sub": "1042", "role": "user", "tenant": "org_B"})
print(f"{header.decode()}.{payload.decode()}.")
```

For key confusion, sign the token with the *public* RSA key as an HMAC secret (`alg: HS256` against RS256-verifying servers), or with a symmetric secret brute-forced from a weak wordlist using `hashcat -m 16500`. Replay each forged token against the object endpoints from §3.

### 5. Mass Assignment Escalation

Add privileged fields to profile and bulk-update requests and observe whether the binder accepts them:

```text
PATCH /api/v2/users/1042
{"email":"a@x.com","role":"admin","is_admin":true,"tenant":"other","account_id":1042}
```

Also test nested objects, parameter-pollution duplicates (`role=admin&role=user`), and JSON/XML body variants of the same endpoint. A successful mass assignment yields persistent unauthorized membership or privilege elevation, not just a read.

### 6. Response Diffing & Timing Side-Channels

Interpret status-code semantics carefully: a 404 with a response length matching the valid-object 404 means the ID exists but is filtered; a 404 with a *different* length than the nonexistent-ID baseline means the object was found and then denied. A 403 on B's object but 200 on A's confirms the check exists; a 200 on both confirms IDOR. Measure validation timing: endpoints that perform a lookup before authorization respond measurably slower for valid foreign IDs than for garbage IDs — a timing side-channel that enumerates valid IDs even when responses are uniform.

### 7. Batch, GraphQL & Bulk Export Abuse

- **Batch endpoints:** `GET /api/v2/documents?ids=101,102,103,104` mixing A-owned (101–102) with B-owned (103–104) IDs. Even if per-document authz fails silently, the mixed response reveals which foreign IDs exist (200 vs 404 differential) and sometimes returns them wholesale.
- **GraphQL:** check field-level authorization (`query { user(id:1042) { email ssnHash } }`), introspection-enabled hidden mutations, and alias batching of foreign IDs in one request (`a1: order(id:"1") a2: order(id:"2") ... a500:`). Truncate opaque node IDs (base64 `User:1042` → `User:1041`) and test whether data-loaders bypass per-field checks.
- **Bulk export:** `GET /export/all?workspace=42`, presigned URLs (`/files/<sig>` — is the signature bound to the user? replayable after revocation?), and CSV/PDF exports containing foreign rows when filters are tampered with.

### 8. Advanced Cross-Tenant Vectors

- **Sharing/permission matrices:** share an item with read-only grant, then attempt write/reshare/delete as the grantee; verify grant revocation actually revokes (a token for a revoked share still valid?).
- **Webhooks:** register a webhook on A's account pointing at A's listener; trigger events in B's org and inspect payloads for cross-tenant PII, tokens, and internal object IDs.
- **Object storage direct:** verify S3/GCS keys are not guessable per tenant (`s3://prod-uploads/<org_id>/...`), test presigned URL expiry/revocation, and confirm CDN caches do not serve other tenants' files on collision.
- **Information-leakage chaining:** combine IDOR with any leakage of email/PII/password-hash fields (`GET /api/users/1042` returning `password_hash`) to upgrade a read into account takeover via the reset-password flow.

### 9. API Version Diffing & Automation

Diff the same request across API versions — v1 frequently predates the authorization fix (`/api/v1/invoices/1041` → 200 while `/api/v2/invoices/1041` → 403). Automate the two-session comparison with the Autorize or Arachi Burp extension: register A's low-privilege cookie as the "unauthorized session," browse as B, and review every request flagged where the replayed low-privilege response matches the privileged response. Configure Burp Match & Replace to swap A's session cookie/token for B's on the fly for rapid manual sweeps.

### 10. Non-HTTP IDOR

- **Websockets:** replay `{"action":"get_invoice","id":1041}` frames with A's socket session; server-side authz is often absent on the message bus.
- **Mobile API endpoints:** extract hardcoded API routes from the APK/IPA (`apktool d`, class-dump) and test undocumented object endpoints that skip the web-tier checks.
- **gRPC:** decode `.proto` descriptors via reflection or extracted proto files, then replay `GetObject(id=1041)` with A's metadata credentials using `grpcurl`.

### 11. Impact Framing

- **Privacy breach severity:** enumerate the accessible population (e.g., "IDs 1–10⁶ reachable, 312,844 valid objects incl. names, emails, partial card data"). Rate by data sensitivity and scale (CRITICAL for PII/credentials, HIGH for business records).
- **XSS chaining:** stored XSS in a shared object viewed by other users harvests those users' data via the same IDOR-blind API — combine findings to demonstrate cross-account reads with a single payload.
- **GDPR/classification:** unauthorized cross-account reads of personal data constitute a personal-data breach (Art. 4(1), Art. 33 notification duty); cross-tenant access in SaaS may be contractually reportable regardless of fix time.

## Tooling

- **Burp Suite + Autorize/Arachi** — automated two-session replay comparison flagging every endpoint where a low-privilege session receives privileged responses.
- **Burp Match & Replace** — transparent session/ID swapping during manual proxy sweeps.
- **ffuf / Burp Intruder** — ranged identifier enumeration with status-code and length diffing.
- **Python (requests, uuid, hashids)** — custom harness scripts for UUIDv1 decoding, Hashid salt brute-force, and JWT forgery.
- **jwt_tool / hashcat -m 16500** — JWT claim manipulation, `alg:none` forgery, and secret cracking.
- **grpcurl / apktool** — non-HTTP surface testing for gRPC and mobile API endpoints.
- **GraphQL Voyager / Clairvoyance** — schema reconstruction for hidden mutations and field-level authz testing.

## Verification & Deliverables

1. **PoC:** For each finding, a minimal unauthorized request/response pair: full `curl` with A's session reading/mutating B's object, HTTP status pair (victim 200 vs baseline 403), and a diff showing the changed state (`Before:` / `After:` for mutations). Include the enumeration range proof and the Autorize flag table.
2. **Impact:** Privilege class (horizontal/vertical), object count reachable, data fields exposed, chainability (XSS/race/takeover), GDPR/contractual breach classification, and exploitability cost (trivial: ID swap in browser; moderate: hash-crack; high: race timing).
3. **Remediation:**
   - Enforce **server-side per-request object-level authorization** — every handler resolves the object then checks `object.owner|tenant == principal` (deny by default); never rely on client-side hiding, UI omission, or UUID obscurity.
   - Use **opaque/indirect reference maps** (session-scoped random handles → internal ID server-side) where direct IDs are unnecessary; rotate to UUIDv4 plus rate-limiting and anomaly detection on enumeration patterns.
   - Centralize policy in **RBAC/ABAC** (e.g., OPA/Casbin) evaluated in one layer, not per-endpoint ad-hoc `if` checks; audit-log all cross-tenant access attempts (granted and denied) with principal, object, and decision; ship a **regression test suite per endpoint × role** as CI gates.

**Deliverables**

- Findings table: endpoint, identifier position, privilege class, objects reachable, data fields exposed, severity.
- PoC scripts: two-account harness automation, UUIDv1/Hashid decoders, JWT forgery, and batch-enumeration scripts.
- Remediation matrix: endpoint × role authorization coverage mapped to implemented controls and CI regression tests.
