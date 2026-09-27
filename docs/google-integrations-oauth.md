# Google Analytics + Search Console connection setup

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

## 3. OAuth consent screen scopes

Add:

- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/webmasters.readonly`

Both are read-only. They count as "sensitive" scopes. For our own Google accounts, testing mode (or an unverified app with a warning screen) is fine. Before client accounts connect, the app needs Google verification.

## How matching works

After sign-in, Nucleas lists every GA4 property (via its web stream URLs) and Search Console site the Google account can see, and connects each company whose **production domain** matches. It prefers `sc-domain:` Search Console properties. When a domain matches more than one GA4 property, it doesn't guess. Unmatched companies keep their status, with a note explaining why. One encrypted refresh token is stored per Google account, and signing in again rotates it.
