# Nucleas research standard

How Nucleas answers anything that depends on outside facts. It is the standard for Ask and for jobs. New features that
research the web follow it and use `src/lib/ai/research/` rather than building their own loop.

Accuracy and quality come before speed and before saving cents.

## The method

1. **State what counts.** Before research, write down what the person really means: what makes an item count, and what
   only looks like it does. "Sites with reviews of our games" means publications that review many games, not a fan site
   named after one game. Workers, the gap check, the writer and the reviewer all get it.
2. **Free models gather.** They search and read in the tool loop. They rarely open many pages and sometimes name pages
   they never opened, so their reports are leads, not facts.
3. **Code opens every link.** `checkPages` tries a fetch, then the real browser on the VPS, and marks each page OPENED,
   GONE or BLOCKED. A blocked page is never proof of anything. Links to pages that do not exist never reach a reader.
4. **A paid model checks for gaps.** It compares the findings with what was asked and writes exact tasks for what is
   missing.
5. **A paid model does the follow-ups.** At any paid cost level. The Free level stays free throughout.
6. **Code settles what it can before review.** Colors, punctuation, numbers, site size and page checks are decided in
   code, and the reviewer is told so. A reviewer cannot browse, so it must never fail work over something code settled.
7. **Paid models write and review the result** when real research went into it.

## Changing the method

Everything lives in `src/lib/ai/research/standard.ts`: the limits in `RESEARCH_METHOD`, which jobs opt out in
`JOB_METHODS`, and the wording every worker, gap check and reviewer gets. Change it there and it reaches Ask and every job
on the next run. Do not copy any of it into a feature.

## Where it applies

Every job uses the full method unless `JOB_METHODS` names it, and new jobs get it by default. Free models still try first
where they can, and the Free cost level stays free throughout.

| Where | Notes |
| --- | --- |
| Ask, orchestrated | All of it, plus site size from Tranco and details grouped by website |
| Ask, Direct | One chosen model, but every link is opened and missing ones removed |
| Every job | What counts, every link opened, gap checks and paid follow-ups, reviewer told what code settled |
| Link building | Free models first. A paid model steps in when they end with nothing, and for follow-ups |
| Spotlight job | `own_pipeline`: per-lead checks confirmed by code, which go further than the standard |

## Posts about new items

`POST_METHOD` and `postMethod` in the same file. Built to spend little, because these run often:

1. Code searches and opens the pages. No model.
2. A free model pulls facts from one page at a time, each with the exact words it came from. Code keeps a fact only if
   those words are on the page and the page is about the right item. This step is never paid, whatever the job's level.
3. The paid model writes from the page and the checked facts, in the company's Voice.
4. The paid model reviews it, with one rewrite. If it still has a concern, the post is not sent automatically and the
   card says why.

The facts are shown on the review card with links. If any research step fails, the post is written from its own page as
before. Pages about the company's own output (news, events) skip the research, and email deals stay simple.

## Where it does not apply

Extremely simple work that researches nothing: pulling facts out of an email into a deal, picking a form link, summarizing
a mail, scanning watches. These stay on `askEngine`. Articles open their source pages in code and extract facts from them,
so they already meet step 3.

## Showing the work

Every step is recorded, including steps with no model, so a person can see what was opened and what it cost. An answer's
details show each website, which pages were opened, which facts came from it and which images were found there.
