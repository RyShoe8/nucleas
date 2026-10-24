# Manual release roundups

Client-safe exports live in `types.ts`. GET and POST use
`/api/os/content/roundups`; no scheduled job is created. Members can generate,
reopen and save. Managers can configure, reject and publish. Poll GET during work.
Expired generation leases become failed on polling; generate/reopen retries them.
Expired publication leases become publish_uncertain. Retry Publish directly for
uncertain drafts without saving first, preserving the original payload and key.

Company domain is the production `CompanyProfile.domain`; arbitrary endpoint URLs
are not accepted. The server derives `/api/integrations/nucleas/roundup` and
requires public DNS, HTTPS and no redirects. Set server-only
`NUCLEAS_ROUNDUP_SECRET_<UPPERCASE_COMPANY_OBJECT_ID>`; PlayBound's exact
playbound.club / www.playbound.club (and legacy .com) hosts also accept
`NUCLEAS_ROUNDUP_SECRET`. Neither credentials nor installation IDs are returned.

Site GET uses signed `since` and `until` query parameters. A tiny discovery window
first retrieves the previous manual blog baseline (October 2,
`new-games-platform-updates` on PlayBound); the actual source request uses the
confirmed coverage window [start,end). Site `coverageEnd` takes priority over
publication date. `limitations` are persisted in `details.warnings` and logs.
Native catalog IDs from all confirmed local publications and site baseline are
excluded. GitHub release IDs are stored locally; only catalog ObjectIds are sent
to PlayBound's coveredIds field.

Publication requires PB's `{created,post}` receipt. Post must match sourceKey
`nucleas:roundup:<key>`, exact copy, coverage boundaries, game IDs, and company
origin, and include a non-null publishedAt. Network errors, malformed receipts,
HTTP errors and interrupted calls remain uncertain. The stable UUID and frozen
copy allow reconciliation without duplicate posts. Coverage is read exclusively
from confirmed published snapshots; rejected or uncertain snapshots never advance it.

Single bounded `askEngine` call, level free, no tools; 45-second model timeout.
Missing/invalid/incomplete model output yields a linked deterministic draft and
visible warning. Repository failures and source-bound overflows fail the draft
without silently advancing coverage. First-published catalog detection is limited
by the site's latest-published timestamps; the site limitations remain visible.

The partial unique active-company index is established before generation.
Workers use expiring leases and token-fenced writes. Tests mock persistence,
GitHub/site requests and AI; they do not connect to live databases or models.

Run `npx vitest run src/lib/roundups` and `npx tsc --noEmit`.
