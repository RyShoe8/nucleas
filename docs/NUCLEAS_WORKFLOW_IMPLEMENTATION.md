# Workflow implementation — November 20, 2026

Implemented locally against the approved workflow proposal. No deployment, production migration, new recurring work, or external publication was performed.

## Navigation and company workspace

- Office, Companies, Work, and Inbox are the primary destinations. Tools and Ask remain independent utilities; old module routes still resolve.
- Company sections are Overview, Work, People, Library, and Connections. Visited sections retain editor/filter state while hidden effects suspend. Back and Open separately reuse canonical editors without creating another company or job record.
- Overview exposes selected reporting periods, custom completed-day ranges, daily observations, coverage, source/currency warnings, CSV export, and on-demand GA4/GSC breakdowns. Live provider breakdowns explicitly identify their own supported date range.
- Library exposes existing marketing plans, brand voice, articles, company knowledge, linked assets, shared research, and recent decisions. Asset permissions are checked against the original records. The recent-decision view states its bounded history window; full job history stays in the existing editor.
- Hearth's office revenue display was interpreting monetary hundredths as whole currency units. `34737` is now `$347.37`; the source snapshots are unchanged. Currency mixing remains rejected by the metric query layer.

## Employees and work

- Additional named specialists live under the existing CompanyTeam skill-family record. This preserves its unique company/role index, the original employee identities and desk IDs, and existing assignments.
- Assignments can target a specialist ID. Work lists, model guidance/feedback, reviewer notifications, build plans, and office desk projections carry that identity. Specialist assignment grants no additional company access. Tester remains inactive.
- Give work supports one-off, repeating, and ongoing agreements. One-off Engineering/Design work enters the existing code planner; other drafts use the existing job/model engine. Specialist publishing, prospect, attachment, and code editors remain available for their typed delivery configuration.
- Existing jobs are projected into Work without resetting schedules, budgets, dry runs, notifications, or publishing approvals. Inbox uses the shared attention service and personal digest preferences.

### Completed handoff and reference checks

- Ask's Direct and Orchestrated non-code delegation now propose the same Give work agreement. Existing historical job cards remain readable. The proposed request, standard, selected model level and structured weekly cadence carry into the form. The person completes missing decisions before execution planning starts.
- Ask draft submission is scoped to its author and organization and claimed once across concurrent windows. Returning to an accepted draft opens its existing work. An interrupted request can recover the linked job/build/responsibility instead of creating another copy.
- Give work supports multiple weekdays, editable timezones, source links, company Library files, and uploads. File IDs remain in the stored agreement; permission checks run again when references are read. Ask originals used for explicit work requests are retained as private canonical Assets, then linked to the company when its agreement is submitted. Unsupported/oversized originals produce a visible retention warning. File uploads in Give work are limited to 3 MB; Ask retains originals up to 8 MB, with its existing text-read bound.
- Text and PDF evidence reaches planning and execution separately from the request. Image references use cached descriptions from the free vision route; a missing description fails explicitly. The original files and definition of done are accessible from job/build details. This adds no separate model router.
- Large Ask work-register responses remain valid JSON and expose omissions and the source register's 200-record limit. Work displays that limit when reached.
- Desktop capture indicators clear after a renderer crash or full navigation. Recent captures now includes screenshots stored directly in Nucleas through authenticated content links.

## Ongoing page-improvement pilot

- Scope is an explicit collection of company-owned pages. Frugal Gambler can import candidate pages from its connected canonical casino admin catalog. Other companies can supply explicit page URLs.
- An agreement records an outcome, standard, mandatory checks, threshold, owner, review capacity, and explicitly approved monthly/per-target allocation. New agreements are proposed and inactive.
- A leased controller creates at most one target job per tick, reserves allocation atomically with the target/job link, respects the pending-review limit, and uses the existing model routing, research, review, and receipts. No parallel model runtime was added.
- Each target allows three attempts before blocking. Pausing/archiving stops new work and retains history. In-flight execution uses the existing job controls.
- Human assessments retain evidence, reviewer, rubric version, and a hash of the live page. A passing score also requires every mandatory check. Accepting a draft alone does not establish that the published page meets the standard.
- Changing a quality agreement creates a retained version and returns it to proposed status. Existing assessment history is retained; prior current targets need assessment against the revised standard.
- Each target that passes assessment receives a full 30-day cooldown: no automatic page fetches, research, or model calls. When all targets are current, the controller sleeps until the earliest target is due. Due pages are checked in small batches and queued for reassessment, including unchanged pages whose source evidence may have aged. An unreadable due page retains its last assessment and retries tomorrow. Explicit reopen or a revised quality agreement can resume work sooner.
- Ask's existing job-register tool also returns ongoing responsibility coverage, status, review counts, and allocation (identified separately from actual spend).

### Durable target budgets and maintenance

