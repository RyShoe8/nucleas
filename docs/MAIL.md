# Mail (unified Gmail inbox)

All connected Gmail mailboxes in one inbox (Mail window). Managers and administrators only. A synced copy of each mailbox is kept in Nucleas's database (the last 30 days on first connect, then incremental via Gmail's history API every 5 minutes and on "Sync now"). Disconnecting a mailbox deletes its copy; Gmail itself is never changed by disconnecting.

## Google setup (once)

1. Google Cloud console → the project behind `GOOGLE_CLIENT_ID`: enable the **Gmail API**.
2. OAuth consent screen → add scopes `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/gmail.send`.
3. Credentials → the OAuth client → add the authorized redirect URI `https://os.nucleas.app/api/os/mail/google/callback` (and `https://nucleas.app/...` if used).
4. **Publishing status matters.** In *Testing*, Google expires refresh tokens after 7 days (mailboxes keep needing to be reconnected). Set the app to **In production**. Without Google's verification, sign-in shows an "unverified app" warning (Advanced → continue) and is limited to 100 users: fine for your own and your clients' mailboxes. Google requires a security assessment only to lift that limit. Workspace admins can also allow the app for their domain. Each client mailbox must approve the permissions when you connect it.

`CRON_SECRET` protects `/api/cron/mail-sync` (already in `vercel.json`, every 5 minutes).

## Spam: what keeps the main box clean

Every incoming message is triaged into **Important / Normal** (the main box), **Updates**, **Promotions** or **Suspicious**; nothing is deleted, every place is one click away, and each message shows why it was put there.

- Mail from people you have written to, from your own and your clients' domains, and in conversations you are in, stays in the main box, unless the sender fails authentication (a forged known contact is filed as Suspicious).
- Signals: SPF/DKIM/DMARC results, look-alike domains (`playb0und.club`), display-name spoofing, mismatched reply-to/return-path, urgent account/payment wording with links, link shorteners, executable attachments; bulk headers and Gmail's own categories for newsletters and notifications; cold sales outreach from strangers.
- You teach it: **Spam** files the conversation as spam in Gmail and blocks the sender or domain; **Not spam** brings everything from that sender back and allows them from now on; **Move to** puts one conversation where you want it. Your decisions always beat the rules.
- Uncertain mail gets an AI second opinion (see below).

## AI help

- **Summarize** (2-4 sentences, cached and shown in the list), **Draft reply** (written into the reply box; optionally with your instruction; never sent automatically) and **Make a job** (the conversation becomes a request that the normal job designer takes over; needs a company, defaulting to the mailbox's) use the AI engine's normal models and cost level.
- **Second opinion on spam:** messages the rules flag as uncertain are looked at by a free model right after each sync. It must be 85% sure to call something suspicious and 60% sure to move anything else; a decision you made is never overwritten. Real customers asking genuine questions are never suspicious.
- Email is untrusted text written by strangers: every prompt says it is data and to ignore instructions inside it, and model output is only ever shown to a person or used to file a message.
