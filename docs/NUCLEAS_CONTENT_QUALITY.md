# Content quality, evidence and model evaluation

Implemented November 26, 2026. This extends the existing engine, Ask, job runner and company memory. It does not create another orchestrator or replace company, job, approval or budget records.

## Execution

1. A planner specifies reader questions, required coverage, evidence requirements and an alternative research method. Content work retains its required output fields as minimum coverage.
2. Rogly researchers receive up to three focused evidence assignments before the main content draft. Their summaries remain untrusted research leads. The shared research method opens source pages in code and follows up on required gaps within its existing limits.
3. Substantial content receives an editorial pass using the Write route's model choice and human-reviewed writing scores. Automatic selection prefers an eligible paid model inside the selected level's price ceiling, otherwise a free writer. Free level never becomes paid. Manual Write choices remain authoritative. This derived selection is visible under AI Engine → Editorial synthesis.
4. A separate review call inventories material claims against original source passages, checks coverage, and assesses depth, useful original analysis, approved Voice and honest treatment of first-hand experience. This is a separate context, not a guarantee of a different provider or model.
5. Code matches quoted passages, validates timestamps and numeric units, and checks declared arithmetic. Entity, meaning and applicability still require reviewer judgement. A matching number or a working link is never described as proof of a claim.
6. One focused editorial repair may follow a substantive review failure. The revised draft receives a new review; an earlier verdict cannot carry over. Unreadable reviews, exhausted research, missing required evidence and time/budget limits remain explicit incomplete states. Useful drafts are retained.
7. Existing completion policy and human approval still govern delivery. Content quality cannot authorize external writes or publication.

The initial scope is factual Ask answers and substantial work in the shared runner: content-category work, ongoing work using the current agreement compiler, explicitly `quality: in_depth` work, marketing plans, SEO briefs and AI-citation work. Specialized publishing and prospect pipelines retain their existing domain checks. They also benefit where they invoke the shared research method; they are not silently replaced with the article pipeline.

## Evidence contract and presentation

`src/lib/ai/research/contentQuality.ts` contains the versioned result contract. A claim retains its subject, source URL, exact supporting quote, scope, check date, freshness, kind (fact, advertised, observed, inference), review verdict and code-match outcome. Supported calculations retain their inputs, operation, result and unit.

Review material is bounded to 30 opened pages and 30,000 characters of excerpts, selected for relevance to the draft. An excerpt gap cannot be passed off as a contiguous quote. Up to 80 claims and 32 coverage questions are recorded; the planner proposes at most 16 questions, with human-agreed checks and required fields taking priority. A review that cannot inventory the full deliverable must mark that limitation. Current checks use a one-day freshness window for claims marked volatile and 30 days otherwise; retrieval does not renew a source's timestamp. These windows are verification policy, not a guarantee that a provider's information remains correct.

Ask details and work results share the Content quality and evidence component. Required and optional gaps are distinct. Source passages, scope, calculations and verification dates can be inspected without putting the entire review into the answer. Ask preserves cents in financial facts.

## Correctable company memory

Reviewed claims can enter the company team board with their source passage and original check date. Linked intern bullets are unverified observations. Distinct claims from the same page are retained; stale and conflicting records do not become facts merely through reuse.

Company → Library → Research allows company managers to correct or withdraw a memory. Corrections append a revision, record the editor and reason, clear inherited verification and require a new check. Withdrawn and superseded claims leave active context. Recent versions remain available within the board's existing bounded history (60 evidence records). Updates are scoped by organization and company and reject a stale edit. This is recent operational memory, not an unlimited audit archive.

Manual publishing edits continue to teach Voice. Changes to numbers or URLs are identified as possible factual corrections, and all examples are explicitly style guidance, not factual authority. This heuristic does not detect every wording-only factual edit, so no edited example is promoted automatically to a verified fact.

The existing responsibility controller's 30-day cooldown after a target passes remains unchanged. Memory freshness does not trigger additional background page checks by itself.

Responsibility targets retain the deeper content contract when compiled into one-time research work, including previously designed targets. Every agreed mandatory check is retained in the instructions and reviewed explicitly. A sample awaiting human review surfaces its target for attention even while the parent job remains in testing; a newer running attempt takes precedence over an older sample. Accepting a draft does not replace the separate human assessment of the live target.

## Content evaluation and routing

AI Engine → Content evaluations runs three versioned source-packet fixtures for a chosen provider/model and task (Write or Review). Cases cover revenue units/company scope, advertised versus observed performance, and stale/conflicting evidence with useful comparative analysis. These are illustrative test inputs, not live business claims.

Evaluations are explicit admin actions, use ordinary accounting and per-work budget admission, make no tool calls, and disable model substitution. One evaluation runs per organization at a time. Partial results and unknown usage remain visible after failure. No paid evaluations run merely because the panel is opened or this code is deployed.

An administrator must grade all three cases and explain the assessment. The score weights factual accuracy 40%, coverage 30%, Voice 15%, original value 15%. A critical factual error or factuality below 3/4 caps the score at 40%. Only completed human reviews for the current suite and originating organization affect routing. Scores expire after 90 days. Model-generated grades have no authority.

For Write and Review, current content scores take priority over general benchmarks. Scores below 70% exclude automatic selection for that task; other task routes are unchanged. Newer evaluations replace older ones, and explicit model overrides still apply. Free and paid availability remain separate, and editorial synthesis honors the selected price ceiling. These three fixtures are a starting evaluation set, not evidence that any untested model is accurate across the whole platform.

## Validation and rollout

The additions are backward-compatible optional fields on JobRun, Ask evidence, job designs, publishing examples and the company board, plus a ContentEvaluation collection. No destructive migration or production data rewrite is needed. Existing results without a quality record are not retroactively labelled verified.

Tests use synthetic source pages, mocked model providers and in-memory MongoDB. They exercise review/repair/review, partial failure preservation, numeric and arithmetic errors, freshness, optional coverage, editorial selection, tenant isolation, memory revisions and human grading. Type checking and focused lint cover the implementation. Live model evaluation and calibration remain explicit admin actions after deployment.

The quality standard requires substantive usefulness, supported comparisons and labelled analysis; it does not promise search rankings or AI citations. Production content still needs its existing human approval when that is the configured policy.
