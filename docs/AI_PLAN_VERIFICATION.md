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
3. **Checks** (`src/lib/ai/repo/claimCheck.ts`). Every quote is looked up in the cited file; edits are compared
   with the code the named page uses. Problems go back to the Planner once, worded as corrections. A plan
   with no verifiable evidence, or whose edits are on code the page does not use, is not published as ready:
   the reasons and the draft are shown instead.
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
