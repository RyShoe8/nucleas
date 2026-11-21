# Nucleas workflow redesign proposal

Status: proposed for review. November 20, 2026. No product changes or migrations are included in this proposal.

## Recommendation

Make employees accountable for outcomes, with concrete work underneath. Give users four primary destinations: Office, Companies, Work, and Inbox. Keep Ask and Tools available everywhere. Preserve the current office scene, layouts, characters, interactions, and organization-wide state.

Replace “create a job” with **Give work**. The same flow supports **One-off**, **Repeating**, and **Ongoing**. An ongoing responsibility is an agreement about scope, standards, authority, and resources. It produces a bounded queue of work; it is not an instruction for a model to keep thinking indefinitely.

Keep the existing execution machinery, canonical company records, approved knowledge, job histories, schedules, review decisions, model routing, and integrations. Change how people understand and operate them. “Job” can remain an internal implementation term without being the organizing concept in the interface.

## What the audit found

The module registry currently contains 23 modules, eight of which appear in the launcher. The architecture contains substantially more capability than the navigation communicates.

1. **The same work has several entrances and presentations.** Team, Review & work, Company → Team, Growth → Marketing, Content responsibilities, and hidden All responsibilities expose overlapping work. Company scope is selected repeatedly. The user must remember where an item was created to know where to edit it.
2. **A review can mean several different decisions.** Approving a plan, accepting a sample, saving an artifact, approving a draft for publication, and completing a delivery are legitimate separate events. Generic Accept/Approve labels obscure the consequences. Job, run, build, artifact, and delivery states also have distinct meanings.
3. **People and automation are only partly connected.** Company members already have names, specialties, guidance, learning, and human reviewers. However, the database currently enforces one virtual member per role per company. A separate content specialist and growth specialist cannot both be independent Marketing employees under that constraint.
4. **Ongoing responsibility is not a complete execution contract yet.** Job definitions support schedules, instructions, result fields, safeguards, and completion rules. They do not supply a general target inventory, versioned quality assessments, measurable coverage, or a transition from improvement to maintenance.
5. **The home and attention surfaces overlap.** Today, Needs you, Work, Company, and Team each provide a partial answer to “what should I do next?” The shared attention service is already the correct foundation for one actionable inbox.
6. **Depth is mixed into routine screens.** Provider choices, detailed research methods, schedules, spending, review states, and technical result fields compete with the actual outcome. Important depth should remain available in a consistent inspector.
7. **Names conflict.** Brand Voice and spoken Voice are separate modules with the same title. Marketing and Growth vary by entry point. Settings currently contains AI Engine, Budgets, and Spend rather than a complete settings structure. Tools is nested in Work, even though capture is useful everywhere.
8. **Data confidence needs a consistent presentation.** The metrics implementation already carries selected periods, previous-period comparisons, coverage, provenance, currency, freshness, and missing observations. Preserve that work and make it visible consistently instead of replacing it with decorative summary cards.

This is a code-based product and architecture audit, with the current desktop office entry points also inspected. The native window could expose its accessibility tree but subsequent input/screenshot capture failed. This is not a claim that every live workflow or production record was tested. Prototype numbers, people, quality scores, and draft contents are illustrative, not an account report.

## Navigation and window behavior

### Four destinations

- **Office:** the existing shared scene. Company and person clicks open the corresponding new workspace/profile. No floor-plan or animation redesign.
- **Companies:** a directory with Our companies and Clients sections; each opens the same company workspace. Global search can also find employees, work, and artifacts within authorized scope.
- **Work:** everything the organization is doing, grouped by company, with owner, purpose, current step, next trigger, and latest result. Companies needing attention rise to the top. Expand only the relevant work. Filtering by person, mode, or status does not change the underlying records.
- **Inbox:** only decisions and interventions needed from the signed-in person. Shared review actions deduplicate across company, employee, and taskbar views. History lives elsewhere; an unread informational event is not automatically an actionable badge.

Ask is a persistent entry point, not another navigation tree. Messages remains a specialist workspace for customer communications, accessible through Work, company context, and the Apps menu. Settings and Tools are utilities. Users can pin a frequently used specialist workspace without adding it to everyone's primary navigation.

### One window for a working context

A company window navigates within itself. A result opens an inspector in that window; on a narrow window it becomes the next page. Back restores the earlier filters, scroll position, and selection. Open in separate window is an explicit action for side-by-side work. Navigating does not silently create another modal.

