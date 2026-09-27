# Nucleas OS: Architecture and Implementation Plan

September 27, 2026 · Supersedes nothing. Extends [NUCLEAS_AI_CONTROL_SYSTEM_PLAN.md](NUCLEAS_AI_CONTROL_SYSTEM_PLAN.md), whose governance rules (budgets, approvals, service identities, fencing, no silent escalation) remain binding.

Pilot companies: **frugalgambler.club** and **playbound.club**, our own properties, with direct access to every platform needed. No client data is used until the pilot passes its gates.

**Confirmed pilot stack (all properties):** Google Analytics 4, Google Search Console, Brevo, Stripe. Ahrefs is currently a **free account** and will move to a paid plan. The full Ahrefs capability set is built now; results stay limited until the upgrade (see §6, plan-limited handling).

## 1. The model in one paragraph

Nucleas runs the company, but it doesn't rebuild everything. Nucleas owns context, semantics, intelligence, workflow, approvals and the interface. Specialized providers (Ahrefs, Brevo, Google, Shopify, GitHub, Vercel, Stripe) keep the infrastructure and proprietary data behind their APIs. The AI reasons about **capabilities** (`seo.project.create`), never provider endpoints. A router picks the execution method: **API → machine interface (MCP/SDK/CLI) → browser → human**. Every action produces a verified **receipt**. The OS at `os.nucleas.app` builds a **workspace** for what the person is doing from stable primitives, instead of offering fixed department modules. `nucleas.app` stays as it is, on the same database and APIs, until the OS clearly beats it.

## 2. What already exists and is reused, not replaced

Findings from inspecting the repository:

| Existing piece | Where | Role in the new architecture |
|---|---|---|
| OS host routing | `src/middleware.ts` (`os.*` → `/os`, classic paths redirect to main host) | The OS stays on the same Next app, auth, APIs and DB. No new repo. |
| OS shell: window manager, module registry, palette, voice, popouts, PWA | `src/lib/os/*`, `src/components/os/*` | Becomes the **primitive runtime**. `ModuleRegistry` evolves into the primitive registry. Layout persistence is localStorage today and moves server-side for workspace definitions. |
| Organization (tenant) | `models/Organization.ts` | Stays the operator/tenant: the agency running Nucleas. |
| **Client** | `models/Client.ts` has domain, contacts, assigned team, tech/marketing/platform stacks, portal | **Becomes the Company scope** (see §4). Already the "business above projects" we need. |
| Projects with embedded tasks, stable task IDs, `clientId`, `objectiveId`/`aiPlanId` on tasks | `models/Project.ts` | Unchanged. Projects become one context container under a Company. |
| Tech / marketing / platform stacks (`techStack`, `marketingStack`, `platformStacks`) | `models/platformFields.ts`, `lib/marketingStack/catalog.ts` | **Seed data for integrations.** Each stack entry is a declaration that a company uses a provider, and it gets backfilled into `IntegrationConnection` with status `declared`. This is how legacy intelligence carries into the OS. |
| ContentItem, Meeting, Asset, Comment, Recording, calendar | models + `lib/scheduling`, `lib/google` | Canonical objects exposed to the Context Resolver and primitives. |
| AI control: objectives, immutable plans, runs, run events, budgets, reservations, dispatch locks/limits, attention view, notifications | `models/AiControl.ts`, `lib/ai/control/*` | Reused as is. Capability invocations link to `AiRun`. Approval/digest/expiry/replay patterns are generalized. |
| Service identities and scoped grants | `models/AiServiceIdentity.ts`, `lib/ai/control/serviceIdentities.ts` | Grants extend from `planning inference`/`artifact review` to capability IDs. |
| Model routing (general/coding/visual), provider catalog, pricing | `lib/ai/rolePipeline/*`, `lib/ai/pricing/*`, `packages/ai-core/gateway.ts` | Unchanged. The same "Nucleas doesn't care which provider" principle is applied to capabilities. |
| Tool loop + tool definitions (repo, web, browser_navigate, image) | `lib/ai/tools/*` | Capability tools are generated from the registry and added to this loop. |
| Execution worker (sandboxed repo edits) and Playwright research worker | `services/execution-worker`, `services/ai-runtime/browserWorker.ts`, `deploy/vps` | Execution worker becomes the `code.*` executor. The research browser stays public-only. The authenticated browser executor is a **new, separate** service (§10). |
| AES-256-GCM secret storage | `lib/ai/modelSecrets.ts`, `lib/scheduling/tokenCrypto.ts` | Consolidated into one purpose-keyed `secretBox` for provider credentials. |
| Google OAuth (calendar, drive.file) | `lib/google/*`, `lib/scheduling/googleCalendar.ts` | Extended with incremental scopes for GA4 and Search Console. |
| Brevo SDK + contact sync (Nucleas's own users) | `lib/services/brevoContactSync.ts`, `lib/services/email.ts` | Starting point for the Brevo adapter. |
| Vercel cron + Mongo lease/job pattern | `vercel.json`, `AiPlanningJob`, `dispatchLock` | Same pattern for sync jobs. Heavy or long jobs go to the VPS. |

**Gap found:** the AI's project context today is thin. `buildTeamContextSummary` (`lib/ai/teamChat.ts`) passes the project name plus objective/run counts. The Context Resolver (§8) is the biggest intelligence upgrade in this plan.

## 3. Non-negotiable rules

1. **One system, two interfaces.** The OS reads and writes the same collections as `nucleas.app`. No `ProjectV2`, no sync layer, no duplicated tasks/content/assets.
2. **Additive schemas only.** Optional fields, new collections, idempotent resumable backfills with dry-run. Legacy reads stay valid.
3. **The AI sees capabilities, not credentials or endpoints.** Secrets are injected by the executor at call time only.
4. **Deterministic code executes. The LLM plans, writes, interprets and reviews.** No model call just to hit an API.
5. **Every mutation produces a receipt and, where possible, read-after-write verification.** A `200` response isn't proof.
6. **Approval is capability policy, not ad hoc UI.** Approvals bind to an exact input digest and expire (the existing plan-approval pattern).
7. **Mongo stays the store.** No graph DB, no warehouse. Canonical data is stored, frequently used external facts are materialized, and deep provider data is fetched on demand.

## 4. Scope model: Company = Client

```
Person (User/Employee)
 └─ Organization (tenant/operator: us)
     └─ Company  ← existing Client document
         ├─ Projects (existing, via Project.clientId)
         │   └─ Objectives · Tasks · Content · Meetings · Assets · AI Runs
         ├─ IntegrationConnections · ExternalResources
         ├─ Contacts (later) · Campaigns (later)
         ├─ MetricDefinitions · MetricSnapshots · BusinessEvents
         └─ Workspaces
```

- Reuse `Client` rather than creating a parallel `Company` collection. Add optional `relationship: 'client' | 'owned' | 'internal'` (default `client`). frugalgambler.club and playbound.club become `owned` Clients. The OS labels this scope "Company"; code and the legacy UI keep "Client".
- **Confirmed (Ryan, 2026-09-27):** our own properties are the top-level `internal` Projects on `/workspace`, and they operate exactly like Clients. A Client is simply a company we work *for*.
- Conversion (Phase 1, script with dry-run): for each top-level internal property project, create an `owned` Client that copies its domain, stacks, social links, palette, logo and team, then set `project.clientId`. The project stays `projectType: 'internal'`, keeps its `_id`, and all of its tasks, content, assets, comments, AI runs and repository bindings stay put. The existing project acts as the Company's hub, the same role `client-admin` projects play for clients.
- Legacy UI impact (accepted, no code change): the legacy UI's code isn't touched, but it reads the same data. So after conversion, owned properties will also appear in its Clients calendar view, and client notifications log a harmless "no hub project" warning for them.
- Projects without `clientId` still work as they do now.
- **Tenant ID convention:** `organizationId` everywhere (User, Employee, Client) holds the organization admin's **user ID**, not `Organization._id` (see `models/User.ts`, "For MVP"). New collections follow the same convention, and any future migration to real Organization IDs happens across all collections at once.
- Every new collection carries `organizationId` + `companyId` (the Client `_id`) and resolves access through existing client/project assignment rules (`lib/clients/*`, `POLICY.md`).

## 5. Integrations: connections and external resources

**`IntegrationConnection`** (new)
```
organizationId, companyId?          // companyId null = org-wide account (e.g. our Ahrefs subscription)
provider: 'ahrefs'|'brevo'|'ga4'|'gsc'|'github'|'vercel'|'shopify'|...
status: 'declared'|'connected'|'needs_reauth'|'error'|'disabled'
authKind: 'api_key'|'oauth'|'browser_session'|'none'
secretRef                            // secretBox ciphertext id, never returned to clients
grantedByUserId, scopes[], lastVerifiedAt, lastError
source: 'stack_backfill'|'manual'|'onboarding'
```
Resolution order when a capability needs a provider: company connection, then org-wide connection, then a `needs connection` human step.

**`ExternalResource`** (new): maps canonical objects to provider objects.
```
organizationId, companyId, provider, resourceType ('project','property','site','list','repo',...)
externalId, externalUrl?, canonicalType, canonicalId, metadata, lastSyncedAt
unique: (organizationId, provider, resourceType, externalId)
```
Examples: `playbound.club Company ↔ Ahrefs project 1234`, `↔ GA4 property 5678`, `↔ GSC sc-domain:playbound.club`, `↔ Brevo list 9`, `↔ GitHub repo` (existing `AiProjectRepository` rows are mirrored, not moved).

**Legacy backfill:** for each Client/Project `marketingStack`/`techStack`/`platformStacks` entry whose `toolId` has an adapter, create a `declared` connection (idempotent on org+company+provider). The OS then shows "Brevo: declared, not connected. Connect?" and nothing the team recorded is lost.

## 6. Capability kernel

New package **`packages/capabilities`**, following the `ai-contracts` convention (zod, versioned, no server imports):

```ts
CapabilityDefinition {
  id: 'seo.project.create'; domain: 'seo'; version: 1
  input: ZodSchema; output: ZodSchema
  kind: 'read'|'write'
  risk: 'read'|'low_write'|'reversible_write'|'communication'|'spend'|'production'|'destructive'|'security'
  approval: 'auto'|'policy'|'required'
  idempotency: 'natural_key'|'operation_id'|'none'
  verify?: 'read_back'|'none'
  executors: ExecutorBinding[]      // ordered by preference
}
ExecutorBinding { provider: 'ahrefs'; method: 'api'|'mcp'|'browser'|'human'; adapter: string }
```

Server-side runtime in **`src/lib/capabilities/`**:

```
invoke(capabilityId, input, ctx)
  → validate input (zod)
  → authorize (user/service grant + company access)
  → policy (risk × company policy → auto | needs approval)
  → idempotency check (natural key / ExternalResource lookup)
  → budget (AI + provider units, e.g. Ahrefs API units)
  → route to executor (first available binding with a live connection)
  → execute (adapter gets the secret from secretBox, not from ctx)
  → verify (read-back compare)
  → write CapabilityInvocation receipt + ExternalResource + BusinessEvent
```

Provider adapters live in **`src/lib/integrations/<provider>/`** and implement domain interfaces (`SeoProvider`, `AnalyticsProvider`, `SearchConsoleProvider`, `EmailProvider`, `CodeHostProvider`, `HostingProvider`). Adapters are plain typed code with fixture-based tests. Nothing in them calls a model.

**`CapabilityInvocation`** (receipt, new collection): requester (user or AI run + service identity), company, capability+version, input digest, redacted input, executor used and why, provider resource IDs, status (`pending_approval|running|succeeded|verified|failed|ambiguous|cancelled`), verification result, cost (AI micros + provider units), timestamps, `aiRunId?`, `approvalId?`. Ambiguous timeouts on non-idempotent writes are **reconciled, never blindly retried** (existing plan rule).

**`CapabilityApproval`** generalizes the plan-approval mechanics already in `lib/ai/control/plans.ts`: bound to capability + input digest + company, expiry, approver authority rechecked at execution, single consumption, and the agent can't approve itself. It surfaces in the existing attention view and digests (`lib/ai/control/attention.ts`, `notifications.ts`).

Default policy (adjustable per company later):

| Risk | Example | Default |
|---|---|---|
| read | Read rankings, traffic, contacts count | auto |
| low_write | Create Ahrefs project, add tracked keywords | auto |
| reversible_write | Pause campaign, update metadata draft | policy (auto for owned companies) |
| communication | Send email to a list | required |
| spend | Change ad budget | required |
| production | Deploy site, merge PR | required (existing GitHub publish gate) |
| destructive / security | Delete contacts, change DNS | required, and not offered to AI in V1 |

**Plan-limited providers:** adapters report `plan_limited` (the capability exists but the current provider plan doesn't allow it or returns truncated data) separately from `failed`. Receipts and metric tiles show "limited by Ahrefs plan" instead of zeros, and capabilities light up automatically when the connection's plan changes. No code change is needed at upgrade time, only a re-verify of the connection.

**Stripe is per company, not Nucleas billing.** Nucleas's own subscription billing (`billing-engine`, existing `/api/webhooks` Stripe route, platform `STRIPE_*` env) stays completely separate. Each company connects its own Stripe account with a **restricted, read-only key** stored in secretBox, and has its own webhook endpoint and signing secret. The two must never share keys or handlers.

**AI surface:** tool definitions are generated from the registry (`capability_invoke` with a per-company allowlisted enum, or one tool per enabled capability when the count is small) and added to the existing `runIdeToolLoop`. The model sees `seo.keywords.read({ companyId })`, never `/v3/...`.

## 7. Events, metrics and the semantic layer

**`BusinessEvent`** (new, append-only): `organizationId, companyId, type ('lead.created','email.clicked','seo.keyword.moved','deployment.completed',...), occurredAt, source provider, externalId, rawRef, attributes`. Unique on `(source, externalId, type)` so replayed webhooks or re-syncs don't duplicate.

**Person lifecycle (confirmed by Ryan, 2026-09-27), the same for owned properties and clients:**

| Stage | Definition | Primary source |
|---|---|---|
| Visitor | Anonymous site traffic, not yet a person record | GA4 (aggregate only) |
| Lead | Gave us contact information (form, email capture) | Brevo contact / form event |
| User | Signed up on the platform but not paying (e.g. Tailnote free plan) | The platform's own signup event (first-party webhook) |
| Customer | Purchased a product | Any connected commerce/payment source: a paid order (Shopify, WooCommerce, future Nucleas-built stores) or a one-time payment (Stripe) |
| Subscriber | Currently paying on a recurring plan | Any connected subscription source (Stripe Billing today; Shopify subscription apps, Paddle, etc. via adapters) |

Stages are **states, not a strict ladder**. One person can be Customer and Subscriber at once, and a cancelled Subscriber drops back to User (with a `former_subscriber` flag for churn metrics). Each company declares which stages apply: product businesses use Lead → Customer, and platforms use Lead → User → Subscriber. A thin Nucleas `Contact` holds the person's current stages and their provider IDs (Brevo, Stripe, platform user ID). Stages are derived from normalized events (`order.paid`, `payment.succeeded`, `subscription.activated/cancelled`) emitted by `CommerceProvider`/`PaymentsProvider` adapters, never from a provider name, so adding Shopify to a client or ecommerce to an owned property is just connecting another source. When one purchase shows up in two sources (e.g. a store order also seen as a processor charge), the commerce order is authoritative and the charge is linked to it by order/payment reference, so it's never counted twice. Stripe can't see free signups, so **User requires each platform to send a signup event to Nucleas** (`/api/webhooks/company-events/<companyId>`, signed per company).

**`MetricDefinition`** (new): `key, name, companyId|null (null = template), unit, aggregation, sourceBindings[] (capability + field, or event type + filter), attributionDims[]`. Templates ship for the pilot: `sessions`, `organic_clicks`, `organic_impressions`, `avg_position`, `tracked_keywords_top10`, `referring_domains`, `new_subscribers`, `email_open_rate`, `revenue`, `new_customers`, `mrr`, `refunds`, `deployments`.

**`MetricSnapshot`** (new, materialized): `companyId, metricKey, grain ('day'), date, value, breakdown{}, sourceInvocationIds[]`. Every number keeps provenance down to the receipts that produced it, which gives the "5 new leads → 2 organic, 1 direct…" drill-down.

**Sync:** `SyncJob` collection using the proven lease pattern (`AiPlanningJob`/`dispatchLock`). A Vercel cron (`/api/cron/integration-sync`) claims bounded batches. Long or heavy pulls run on the VPS worker. Webhooks land at `/api/webhooks/<provider>` (middleware already exempts that prefix) with signature verification.

**Data tiers:** *canonical* (Company, Project, Task, Content, Campaign, MetricDefinition, Workspace) is stored. *Materialized* (daily metrics, keyword positions for tracked terms, contact counts) is synced. *Remote* (every backlink, every GA event, every GSC row) is fetched on demand through read capabilities and cached briefly.

## 8. Context Resolver

`src/lib/context/resolveContext.ts`:

```ts
resolveContext({ organizationId, userId, scope: {company?, project?, objective?, task?}, intent, budgetChars })
  → { sections: ContextSection[], sources: SourceRef[], omitted: string[] }
```

- Pulls from existing collections (projects/tasks/objectives/plans/runs/content/meetings/assets/decisions), new ones (connections, metrics, recent invocations, pending approvals, recent events) and the available capabilities for that company.
- Intent-shaped retrieval: a keyword/domain classifier (deterministic first, LLM only if ambiguous) picks sections. "Why did traffic drop" gets metrics + deployments + content + SEO events. "Finish checkout work" gets repo + task + plan + prior runs.
- Hard character budget with the existing `budgetContextMessages` behavior. Records `sources` and `omitted` (extends the `included[]` list `TeamContextSummary` already returns, so the UI can show what the AI knew).
- Retrieved content is untrusted input, not instructions (existing rule). No cross-company leakage: scope comes from authorization, not from the prompt.
- Adopted first by OS AI chat, then `teamChat`/`companyChat` replace `buildTeamContextSummary`'s thin summary.

**`ContextEdge`** (optional, only when needed): `from/relation/to` for cross-domain links that ordinary refs don't express (Content SUPPORTS SeoTopic, Deployment CHANGED Website). Don't build it until a concrete query needs it.

## 9. OS experience: primitives, workspaces, compiler

**Shell (stable):** Home · Work · Inbox · AI · Search, plus a Company switcher. The existing floating windows, palette, voice and popouts stay.

**Primitives (tested components, not pages):** MetricTile, MetricChart, Table/EntityList, Feed (events/activity), Timeline, Calendar, Board, Approvals, Receipts, Conversation (AI), Campaign/Sequence, Document, Assets, Browser, IDE (existing), Research. Each primitive declares what **data source** types it accepts.

**Data sources (typed and allowlisted, never arbitrary queries):** `metric:<key>`, `metricBreakdown:<key>`, `tasks:{filter}`, `approvals:pending`, `invocations:recent`, `events:{types}`, `content:{filter}`, `projects:{company}`, `connections:{company}`. Each resolves through existing authorized APIs.

**`OsWorkspace`** (new, server-side): `organizationId, userId|null (shared), scope {company|project|objective|personal}, name, definition (zod: sections → views → {primitive, dataSource, options}), revision, createdBy ('user'|'ai'), history`. Window geometry stays client-side (existing `persistence.ts`). The *definition* moves server-side so it follows the user and the AI can edit it.

**Workspace Compiler:** an LLM call that outputs a `WorkspaceDefinition` (zod-validated against the primitive + data-source registry), shows a diff and applies it on accept. It handles "Put SEO above paid", "Show revenue next to ad spend" and "Drop social". It generates configuration, not code. Generated mini-apps (sandboxed) are a much later exception.

**Home (per company or across companies):** Today (metric tiles), What changed (metric deltas + notable events, deterministic thresholds first and LLM phrasing second), Needs attention (approvals, failed/ambiguous invocations, `needs_reauth` connections, existing AI attention items), Work in progress (active objectives/runs/tasks).

## 10. Execution tiers

1. **API:** the default. Pilot adapters are Ahrefs v3, GA4 Data API, Search Console API, Brevo v3, GitHub (existing app client), Vercel.
2. **Machine interface (MCP/SDK/CLI):** an executor type that calls a configured MCP server server-side, with the same receipts. Useful for fast breadth. Adapter code still owns input and output mapping.
3. **Authenticated browser:** a **new** `services/browser-executor` on the VPS, separate from the public research `browserWorker`. It uses one isolated profile per connection, with Playwright `storageState` encrypted by secretBox and never shown to a model. Each capability is a **coded workflow** (versioned script with selectors plus a screenshot/DOM verification step) rather than free-form computer use. There's a per-workflow domain allowlist and a full action log with screenshots on the receipt. Free-form agentic browsing for writes comes later and only behind approval.
4. **Human:** MFA, CAPTCHA, OAuth consent, legal/financial steps, or an unrecognized page. The invocation pauses as `needs_human` with a one-step instruction in Inbox, then resumes. The browser executor never solves CAPTCHAs.

## 11. Phased delivery (pilot: frugalgambler.club + playbound.club)

Each phase ships behind a flag (existing `AiSettings` pattern), leaves `nucleas.app` untouched and ends with an exit gate.

### Phase 0: Inventory and guardrails
- Commit the repo rename. Record this plan and an ADR listing the canonical objects and the "no parallel representations" rule.
- **Inventory the pilot** (read-only DB + account check): how FG/PB exist today (Client? Projects? `clientId`?), their stack entries, repos, and which accounts we hold: Ahrefs plan **API access and unit allowance**, GA4 property IDs, GSC properties, Brevo account/lists, hosting (Vercel?), monetization source (affiliate networks? ads?), and whether signups exist.
- Regression tests around Client↔Project↔Task↔Content↔Asset relationships that the OS work must not break.
- **Exit:** a written pilot inventory and agreed V1 metrics per property.

### Phase 1: Company scope and connections
- `Client.relationship`. Create or attach `owned` Companies for FG/PB. `IntegrationConnection`, `ExternalResource`, `secretBox` (consolidates the two AES helpers with purpose-derived keys; existing ciphertexts stay readable).
- Stack → `declared` connection backfill script (dry-run, idempotent, report).
- Connect flows: API-key entry (Ahrefs, Brevo, Vercel), Google incremental OAuth for `analytics.readonly` + `webmasters.readonly` (testing mode is fine for our own accounts; a public client rollout needs Google app verification, so plan for it before client onboarding).
- OS: Company switcher + Company overview (projects from the legacy data, connections with status).
- **Exit:** both companies show their existing projects/tasks/content in the OS and have live verified connections. The legacy UI is unchanged (regression suite green).

### Phase 2: Capability kernel and first real actions
- `packages/capabilities`, runtime, `CapabilityInvocation`, `CapabilityApproval`, policy table, API executor, read-back verification, receipts UI (Activity primitive).
- First capabilities: `seo.project.create/get`, `seo.overview.read`, `seo.keywords.read`, `seo.backlinks.read` (Ahrefs); `search.performance.read` (GSC); `analytics.traffic.read` (GA4); `email.lists.read`, `email.contacts.count` (Brevo); `payments.charges.read`, `payments.customers.read`, `payments.subscriptions.read` (Stripe, read-only); `code.repository.inspect` (wraps existing repo tools).
- **Exit:** "Set up playbound.club in Ahrefs" run from the OS creates, or detects the existing, project **once**, verifies by read-back and shows a receipt with Ahrefs units used. Repeating it is a no-op. A revoked key produces `needs_reauth`, not a crash.

### Phase 3: Metrics and Today
- `BusinessEvent`, `MetricDefinition` templates, `MetricSnapshot`, `SyncJob` + cron, 90-day backfill for the pilot.
- Stripe webhooks (`charge.succeeded`, `customer.created`, subscription events) per company produce BusinessEvents, so revenue is near real time rather than only daily.
- **Exit:** both companies show accurate daily sessions, organic clicks/impressions, new subscribers, revenue, new customers and MRR, plus tracked keyword positions and referring domains as far as the Ahrefs plan allows (shown as plan-limited otherwise). Every tile drills down to provenance, and numbers reconcile with the provider UIs within stated tolerance.

### Phase 4: Context Resolver and capability-aware AI
- `resolveContext`, OS AI conversation scoped to a company, capability tools in the tool loop, planner output as capability calls executed deterministically. `teamChat`/`companyChat` adopt the resolver.
- **Exit:** "How is SEO doing for frugalgambler.club and what should we do?" answers from real metrics with cited sources. "Do what you can" produces auto-approved reads/low writes plus approval requests for everything else, all with receipts. No cross-company data appears in context (tested).

### Phase 5: Workspaces and Home
- Primitive registry (evolved `ModuleRegistry`), data-source registry, `OsWorkspace`, Workspace Compiler, Home briefing.
- **Exit:** each pilot company has an AI-composed workspace that the user reshapes conversationally without a deploy. Home shows Today / What changed / Needs attention / Work in progress. Idle-browser budgets from the AI control plan (§11 there) still hold.

### Phase 6: Native campaigns on Brevo
- Nucleas-native `Contact` (thin, with provider IDs), `Campaign`/`Sequence` (objective, audience, trigger, steps, exit conditions, goal). `EmailProvider` Brevo adapter: lists/contacts/templates/automation or scheduled sends, plus the engagement webhook producing BusinessEvents.
- **Exit:** a welcome/warm-up sequence for FG or PB signups is drafted by the AI, edited conversationally, **approved**, launched through Brevo, and its opens/clicks/conversions appear in Nucleas metrics.

### Phase 7: Browser and human tiers
- `services/browser-executor`, session vault, first coded workflow for a real API gap found in Phases 2–6 (candidate: an Ahrefs Site Audit crawl setting not exposed by the API), and the `needs_human` resume flow.
- **Exit:** one capability transparently falls back API → browser, verifies by screenshot/DOM read-back, and an MFA prompt pauses the invocation for a human and resumes it.

### Phase 8: Onboarding and promotion
- "Onboard <company>" composite: create Company, declare needs, connect, set up providers, pull baselines, propose objectives and workspace, and list what needs a human. Then decide on OS-as-default, with `nucleas.app` kept as legacy. The local agent (then Tauri desktop) comes only when a concrete need crosses the browser boundary.
- **Exit:** a third owned property is onboarded end to end mostly by Nucleas. Only after that do we onboard a paying client.

## 12. Risks and open questions

- **Ahrefs is on a free plan today.** API access and units depend on the paid tier chosen. Build and test adapters against recorded fixtures, then verify live once upgraded. Management endpoints are reportedly unit-free, but verify that.
- **Google scopes:** `analytics.readonly`/`webmasters.readonly` need Google app verification before external users. Fine for our own accounts in testing mode.
- **Vercel limits:** cron frequency and function duration. Heavy sync moves to the VPS worker early rather than fighting timeouts.
- **Baseline debt:** the full ESLint baseline and the middleware-convention deprecation are still open (see status doc). New code must pass targeted lint. No broad cleanup rewrite.
- **Scope creep:** no CRM, ESP, analytics engine or crawler gets built. If a phase starts rebuilding provider infrastructure, stop.

**Decisions needed from Ryan before Phase 1:**
1. Confirm **Company = existing Client** (with `relationship: owned`) instead of a new collection.
2. ~~Pilot stack~~ Answered: GA4, Search Console, Brevo and Stripe on all properties; Ahrefs free, upgrading. Lifecycle stages defined in §7.
