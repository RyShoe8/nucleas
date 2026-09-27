# Nucleas OS: Phase 0 pilot inventory

September 27, 2026. A read-only snapshot of the production database, taken for [the architecture plan](NUCLEAS_OS_ARCHITECTURE_PLAN.md).

## Tenancy

| Organization | Notes |
|---|---|
| The Media Shop (`themediashop.co`) | Operating organization; owns all properties and clients below |
| Henry Kubik-Jones | Separate tenant (not part of pilot) |
| autodemo | Separate tenant (not part of pilot) |

## Existing Clients (relationship = client)

Senior By Design, EL Cinema, Boarding School Review, CRN, Hearth. Each has a `client-admin` hub project. None has a domain or stack recorded on the Client document.

## Top-level property projects (conversion candidates)

| Project | Domain | Recorded marketing stack | Recorded tech stack | Tasks | Notes |
|---|---|---|---|---|---|
| **Frugal Gambler** (pilot) | frugalgambler.club | brevo, googleanalytics | cloudflare, googlecloud, mongodb | 41 | |
| **Playbound.club** (pilot) | none recorded | googleanalytics, brevo | vercel, render, mongodb | 1 | `projectType: client` with no Client; no URL recorded |
| Nucleas | nucleas.app | brevo, googleanalytics, tailnote, posthog | vercel, mongodb | 56 | |
| Tailnote | tailnote.io | brevo, googleanalytics, posthog | vercel, mongodb | 17 | Has free-plan Users (lifecycle stage) |
| The Ad Shop | theadshop.co | brevo, googleanalytics | vercel, render, mongodb | 14 | |
| Connect Pay | connectpay.club | none | none | 24 | |
| The Media Shop | themediashop.co | brevo, googleanalytics | vercel, mongodb | 3 | Same business as the operating organization |
| Content Intelligence | none | brevo, googleanalytics | vercel, render, mongodb | 1 | |
| Retro Sports League | none | none | none | 0 | |
| Home End | none | none | none | 1 | |
| Auto Demo | autodemo-seven.vercel.app | none | vercel, mongodb, render | 3 | A separate `autodemo` organization also exists |
| Project Ideas | none | none | none | 2 | Likely not a business |

Other data: 39 content items, 26 meetings, 16 assets, 103 AI runs, 9 repository bindings, 0 AI objectives.

## Gaps against the confirmed stack

Ryan confirmed that every property uses GA4, Search Console, Brevo and Stripe. The recorded stacks omit **Stripe and Search Console everywhere**, and some properties record nothing. The integration backfill (Phase 1) therefore declares GA4 + GSC + Brevo + Stripe for every converted property, plus whatever else is recorded, and marks each one `declared` until connected.

## Dry-run result

`npx tsx --conditions=react-server scripts/convert-owned-companies.ts` planned `create_company_and_attach` for all 12 candidates and wrote nothing. The only side effect was the sparse `clients.hubProjectId_1` index, built by Mongoose autoIndex on the first run. The script now disables autoIndex for dry runs.

## Conversion applied (2026-09-27)

Confirmed by Ryan. 10 companies were created and linked. Result: `created 10, attached 10`. A second run reported `unchanged 10`.

| Company | Relationship | Domain |
|---|---|---|
| Frugal Gambler, Playbound.club, Nucleas, Tailnote, Connect Pay, Home End | owned (core businesses) | frugalgambler.club, playbound.club, nucleas.app, tailnote.io, connectpay.club, none |
| Auto Demo, Content Intelligence, The Ad Shop | owned (standalone for now; planned to become Nucleas capabilities) | autodemo-seven.vercel.app, none, theadshop.co |
| The Media Shop | internal (operating company) | themediashop.co |

Not converted: Retro Sports League (on hold; may merge into PlayBound or become a game on it) and Project Ideas.

Verification: 15 Clients (5 legacy + 10 new), 15 projects linked with no orphan links, and all 178 tasks still present.