Use the same title bar everywhere: Back where needed, context/title, Ask, microphone, Apps, and native window controls. Company and work identity remain visible. Human authorization dialogs name the exact effect. Do not put a confirmation inside another confirmation.

Desktop retains independent movable native windows. Browser uses the same content and routing within its existing OS environment. Mobile uses one full-width page at a time, bottom navigation, and an inline detail route. Closing discards the window, not server-side work; minimizing puts it in the Nucleas taskbar area. No automatic minimizing.

### Persistent taskbar Tools

Order: **Inbox → Office → Ask + microphone → Tools → minimized windows → overflow**. Tools is never hidden in the minimized-window overflow. Its native popup opens outside the taskbar bounds and contains Screenshot, Record screen, and Recent captures. Narrow taskbars collapse the Ask field to a button before removing these entry points.

Capture opens with the current company/work context when known. A capture can be attached to Ask, an existing work item, a new request, or saved. Screenshot supports region, window, and the existing webpage capture capability. Recording exposes microphone/system audio choices, pause, stop, elapsed time, and permission/error states. An active recording has a persistent indicator even when its window is minimized. Capture still requires the appropriate user/OS permissions; the tool is accessible without silently recording.

The taskbar remains available without the office being open. Preserve the recent visibility and Explorer stacking fixes.

## The work model people see

### Three ways to give work

**One-off:** produce a result once. Example: create a campaign image, fix a bug, or update the company marketing overview. Completion closes the assignment; later updates create another version or a new linked assignment.

**Repeating:** produce a result on a schedule or a defined event. Example: Game Nights This Week on Mondays, Signature Spotlight Monday/Wednesday/Friday, or prepare content when a new game appears. Next run, timezone, event eligibility, duplicate handling, and review policy remain explicit. A previous result waiting for review does not silently prevent the next scheduled run; a configurable queue limit can pause additional production and clearly explain why.

**Ongoing:** improve or maintain a defined set against an agreed standard. Example: bring eligible casino reviews to the editorial standard; keep support inquiries within an agreed response target; maintain accessibility across selected pages. The interface exposes coverage and the current queue, not a fabricated next run for an always-active worker.

An employee may own several responsibilities and one-off requests. A work item has one accountable owner and may involve other employees. Design, Creative, Engineering, Support, Operations, Tester, and Marketing remain skill families; specialties such as Content editor and SEO researcher can have separate identities within a family. Tester stays inactive until explicitly configured.

### One creation flow

1. **Describe the outcome.** Natural language, files, URLs, or a capture. From a company or employee, scope and owner are prefilled. Ask can propose the same form.
2. **Review the work agreement.** Nucleas suggests the owner, mode, target set, standard, result destination, and review boundary. Show these in plain language. Schedule appears only for repeating work. Coverage and maintenance appear only for ongoing work.
3. **Start within those limits.** Users can accept a draft-only assignment immediately. External publishing, spending, deployment, or expanded access follows the existing capability policy. Do not insert a paid planning call just to translate a fully structured form into API arguments.

Advanced details expand to show exclusions, source requirements, freshness windows, spending ceiling, concurrency, stop conditions, permissions, and retries. Inherited settings say where they came from and link to their editor. Saved attachments persist across the description, agreement, and execution stages.

## Frugal Gambler example

Give a content specialist this responsibility:

> Improve every eligible casino review to our approved editorial standard. Start with the pages that have the greatest useful content gaps and opportunity. Bring me the changes to review. Once the collection meets the standard, monitor for new casinos, stale information, and meaningful changes.

### An explicit agreement

- **Owner:** a named Frugal Gambler Content editor, within the Marketing skill family; human reviewer assigned separately.
- **Target set:** casino records from Frugal Gambler's canonical catalog, joined to their published review pages and saved drafts. Inventory identifiers and page revisions are mandatory. Search results are evidence sources, not the inventory.
- **Coverage:** show total eligible records, assessed records, drafts being prepared, awaiting review, verified published improvements, and blocked/excluded records separately. Every target belongs to one displayed coverage bucket. Historical assessments do not double-count progress.
- **Standard:** initially calibrate on a small, representative sample, proposed as five pages. Agree the criteria before applying them to the full collection. A suggested starting threshold is 85/100 plus every mandatory gate; this is an internal editorial measure, not a search-engine score.
- **Authority:** research and save drafts; publish only under the approved policy. For the pilot, each publication requires review of the exact revision and destination.
- **Resources:** inherit company and organization ceilings; propose an allocation after measuring the sample. Do not invent a new default monthly budget or silently raise an existing one. Limit simultaneous items and waiting drafts to keep reviews manageable.
- **When current:** enter Monitoring. Reopen a target when new facts, a stale evidence window, a changed page, or a changed approved standard justifies work. Do not rewrite a satisfactory page merely to keep the employee busy.

