# Website connectors: staged foundation

This release adds an opt-in website adapter to the existing IntegrationConnection,
IntegrationSecret and capability runtime. It does not migrate current publishing,
FG admin jobs or existing roundup drafts. It creates no new job or approval system.

## Rollout and rollback

- `NUCLEAS_CONNECTOR_ROUNDUPS_ENABLED` must equal `true` to select the new transport.
  Unset/false keeps existing behavior. The production release leaves it off.
- Each company's saved website connection also needs `enabled: true`, a successful
  read-only test at its current revision and explicit read/publish permissions.
- Company -> Connections and setup -> Website publishing connection saves and tests
  credentials. The activation action is hidden until the global gate is on.
- Prepare/test never creates a remote post or draft. Credentials are encrypted in
  IntegrationSecret; existing environment keys remain available to legacy jobs.
- A new roundup pins legacy or connector transport before collecting sources.
  Absence of a binding on older records means legacy forever.
- The binding freezes connection ID, operational revision and origin. Changing a
  destination, mappings or credentials while a connector draft exists is refused.
  Pause/resume of an unchanged connection preserves the operational revision.
- Turning the global gate off leaves legacy work available, and blocks connector
  drafts instead of redirecting them to another transport. Re-enable the same
  connection to reconcile them. Do not remove or rotate an uncertain publication's
  connection. Finish reconciliation before migration/rollback of that draft.
- No automatic transport fallback follows an external write attempt. Both the
  workflow snapshot and capability invocation retain stable idempotency keys.

## Adapters in this release

`playbound-roundup-v0` wraps the already deployed signed roundup endpoint. It uses
the endpoint's existing durable post/content/window receipt. Its read protocol
does not support lookup by idempotency key; retrying the unchanged POST is the
safe reconciliation mechanism because the site already enforces idempotency.

`website-v1` is the reusable contract below. Declarative source-field mappings
allow different collection and field names without changing the workflow.
Mappings select direct property names only: no expressions, executable code,
prototype properties or nested evaluation. New website implementations must pass
the adapter contract tests before live publication is enabled.

No WordPress connector, arbitrary-record writer, reporting adapter, remote plugin
execution or manifest-based automatic provisioning is included in this slice.

## Website v1 wire protocol

One configured endpoint path on the approved company HTTPS origin serves three
operations. The default is `/api/nucleas/v1`. Redirects and private addresses are
refused; the production request pins validated DNS while preserving TLS SNI.

Requests use `x-nucleas-timestamp` (Unix seconds) and `x-nucleas-signature` (hex
HMAC-SHA256). Sign this exact string using the connection signing key:

```
timestamp.METHOD.pathname-and-query.raw-request-body
```

The query's actual serialized order/escaping is part of the signature. GET has an
empty raw body. The website must validate the signature with a constant-time
comparison and reject stale timestamps (five-minute window recommended). The
PlayBound compatibility endpoint already implements those checks.

### Read published content

GET `?op=content.items.list&collection=games&since=<ISO>&until=<ISO>&cursor=<optional>`

Return `{version:1, items, nextCursor?, baseline?, warnings:[]}`. Each normalized
item has `id`, `kind`, `title`, `url`, `publishedAt` (ISO or null),
`publicationBasis` (`first_published`, `latest_published`, `observed`, `unknown`),
optional `description`, and `fields` (structured additional facts).

IDs are stable external strings, not MongoDB-specific. Canonical item URLs must
belong to the configured origin. A sitemap observation or modified date is not
first publication. Roundups omit items with unknown/observed publication dates
and expose that limitation in their source details.

`baseline` contains `publishedAt`, `coverageEnd` (nullable), `coveredIds`, and
optional `slug`/`url`. CoverageEnd takes priority over the date an article was
published, preserving changes shipped while a draft awaited approval. Pages must
share a stable baseline and coverage window. Cursor cycles, duplicate IDs and
incomplete results beyond five pages/2,000 items stop generation without
advancing coverage. The read transport and receipt sizes are bounded at 2 MB.

### Publish the approved post

POST `?op=content.posts.publish` with JSON:

```
{idempotencyKey, title, summary, bodyMarkdown,
 coverageStart, coverageEnd, coveredIds}
```

Return `{version:1, idempotencyKey, externalId, url, status:'published'}` and
optionally `payloadHash` (SHA256 of the parsed input JSON with recursively sorted
object keys and preserved array order). A supplied hash is checked against the
requested content. A receipt must identify the same key and authorized
origin. The site must persist the key atomically with the publication, return the
same resource for identical retries and reject reuse of the key for different
content. Do not acknowledge a merely queued or unpublished draft as published.

The existing runtime binds the key to the exact company, connection revision,
capability and input digest. Publication normally requires approval. The roundup
bridge reuses its existing manager-reviewed frozen snapshot instead of asking
for a second identical approval.

### Check publication

GET `?op=content.posts.read&idempotencyKey=<key>` returns the same published receipt,
or `{version:1, status:'missing', idempotencyKey}`. Missing is a provider assertion,
not a reason for Nucleas to allocate a new key. Unknown/failed calls retain an
uncertain receipt. Only adapters that implement the required idempotency contract
may repeat the exact POST.

## Verification

Run `npx vitest run src/lib/connectors src/lib/capabilities src/lib/roundups`.
The fixtures test two websites, distinct collections/property mappings, pinned
origins, permissions, signatures, read-only setup, company isolation, publication
retry/concurrency, immutable binding and flag-off legacy behavior. No AI calls or
live publication are needed. Keep existing integration/publishing/job tests green
before enabling a company. Use a test site to prove actual provider idempotency
before enabling production writes on a newly implemented adapter.
