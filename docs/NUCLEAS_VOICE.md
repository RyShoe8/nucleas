# Brand Voice in Nucleas

Marketing opens on **Marketing overview**, followed by **Voice**, **Link building**, and **Custom job**. Voice is the brand persona, separate from spoken-command Voice.

Choose a company, add first-party writing samples with source URLs, and click **Generate Voice**. This creates a proposed first-party job using the shared AI engine, cost level, budgets, execution receipts, and existing review workflow. Approve the job to run it. Accepting its result saves a draft persona. Use **Reload saved Voice**, edit, then **Approve Voice** to apply it to content-category and social-media drafting jobs. Both worker and reviewer receive the approved persona. Drafts do not influence generation.

The core brand-profile schema, persona compiler, and style helpers are ported from Content Intelligence (`packages/db/src/brand-profile.ts`, `apps/worker/src/services/derive-persona-summary.ts`, and `apps/worker/src/voice-style-rules.ts`). Nucleas supplies company-scoped storage and job execution instead of duplicating Content Intelligence's provider setup. Unsupported tone and personality values are marked not established rather than assigned a generic brand personality.

Profiles include positioning, audience relationship, emotion, contrastive traits, rhetorical patterns, taboos, objectives, archetype, shared identity, and brand memory. Generation uses the Company Overview, live first-party pages, and supplied examples. Visual traits must not be inferred from textual evidence.

This integrates the editorial persona core, not every Content Intelligence workflow. Existing Content Intelligence records have not been imported. Inbox/RSS ingestion, measured article-style profiles and fidelity retries, visual analysis, and its publishing workflows remain in that application. Nucleas does not require its environment variables, database, or a second AI router.

Voice changes require company-manager permissions, retain source URLs and a revision number, and reject stale edits. No external publishing is performed.

Voice and Marketing overview are manual artifacts: approval forces a one-time, human-reviewed run, and the scheduler excludes both skills even if an older record has recurring settings. The monthly budget is only a spending cap. To update either artifact, create another generation job manually. Before an edit or accepted result replaces the saved artifact, its previous value is preserved. **Compare with previous version** displays the current value beside the immediately preceding distinct saved content; approval-only changes are skipped. Marketing overview also provides direct access to the saved plan independently of its generation job. History starts with the value present when this feature is deployed; already-overwritten versions cannot be recovered.

The output reader accepts fenced JSON, JSON-encoded strings, record arrays, and recognizable Voice profile envelopes without fabricating missing sources. Manual artifact generation has a 6,000-token output allowance. A failed formatting repair reports validation or provider errors instead of the generic unusable-records message. These changes are regression-tested with synthetic model replies; they do not establish the exact cause of an older failure whose raw response was not retained.
