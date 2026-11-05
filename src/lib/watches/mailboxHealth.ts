import 'server-only';
import { Types } from 'mongoose';
import { Job } from '@/lib/models/Job';
import User from '@/lib/models/User';
import { ContentWatch, WatchMailbox } from '@/lib/models/Watch';
import { noticeEmail, type SendFn } from '@/lib/publishing/notify';
import { GmailAuthError, refreshAccessToken } from '@/lib/mail/gmailClient';
import { openSecret, sealSecret } from '@/lib/security/secretBox';
import { sendEmail } from '@/lib/services/email';

/**
 * Keeps watched mailboxes connected, and says so when one is not. A daily token check keeps each refresh token
 * in use (Google ends tokens unused for six months) and finds a lost connection even when its watches are paused.
 * The first time a mailbox is lost, the people whose jobs depend on it get an email with a link to reconnect it.
 */

export const watchMailboxPurpose = (email: string) => `watch-mailbox:${email.toLowerCase()}`;

export function watchGoogleCredentials() {
  const clientId = process.env.GOOGLE_MAIL_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_MAIL_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured.');
  return { clientId, clientSecret };
}

const DAY_MS = 86_400_000;
const CHECK_EVERY_MS = DAY_MS;

export function reconnectLink(emailAddress: string): string {
  const base = (process.env.NUCLEAS_OS_URL?.trim() || 'https://nucleas.app').replace(/\/$/, '');
  return `${base}/api/os/content/gmail/start?email=${encodeURIComponent(emailAddress)}`;
}

/** Google ends tokens after exactly 7 days while an app's consent screen is in Testing: say so when the timing fits. */
export function disconnectMessage(reason: string, connectedAt: Date | null | undefined, now = Date.now()): string {
  const age = connectedAt ? now - connectedAt.getTime() : null;
  const looksLikeTesting = age !== null && age >= 6.5 * DAY_MS && age <= 8 * DAY_MS;
  return `${reason}${looksLikeTesting ? ' This happened about 7 days after connecting, which is what Google does while the app’s OAuth consent screen is in Testing. Publish it to Production so connections last.' : ''}`.slice(0, 400);
}

type MailboxRef = { _id: Types.ObjectId; organizationId: Types.ObjectId; emailAddress: string; connectedByUserId?: Types.ObjectId };

/** Who to tell: whoever created the jobs and watches reading this mailbox, else whoever connected it. */
async function peopleToTell(mailbox: MailboxRef): Promise<{ recipients: { name: string | null; email: string }[]; jobs: string[]; watches: string[] }> {
  const watches = await ContentWatch.find({ organizationId: mailbox.organizationId, mailboxId: mailbox._id }).select('_id name createdByUserId active').lean<{ _id: Types.ObjectId; name: string; createdByUserId: Types.ObjectId; active?: boolean }[]>();
  const jobs = await Job.find({ organizationId: mailbox.organizationId, 'publishing.source.watchId': { $in: watches.map((w) => String(w._id)) }, status: { $nin: ['rejected', 'archived', 'done'] } })
    .select('createdByUserId request design.title')
    .lean<{ createdByUserId: Types.ObjectId; request?: string; design?: { title?: string } }[]>();
  const ids = [...jobs.map((j) => String(j.createdByUserId)), ...watches.map((w) => String(w.createdByUserId))];
  if (!ids.length && mailbox.connectedByUserId) ids.push(String(mailbox.connectedByUserId));
  // Only people in this organization, so a mailbox problem can never be emailed to an outsider.
  const people = await User.find({ _id: { $in: [...new Set(ids)].map((id) => new Types.ObjectId(id)) }, organizationId: String(mailbox.organizationId) }).select('name email').lean<{ name?: string; email?: string }[]>();
  return {
    recipients: people.filter((p) => p.email).map((p) => ({ name: p.name ?? null, email: p.email! })),
    jobs: jobs.map((j) => j.design?.title || (j.request ?? '').slice(0, 80)).filter(Boolean),
    watches: watches.map((w) => w.name),
  };
}

const sendViaBrevo: SendFn = (to, subject, body) => sendEmail({ to, subject, html: body.html, text: body.text });