### What quality means

Mandatory gates cover substantiated claims, correct entity/offer identity, current evidence for material terms and availability, no invented testing or experience, source traceability, and an intact usable page. Missing essential evidence blocks readiness even if the numeric score is high.

The scored rubric should cover decision usefulness, original analysis, relevant depth, clarity and structure, and technical/content accessibility. Weighting is proposed during calibration. Word count, keyword density, and a model saying “excellent” are not sufficient criteria. Human preferences tune approved editorial guidance; they do not turn unsupported claims into facts.

Google's review guidance emphasizes useful analysis, supporting evidence, originality, and reader decision factors rather than length. That informs the editorial rubric; the rubric itself is a Nucleas product decision. [Google guidance on high-quality reviews](https://developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews).

Keep two outcome lines separate: **editorial standard achieved** and **observed search/business results**. Search Console impressions/clicks, qualified visits, conversions, and any measured AI citations have separate sources and observation windows. Google states that its existing SEO fundamentals apply to AI Overviews and AI Mode and that eligibility does not guarantee inclusion. Neither a Nucleas score nor publication promises rankings or citations. [Google guidance on AI features](https://developers.google.com/search/docs/appearance/ai-features).

### The operating loop

Inventory → assess gaps → prioritize → brief bounded work → collect evidence → draft → verify → review when required → publish approved revision → read back → reassess → next eligible item or Monitoring.

Operations watches cost per accepted improvement, duplication, stalled work, reviewer backlog, and unnecessary retries. A failed evidence check triggers targeted research or a human question. Retry at most three total attempts for the same bounded item without new human direction; persist the failed methods so a retry actually changes something. Exhaustion becomes Needs a decision, with what was tried and a concrete next choice.

## Company workspace

### Overview

Lead with what changed, business performance, and current priorities. One date control applies to every period metric and comparison: presets plus custom dates, visible timezone, exact dates, and comparison interval. Snapshot measures such as MRR or account balance are labeled “as of,” not disguised as period totals. Counts such as Leads, Users, Customers, and Subscribers retain the company's semantic definitions.

Every metric can expand to its definition, connected source, observed period, last sync, coverage, currency, and underlying records where authorized. Missing data is not zero. Partial data has an explicit completeness label and does not produce an unqualified percentage comparison. Hide irrelevant unconnected revenue platforms as requested; an unavailable configured source remains visible with its reconnect action. Never merge unlike currencies without a documented conversion rule and date. Cash remains outside model context as previously required.

Company facts, logo, owned/client relationship, websites, and About remain editable in a compact Company details sheet. Activity is a view of the company's real receipts/history, accessible from Overview and each work item.

### Work

Show employee-owned responsibilities, one-off work, and repeating assignments in one list. Each row answers: Who owns this? What outcome? What is happening now? Does it need me? When is the next meaningful action? What was delivered?

Selecting an ongoing responsibility opens coverage, current queue, standards, and history. Selecting a one-off or repeating assignment opens its current result and history. Users can edit, pause, resume, change owner, or archive in the same place. A pending result is not confused with the status of its parent responsibility.

### People

Show virtual employees and human reviewers with separate labels. Employee cards show specialty, assigned work, current state, and reviewer. Add employee allows name, skill family, specialty, appearance, and human reviewer. Existing identities and office desks are preserved; assigning a new employee still adds a desk through the current office integration. Disabling or removing a person requires reassignment or explicit pause of their work. It must not strand approvals.

An employee profile has Work, Guidance, and Learning. Guidance contains remit and approved standards; Learning shows accepted editing examples and outcomes, with provenance and a way to remove an unsuitable example. It does not expose hidden reasoning. Every profile links to its real work, not another disconnected chat history.

### Library

One index of existing canonical knowledge and artifacts: Company overview, Marketing overview, Brand voice, Content, Assets, Research, Decisions. The relevant editor appears in the workspace. Approved marketing and brand documents stay viewable after approval. Compare a new version with its immediate predecessor by default; explicitly select a different historical pair only when needed.

Company facts, approved guidance, current work, and preferences have visibly different status. Draft artifacts cannot silently become instructions. Brand voice keeps editorial learning; microphone interaction is labeled Talk, ending the naming collision.

### Connections

Consolidate provider credentials, selected external resources, website/admin access, repositories, and declared capabilities. A connected account and a mapped company data source remain distinct. Show the specific property/page/repository and sync health. OAuth returns to and refreshes the originating company window. Operational screens show a contextual missing-connection action without repeating the full setup UI.

## One review experience

Inbox, company, employee, and Work all open the same work-detail renderer using the canonical item ID and revision. Default view: result preview, what changed, checks, and the exact next decision. Expand Evidence, History, and Models & cost as needed.

Use precise actions: **Save draft**, **Approve this plan**, **Approve publication**, **Publish approved revision**, **Request changes**, **Skip this candidate**, **Reconnect account**, or **Increase budget**. Keep actions separate when the authority differs. Approval alone must not imply publication. External action buttons name destination and consequence, and a successful receipt confirms the resulting state.

Never flatten code, email, social posts, research opportunities, casino additions, and signature concepts into the same generic text form. They share the wrapper, lifecycle presentation, and evidence inspector, with typed previews and native executors inside. Code retains diff/tests/deployment history; social retains platform-specific drafts/images; casino records retain admin-field mapping; signatures retain rendered output and verified prospect evidence.

Human edits to outward-facing content can teach approved company preferences, with an explicit setting and attribution. Do not learn contact details, unsupported factual corrections, secrets, or unrelated personal text as brand style.

## Ask and notifications

Ask remains portfolio-aware. Show the resolved scope and supporting objects before performing work. “Show all running work” queries the actual scoped work register and states its filters/freshness. Activity logs are not substituted for that register. Ambiguous instructions spanning companies produce a small scope choice; they do not guess the target for a mutation.

A request to delegate work produces the same agreement as Give work; an informational question remains a conversation. Direct model selection remains available under mode settings, with provider then model. Orchestrated answers and work share the central engine. Model traces summarize each model's assignment, inputs, result, and handoff, with tokens/cost/error/fallback; do not expose hidden chain-of-thought.

Inbox uses the existing attention service, scoped to human responsibility and access. Multiple people may be eligible, but an optimistic version check prevents double decisions. Reviewer absence supports delegation without broadening company permissions. Email is controlled only through the user's notification summary setting: Off, 30 minutes, 1, 2, 3, 6, 12, or 24 hours. Summaries contain unresolved actions and deep links to the same detail view. Assignment controls choose recipients of attention, not direct job emails. Security/service-health notices remain a separately described category.

## Intelligence and data architecture

### Reuse the current model engine

The employee is a durable scope/identity, not a permanently running model or a fixed model binding. Shared routing chooses providers/models according to task, checked capabilities, benchmark evidence, availability, and configured cost level. Role-specific guidance describes the craft; it does not create a second model-selection system.

Paid planning handles ambiguous decomposition, calibration, priorities, and difficult judgments. Rogly handles bounded extraction, inventory enrichment, evidence organization, routine drafts, and deterministic-test preparation when its capability checks fit. Paid specialist review or rescue is used where it improves quality. API calls, queues, counts, checks, permissions, retries, and calculations stay deterministic. Do not make every trivial action traverse several paid managers.

Persist reusable evidence with company scope, target identity, exact source, retrieval time, freshness policy, content hash, confidence, and usage rights/retention where applicable. Retain failed methods and exclusions. Content from websites and documents is evidence, not trusted instructions. Only authorized company/organization context enters a run. Shared provider credentials never imply shared client data access.

### Additions rather than replacement records

- **Employee instances:** keep existing CompanyTeam IDs; add stable assignment references and allow multiple members of a skill family. Backfill before replacing the role uniqueness constraint. Existing role-based calls need an explicit owner resolver during transition. Do not accidentally route to an arbitrary first matching employee.
- **Responsibility:** company, owner instance, mode, agreement version, targets, standard reference/version, review policy, budget allocation, priority, lifecycle, maintenance rules. Existing JobDefinition references attach underneath; legacy one-off/repeating assignments can initially project directly without copying their history.
- **Work target and assessment:** canonical object/page revision, applicability, findings, evidence references, rubric version, human overrides, freshness, completion/publication receipt. Standard changes mark assessments due for review, not automatically failed or auto-republished.
- **Work projection:** read model joining jobs, runs, builds, deliveries, and responsibilities for Work/Inbox/Ask. Each entry retains native type and canonical ID. Commands still use the original validated services, not generic table writes.
- **Controller:** deterministic wake-up on schedule, eligible event, data change, retry timer, or explicit request. It claims work with leases/idempotency, reserves budget, applies concurrency limits, stores checkpoints, and sleeps when no work is eligible. No continuous LLM polling.
- **Budget accounting:** organization/company limits remain authoritative; optional employee/responsibility allocations subdivide them. Reserve against concurrent runs, reconcile actual usage and failed calls, and show unknown cost honestly. Free provider usage still has compute/concurrency limits.

Responsibility states: Proposed, Active, Monitoring, Paused, Completed, Archived. Work-item states: Queued, Working, Needs review, Blocked, Ready to publish where applicable, Completed, Failed, Skipped. The UI shows the specific blocker and source state rather than coercing incompatible native statuses into a misleading universal enum.

## All existing modules and their destinations

- Office → preserved Office; only work/company links route into the new views.
- Companies → Companies directory and company workspace.
- Company → Overview / Work / People / Library / Connections.
- Team → company People and employee profiles; organization-wide employee filter in Work.
- Review & work → Work, with review decisions in Inbox.
- Needs you → Inbox and taskbar badge, same attention records.
- Today → company Overview and the organization Work summary; no duplicate app.
- Ask Nucleas → persistent Ask window/panel, scope-aware.
- All responsibilities → Work; old links resolve to the same assignment.
- Growth → contextual marketing work and company Library; no separate navigation layer.
- Marketing → Marketing overview/strategy editor in Library; campaigns and outreach in Work.
- Content → Library content editor and employee-owned content work.
- Brand Voice → Library → Brand voice, with versions and approved editorial examples.
- Voice → Talk action in title bar/taskbar/Ask.
- Building → code work detail with IDE/diff/test views; optionally open separately.
- Mail → Messages specialist workspace, linked to Support work and company context.
- Tools → persistent Tools menu plus capture workspace.
- Animation Studio → specialist creative tool, reachable from Tools and Creative work.
- Integrations → company Connections; shared credentials remain admin-scoped.
- Settings → Preferences, People & access, AI engine, Budgets & usage, Desktop, and connection administration.
- AI Budgets → Budgets & usage; contextual edit links from company/employee/work.
- AI Spend → Budgets & usage, with project/company/employee/work drill-down.
- AI Engine → Settings → AI engine, preserving discovery, checks, rankings, pins, and provider-first Direct selection.

Projects, calendar/task relationships, assets, research, approvals, model receipts, and legacy UI records remain canonical. Do not remove their API or data just because navigation changes. Existing external/email/desktop deep links must continue resolving.

## Implementation sequence and approval gates

### 1. Inventory and shared navigation

Define a typed route/context contract for company, employee, responsibility, work item, artifact, and return location. Document each existing entry point and permission. Build the new title bar, consistent inspector/back behavior, responsive layout, and taskbar Tools popup behind a feature flag. Keep the office renderer unchanged. Gate: every old deep link resolves, capture works with office closed, and no editor draft is lost when navigating.

### 2. Unify Work and Inbox

Build the permission-filtered work projection and adapter renderers. Map old job/build/delivery statuses faithfully. Reuse attention and digest preferences. Connect Ask to the same query service. Gate: existing responsibilities, scheduled runs, pending decisions, recipients, and history reconcile by ID/count; a repeated action cannot publish twice; resolved items disappear everywhere.

### 3. Company workspace and people

Move performance, knowledge, connections, and employee tools into the five company sections. Add employee-instance ownership and migrate role-based assignments with explicit fallbacks. Preserve identities, office desk association, names, reviewers, and disabled employees. Gate: one company can have two Marketing specialists with separate work and context; other companies and clients remain isolated; metric periods, gaps, definitions, and currencies agree across summary and detail.

### 4. Unified work agreements

Introduce the three-mode composer and versioned agreements. Preserve existing schedules, timezones, random windows, source policies, attachments, approval boundaries, and monthly limits during mapping. Do not reset next-run dates or re-run old dry runs. Gate: existing one-off and repeating work remains behaviorally equivalent, and editing one assignment cannot expand its authority without an explicit reviewable change.

### 5. Ongoing work pilot

Start with Frugal Gambler casino content. Validate read inventory, saved-draft write, approved publish, and read-back capabilities separately; do not assume the casino-discovery form filler can safely edit complete reviews. Calibrate a small sample, then produce drafts for a limited target set. Add the deterministic controller, target assessment ledger, bounded retry policy, and Monitoring transition. Gate: accepted editorial improvements with complete evidence/receipts; no changes to unapproved pages; no duplicate targets; no model calls when no work is eligible.

### 6. Expand and retire duplicate entry points

Use PlayBound to prove scheduled-event content, then Tailnote to prove prospect research and typed assets. Introduce further responsibilities only where capability and standards are defined. Remove duplicate launcher destinations after route compatibility and user acceptance. Legacy nucleas.app screens and canonical data remain intact. Gate: the user can find, edit, review, and trace work without knowing the old module name; desktop/mobile and long-running idle behavior pass checks.

Each phase is independently reviewable and reversible via feature flags. Rollback restores navigation, not copied databases. Migration scripts must be resumable, produce a dry-run mapping, and preserve native IDs/approval digests. Backups and explicit production migration authorization precede data mutation.

## Validation and acceptance

- User walkthroughs: delegate from Ask; give ongoing work from an employee; review/edit/publish a result; find an approved plan; change budget; diagnose missing data; reconnect a provider; capture from the taskbar with all app windows closed.
- State transitions: once/repeating/ongoing, timezones and DST, duplicate event deliveries, retries and provider failures, review backlog, concurrent approvals, stale revisions, pause/resume, ownership changes, and empty inventories.
- Permission tests: cross-company read/write isolation, assigned reviewer visibility, admin-only budgets/models, cash excluded from AI, and no implicit privilege increase through a workspace route.
- Migration tests: preserve job IDs, schedules, queued work, evidence, saved drafts, published receipts, human decisions, notifications, and existing deep links.
- Data tests: exact period alignment, missing versus zero, partial coverage, snapshot as-of, currencies, lifecycle definitions, and reconcilable target counts. Quality scores must identify rubric and page revision.
- Performance: lazy-load specialists, virtualize large inventories, coalesce subscriptions, stop hidden-window UI polling/animation, and close unused renderers. Server-side work remains independent. Active recordings have an intentionally separate lightweight capture lifecycle. Compare idle CPU/memory and wakeups against measured baselines; do not claim “zero resources.”
- Accessibility/mobile: keyboard/back navigation, clear action labels, focus return, no hover-only controls, readable 320px layouts, and full-size review editors rather than compressed desktop modals.

## Decisions requested

Approve or revise the direction: four primary destinations; employee-owned work in three modes; one review inbox; five company sections; ongoing work controlled by target standards and explicit limits; taskbar Tools; existing office preserved.

Approval of the direction authorizes implementation planning and code work, not new production publishing authority, guessed budgets, or activation of new autonomous responsibilities. The Frugal Gambler rubric, budget, eligible inventory, and publishing policy are separate concrete settings to review during the pilot.

## Source map for implementation

- Navigation: `src/components/os/modules/registerModules.ts`, `desktop/renderer/catalog.json`, `src/lib/os/windowManager.ts`, `src/lib/os/desktopWindows.ts`.
- Overlapping workflows: `WorkModule.tsx`, `GrowthModule.tsx`, `JobsModule.tsx`, `ContentModule.tsx`, `TeamModule.tsx`, `CompanyTeamPanel.tsx`, and `jobs/WorkBoard.tsx` under `src/components/os/modules/`.
- Company and metrics: `CompanyModule.tsx`, `CompanySnapshot.tsx`, `CompanyAbout.tsx`, `CompanyTimeline.tsx`, `ResourcePicker.tsx`, plus `src/lib/metrics/period.ts`.
- Team: `src/lib/models/CompanyTeam.ts`, `src/lib/companies/teamRoles.ts`, `teamPlaybooks.ts`, `teamContext.ts`, and `teamConsult.ts`.
- Execution: `src/lib/jobs/schema.ts`, `src/lib/jobs/jobs.ts`, typed publishing/build/capability services, existing AI engine and model-path receipts.
- Attention: `src/lib/attention/service.ts`, `digest.ts`, and their integration tests.
- Taskbar/capture: `desktop/renderer/taskbar.html`, `desktop/renderer/taskbar.js`, `src/components/os/modules/ToolsModule.tsx`, existing screenshot/recording panels.

The companion clickable proposal covers primary workspaces, specialist editors, decision sheets, workflow, mobile layout, and the complete module destination map. It uses local illustrative state and performs no live actions.
