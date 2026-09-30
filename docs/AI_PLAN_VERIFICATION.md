# Plan verification (how Nucleas keeps free models honest)

Small models fail in a consistent way: they search for the keyword in a request, latch onto the first file
that mentions it, and write a fluent plan around it without checking how the page really gets its data.
Plan mode counters this with checks that run in code, not in the model. Nothing here is specific to one site
or framework.

## The flow (Plan mode)

1. **Evidence pack** (`src/lib/ai/repo/evidencePack.ts`). Before any model runs, Nucleas traces the code:
   the shortest chains from the page a request names to the files that mention the request's names (with the
   connecting `file:line`), the quotable lines, other readers of those files, and places the path reads a
   database or external service (flagged "not verifiable from the repository"). The files between the page
   and the data, where lists are assembled, are read first. It is part of the dig context every stage sees.
2. **Planner** writes a structured plan (`src/lib/ide/planStructure.ts`): symptom, code path, root cause with
   quoted evidence, files to change, expected result, side effects, unverified, out of scope, steps.
3. **Checks** (`src/lib/ai/repo/claimCheck.ts`). Every quote is looked up in the cited file (whitespace and
   quote style ignored, multi-line quotes supported). A quote that repeats is resolved by the cited line, and
   flagged as ambiguous when nothing singles one occurrence out. Edits are compared with the code the named
   page uses. The plan must also give a **walkthrough** (the code that builds the symptom, stepped through with
   the change applied, and what it outputs) and must **answer for each reader** of the changed files: readers
   are grouped by folder and route prefix, and a group counts as answered only if the side effects name a
   file, folder or route in it. Problems go back to the Planner once, worded as corrections. A plan with no
   verifiable evidence, or whose edits are on code the page does not use, is not published as ready: the
   reasons and the draft are shown instead. Readers still unanswered after the correction round are listed in
   the plan's automatic section and passed to the Worker and Critic.
4. **Worker** verifies the plan's claims with tools and quoted lines. It receives the automated findings.
5. **Critic** (the Reviewer stage, a different model from the Planner when one is available) tries to break
   the plan and receives the same findings. A `needs_more` gate sends work back.
6. Verified plans get an "Automatic checks" section: what was found, other readers of the changed files, and
   data the repository cannot show. Editing a plan in the UI keeps these sections.

Every step that can throw is an aid: a failure in tracing or checking is skipped, never fatal.

## Tracing across frameworks

`routes.ts` maps URLs to files and back; `imports.ts` resolves what a file depends on; `references.ts` walks
both. Covered: Next.js (both routers), SvelteKit, Nuxt, Astro, Remix, React/Vue Router, Express-style,
Flask, FastAPI, Django (`include()` prefixes, DRF), Go (gin, echo, chi, net/http), Laravel, WordPress
(templates, REST, admin pages) and Shopify Liquid. File-based conventions apply only when the nearest
`package.json` uses that framework. Import aliases are read from `tsconfig`/`jsconfig` `paths`.
Routing built at runtime is not seen; the keyword ranking still applies then.

## Measuring a change

`npm run eval:replay -- <repoPath> [--limit=60] [--k=8] [--mask-paths] [--verbose]` replays a repository's own
history: each past commit is a task (message = request, changed source files that still exist = answer) and
the script reports how often the dig shows those files first, for the old keyword ranking and for the current
dig. Files are read as they are at HEAD, and commit messages often name what they change, so absolute numbers
are optimistic; compare methods, not repositories. `scorePlanTargets` in `src/lib/ai/eval/replay.ts` scores a
plan's files against a real change for evaluating full model runs.

## Checks on what a plan says about the code

- **Context around quotes:** each quoted line is shown with ~5 lines around it (in the correction round, to the Worker and Critic, and in the plan's "Code around the quoted lines"), so the plan's description of what a line belongs to can be checked.
- **Line claims:** a cited `file:line` (or "line N" for the single file being changed) must show the named thing within a few lines, or the plan is sent back.
- **Contradictions:** a step that changes code that another step says stays unchanged (same line, or the named thing sits on that line) is flagged.
- **Readers:** up to two correction rounds; if readers of the changed files are still unassessed, "None found" claims are removed and a `NOT ASSESSED` line is added, so the plan never says "none" beside the warnings.
- **Stored data:** every database model the data path reads must be mentioned by the plan (could stored rows keep the symptom alive?).

## Blocking, and facts before planning

- **Structure facts:** the evidence pack now says, for the top mentioned lines, which bracketed object each belongs to (its fields, and what directly contains it), computed from the file. The planner cannot invent a nested array that is not there.
- **Hard blocks:** a plan that still has a wrong line claim or a step that contradicts another after the correction rounds is not published for approval; the draft and the reasons are shown instead.
- **Second opinion:** the second correction round goes to the worker-model (a different model), and is given time before the Worker and Critic are.
- **Honest sections:** "None found" side effects and "Nothing outstanding" unverified are replaced with `NOT ASSESSED` when the checks found readers or stored data the plan ignored; the plan also states how many correction rounds ran.