/** Emails once per disconnection. The time is saved only after an email went out, so a failed send is retried by the daily check. */
async function tellPeople(mailbox: MailboxRef, reason: string, send: SendFn): Promise<number> {
  const { recipients, jobs, watches } = await peopleToTell(mailbox);
  if (!recipients.length) {
    console.warn(`[watches] mailbox ${mailbox.emailAddress} needs reconnecting, but there is nobody to email`);
    return 0;
  }
  const paused = [...jobs, ...watches.filter((w) => !jobs.includes(w))];
  const notice = {
    subject: `Reconnect ${mailbox.emailAddress} in Nucleas`,
    intro: `Nucleas can no longer read ${mailbox.emailAddress}, so these are paused until it is reconnected. Nothing is lost: new mail is picked up after you reconnect, as far back as each watch looks.`,
    lines: [...paused.slice(0, 8), `Reason from Google: ${reason}`],
    action: `Reconnect ${mailbox.emailAddress}`,
  };
  let sent = 0;
  for (const person of recipients) {
    try {
      await send(person.email, notice.subject, noticeEmail(notice, person.name, reconnectLink(mailbox.emailAddress), 'You get this because you created a job or watch that reads this mailbox.'));
      sent += 1;
    } catch (error) {
      console.error(`[watches] reconnect email for ${mailbox.emailAddress} failed`, error instanceof Error ? error.message : 'unknown');
    }
  }
  if (sent) await WatchMailbox.updateOne({ _id: mailbox._id }, { $set: { reauthNotifiedAt: new Date() } });
  console.info(`[watches] mailbox ${mailbox.emailAddress} needs reconnecting: emailed ${sent} of ${recipients.length}`);
  return sent;
}

/** Marks a mailbox as needing reconnection. Only the call that changes the status sends the email. */
export async function markMailboxDisconnected(mailboxId: Types.ObjectId, reason: string, options: { send?: SendFn; now?: number } = {}): Promise<boolean> {
  const current = await WatchMailbox.findById(mailboxId).select('connectedAt').lean<{ connectedAt?: Date }>();
  const message = disconnectMessage(reason, current?.connectedAt, options.now);
  const changed = await WatchMailbox.findOneAndUpdate(
    { _id: mailboxId, status: { $ne: 'needs_reauth' } },
    { $set: { status: 'needs_reauth', lastError: message, disconnectedAt: new Date(options.now ?? Date.now()) }, $unset: { reauthNotifiedAt: '' } },
    { new: true }
  ).select('organizationId emailAddress connectedByUserId').lean<MailboxRef>();
  if (!changed) return false;
  await tellPeople(changed, message, options.send ?? sendViaBrevo).catch((error: unknown) => console.error('[watches] reconnect notice failed', error instanceof Error ? error.message : 'unknown'));
  return true;
}

export interface MailboxCheckDeps {
  refresh?: typeof refreshAccessToken;
  send?: SendFn;
  now?: number;
  limit?: number;
}

/**
 * The daily check (run from the watches cron). Uses each connected mailbox's refresh token, which also keeps it
 * from going unused, and retries reconnect emails that have not gone out. A Google outage or a server
 * misconfiguration never disconnects anything: only an answer that the grant is gone does.
 */
export async function checkMailboxConnections(deps: MailboxCheckDeps = {}): Promise<{ checked: number; disconnected: number; failed: number; emailed: number }> {
  const now = deps.now ?? Date.now();
  const refresh = deps.refresh ?? refreshAccessToken;
  const result = { checked: 0, disconnected: 0, failed: 0, emailed: 0 };
  const due = await WatchMailbox.find({ status: 'connected', $or: [{ lastTokenCheckAt: { $exists: false } }, { lastTokenCheckAt: { $lt: new Date(now - CHECK_EVERY_MS) } }] })
    .sort({ lastTokenCheckAt: 1 })
    .limit(deps.limit ?? 10)
    .select('+refreshTokenSealed organizationId emailAddress')
    .lean<(MailboxRef & { refreshTokenSealed: string })[]>();
  for (const mailbox of due) {
    const purpose = watchMailboxPurpose(mailbox.emailAddress);
    try {
      const tokens = await refresh(openSecret(purpose, mailbox.refreshTokenSealed), watchGoogleCredentials());
      result.checked += 1;
      // Google may issue a replacement refresh token; the old one then stops working.
      await WatchMailbox.updateOne({ _id: mailbox._id }, { $set: { lastTokenCheckAt: new Date(now), ...(tokens.refreshToken ? { refreshTokenSealed: sealSecret(purpose, tokens.refreshToken) } : {}) } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      if (error instanceof GmailAuthError) {
        if (await markMailboxDisconnected(mailbox._id, message, { send: deps.send, now })) result.disconnected += 1;
      } else {
        result.failed += 1;
        console.error(`[watches] token check for ${mailbox.emailAddress} failed; the mailbox stays connected: ${message}`);
      }
    }
  }
  const unnotified = await WatchMailbox.find({ status: 'needs_reauth', reauthNotifiedAt: { $exists: false } }).limit(5).select('organizationId emailAddress connectedByUserId lastError').lean<(MailboxRef & { lastError?: string })[]>();
  for (const mailbox of unnotified) {
    result.emailed += await tellPeople(mailbox, mailbox.lastError ?? 'Google access was revoked or expired.', deps.send ?? sendViaBrevo).catch(() => 0);
  }
  return result;
}