- Each target reserves the smaller of its approved allowance and the organization item cap, atomically with its canonical job. Planning, execution, later queue delivery, and retries all consume that same allowance. A separate budget lease prevents overlapping executors from spending it twice; enclosing request caps still apply.
- Budget receipts retain known costs and unfinished/unreported costs. Known unused allowance is released after target assessment or closure. Open reservations carry across calendar months; missing usage keeps its reservation and prevents further paid work for that target. Free work can still finish. Recorded costs are booked in the UTC month the budget operation finishes, separately from open reservations.
- This is a stop-before-the-next-paid-call allowance, matching the existing engine. An already-running provider call can exceed it. An unknown receipt needs reconciliation before its reservation can safely be released; there is no automatic assumption that an interrupted call cost zero.
- Pausing during preparation cannot be overwritten by the controller and prevents automatic progression to execution. Temporary unreadable-page checks retain the last assessment and defer another check instead of commissioning a rewrite. Changes to an agreement or an assessment wake its controller rather than leaving it asleep until an old budget-reset date.
- Work and Ask report recorded cost, reserved allowance, and unverified-cost counts separately. Native Job/JobRun records and organization spend reporting remain canonical for the underlying work and model usage.

The first pilot deliberately prepares audits and drafts. Applying a full casino review through the external admin needs a separately verified save-draft/publish/read-back contract; the existing casino discovery intake is not treated as that contract. Select pilot pages, calibrate the rubric on a small sample, and set the actual allocation before activation. This implementation does not promise SEO rankings or AI citations from a quality score.

## Desktop capture

- Taskbar Tools offers Screenshot, Record screen, and Recent captures without requiring Office to be open. Talk is distinct from Brand voice.
- Active recording controls survive tool-tab changes and visibility suspension. The desktop taskbar indicates an active capture and returns to its window; normal hidden views suspend. Closing a window still releases its renderer.
- New IPC remains sender-scoped. Capture permissions are unchanged. A packaged Windows walkthrough with real screen/audio permission prompts remains a release check; the native taskbar behavior was exercised through its existing IPC/window fixtures.
- An unsigned local unpacked Windows build completed successfully at `desktop/release/win-unpacked/Nucleas.exe`. This was not installed, published, or launched against a production account. Its native capture permission walkthrough remains unverified.

## Verification

### Voice and mobile integration

- Voice and the command palette recognize Office, Companies, Work, Inbox, company sections, Tools, and specialist editors. Navigation resolves exact accessible company names/domains and supported reporting periods. Substantive requests enter the existing Ask mode/model route and work-agreement review flow, without another model parser or authority to publish directly.
- The microphone captures the visible company/editor context when listening begins. Nested editors and Give work register their current scope; Activity-hidden editors unregister. Users can edit dictated Ask requests before confirming. Ambiguous company names require clarification instead of guessing.
- Ask holds handed-off requests until history and model selection are ready, and preserves each request's company context while an earlier answer is running. Native company windows have inline microphone controls; Ask remains the native wake-word listener. Hidden/closed windows release capture, and Cancel discards speech and late parse results.
- Company headers, section navigation, workspace controls, and themed confirmation modals adapt to narrow screens. Touch targets, form text, safe-area padding, dynamic viewport heights, and horizontal tab scrolling are shared across the new workflow. Office artwork and geometry remain unchanged.
- Reporting responses are keyed to company, site, date range, and refresh. A new range never briefly relabels old observations while its request loads.
- Checked actual components with clearly labeled local fixture data at 320px, 390px, and 768px: company overview and daily revenue detail, timeframes, repeating work form, Inbox settings, and voice confirmation. Simulated speech verified navigation, editable requests, company context captured before navigation, and cancellation. No microphone, external model, or production account was used. Real microphone permissions/recognition and native-device keyboard behavior remain rollout checks.
- Added voice routing and queued-request regressions; the focused voice, Ask handoff, workspace-route, and reporting-window suites pass 32 tests. TypeScript and scoped ESLint pass.

### Earlier workflow validation

- Latest continuation: 197 tests passed across work agreements/budgets, existing jobs, provider fallback, Ask orchestration, metrics, and reporting windows. The final responsibility-display adjustment passed its eight-test suite again. TypeScript and scoped ESLint passed. The unpacked build's main, preloads, capture, and taskbar files match the local sources byte for byte.
- TypeScript check and scoped ESLint check.
- Memory-database tests for existing jobs/model orchestration, metrics and currency/period handling, responsibility leases/limits/assessment history/versioning, and specialist review isolation.
- Office simulation/shared-state and employee-removal regression tests. Office geometry, artwork, interactions, and animation code were retained; ownership projections support additional desks using existing layout behavior.
- Taskbar tests include capture access with no app windows, active-capture indication, sender rejection, renderer recreation, and fallback attachment.
- Browser walkthrough with clearly labeled local fixture data: company navigation, deeper revenue detail, company-scoped delegation, Back behavior, and a 390px layout. No production account or source data was fetched for the walkthrough.

Remaining rollout checks are the packaged desktop capture walkthrough and real pilot calibration/integration verification. The implementation reuses several established specialist editors rather than deleting them; their full replacement can follow user acceptance of the new entry points. Nothing has been committed or pushed as part of this work.
