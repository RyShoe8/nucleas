import 'server-only';
import { Types } from 'mongoose';
import User from '@/lib/models/User';
import { sendEmail } from '@/lib/services/email';

/** People in the organization, for choosing who a publishing job tells. */
export async function listOrgPeople(organizationId: Types.ObjectId): Promise<{ userId: string; name: string; email: string }[]> {
  const rows = await User.find({ organizationId: String(organizationId) }).select('name email').sort({ name: 1 }).limit(200).lean<{ _id: Types.ObjectId; name?: string; email?: string }[]>();
  return rows.filter((r) => r.email).map((r) => ({ userId: String(r._id), name: r.name?.trim() || r.email!, email: r.email! }));
}

/** Only ids of people in the organization survive, so a job can never email outsiders. */
export async function keepOrgPeople(organizationId: Types.ObjectId, userIds: string[]): Promise<string[]> {
  const ids = [...new Set(userIds)].filter((id) => Types.ObjectId.isValid(id));
  if (!ids.length) return [];
  const rows = await User.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, organizationId: String(organizationId) }).select('_id').lean<{ _id: Types.ObjectId }[]>();
  const found = new Set(rows.map((r) => String(r._id)));
  return ids.filter((id) => found.has(id));
}

export function marketingLink(): string {
  return `${(process.env.NUCLEAS_OS_URL?.trim() || 'https://os.nucleas.app').replace(/\/$/, '')}/?open=marketing`;
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Notice {
  subject: string;
  intro: string;
  lines: string[];
  action: string;
}

export function noticeEmail(notice: Notice, name: string | null, link: string): { html: string; text: string } {
  const greeting = name ? `Hi ${name.split(/\s+/)[0]},` : 'Hi,';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">
<p>${escape(greeting)}</p>
<p>${escape(notice.intro)}</p>
${notice.lines.length ? `<ul>${notice.lines.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>` : ''}
<p><a href="${escape(link)}" style="display:inline-block;background:#347AF6;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px">${escape(notice.action)}</a></p>
<p style="color:#666;font-size:12px">You get these because you are on this job's notify list in Nucleas.</p>
</div>`;
  const text = [greeting, '', notice.intro, ...notice.lines.map((l) => `- ${l}`), '', `${notice.action}: ${link}`].join('\n');
  return { html, text };
}

export type SendFn = (to: string, subject: string, body: { html: string; text: string }) => Promise<void>;

const sendViaBrevo: SendFn = (to, subject, body) => sendEmail({ to, subject, html: body.html, text: body.text });

/** Emails the job's notify list. A failed email is logged, never fatal to the run. */
export async function notifyPeople(organizationId: Types.ObjectId, userIds: string[], notice: Notice, send: SendFn = sendViaBrevo): Promise<number> {
  const ids = await keepOrgPeople(organizationId, userIds);
  if (!ids.length) return 0;
  const people = await User.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).select('name email').lean<{ name?: string; email?: string }[]>();
  let sent = 0;
  for (const person of people) {
    if (!person.email) continue;
    try {
      await send(person.email, notice.subject, noticeEmail(notice, person.name ?? null, marketingLink()));
      sent += 1;
    } catch (error) {
      console.error('[publishing] notify failed', error instanceof Error ? error.message : 'unknown');
    }
  }
  return sent;
}
