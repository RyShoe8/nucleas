# Google Analytics, Search Console + AdSense connection setup

The OS connects GA4 and Search Console with one Google sign-in per Google account. It reuses the existing OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), so **no new environment variables** are needed. It does need three one-time settings in Google Cloud Console.

## 1. Authorized redirect URIs

**APIs & Services → Credentials → your OAuth 2.0 Client ID → Authorized redirect URIs**, add:

| Environment | URI |
|---|---|
| Production | `https://os.nucleas.app/api/os/integrations/google/callback` |
| Local dev | `http://os.localhost:3000/api/os/integrations/google/callback` |

The callback must be on the host where you're signed in (the session cookie is host-only), which is why it's on `os.`.

## 2. Enable APIs

**APIs & Services → Library**, enable:

- Google Analytics Admin API (lists properties and their web streams)
- Google Analytics Data API (reports, used from Phase 2)
- Google Search Console API
- AdSense Management API

## 3. OAuth consent screen scopes

Add:

- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/webmasters.readonly`
- `https://www.googleapis.com/auth/adsense.readonly`

Both are read-only. They count as "sensitive" scopes. For our own Google accounts, testing mode (or an unverified app with a warning screen) is fine. Before client accounts connect, the app needs Google verification.

## How matching works

After sign-in, Nucleas lists every GA4 property (via its web stream URLs) and Search Console site the Google account can see, and connects each company whose **production domain** matches. It prefers `sc-domain:` Search Console properties. When a domain matches more than one GA4 property, it doesn't guess. Unmatched companies keep their status, with a note explaining why. One encrypted refresh token is stored per Google account, and signing in again rotates it.

## AdSense

After signing in, every company whose production domain is a site in a visible AdSense account gets AdSense connected and pinned to that site. Reports are always filtered to that domain (`DOMAIN_NAME==<domain>`), because one AdSense account usually serves several sites. This is the same approach The Ad Shop uses. Anyone who signed in before AdSense was added must sign in with Google once more to grant it.

## Client-owned accounts

Each Google sign-in is stored separately (by account email), and each company is pinned to a resource plus the Google account that can see it. A client's own GA4, Search Console or AdSense works either way:

1. **Preferred:** the client adds our Google account as a read-only user on their property or AdSense account. Our next sign-in sees it and matches it by domain.
2. The client (or we, with their consent) signs in with their Google account. It is stored as a separate account and never mixed with ours.

The planned onboarding flow (Phase 8) adds a one-time connect link the client opens themselves, so no credentials are ever shared.


## Google Ad Manager / AdX

In the company's Connections and setup, add **Google Ad Manager / AdX**, then use its **Sign in with Google** button. This specifically requests the additional `https://www.googleapis.com/auth/admanager` permission. Ordinary Analytics/Search Console sign-in does not add this scope.

One-time Google setup uses the existing OAuth client; no new environment variables:
- Enable **Ad Manager API** (`admanager.googleapis.com`) in that Google Cloud project.
- Add the Ad Manager scope to the OAuth consent screen.
- Enable API access in the Ad Manager network and give the Google user access to reports and the relevant sites.
- The canonical production callback is `https://nucleas.app/api/os/integrations/google/callback`. Keep older callback URLs only where still used.

Google's readonly scope can run existing reports, but creating a reporting definition requires the full Ad Manager scope. Nucleas creates hidden reporting definitions and reads results. It exposes no ad-trafficking, budget, or campaign-edit capabilities for this connection.

Nucleas lists networks and sites with pagination, auto-pins only unambiguous exact domain matches, respects disabled connections and existing pins, and allows manual site selection. Each report filters the pinned site's domain (including its www variant) and verifies returned rows are within that domain and date range. A whole-network total is never substituted for a company's data.

The three metrics are **AdX revenue**, **AdX impressions**, and **AdX clicks**. These use AD_EXCHANGE_* columns, not total ad-server revenue. AdSense remains separate; total revenue includes both distinct sources. Monetary results carry network currency and report receipts carry network timezone. Historical results can be revised by Google.

The normal metric cron backfills 90 days on the first successful report and refreshes three days afterward. Report operations are persisted under tenant/company/site/date scope with a lease. Slow reports resume on subsequent syncs; failures do not write zero snapshots. Report definitions are reused for identical ranges. Reconnect Google for accounts authorized before this connector was added, select a site if automatic matching cannot decide, then run **Sync now**.

Official references:
- https://developers.google.com/ad-manager/api/beta/authentication
- https://developers.google.com/ad-manager/api/beta/reports
- https://developers.google.com/ad-manager/api/beta/reference/rest/v1/networks.reports/create
- https://developers.google.com/ad-manager/api/beta/reference/rest/v1/networks.reports/run
