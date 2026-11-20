import 'server-only';
import { Types } from 'mongoose';
import User from '@/lib/models/User';

/** People in the organization, for choosing who a publishing job tells. */
export async function listOrgPeople(organizationId: Types.ObjectId): Promise<{ userId: string; name: string; email: string }[]> {
  const rows = await User.find({ organizationId: String(organizationId) }).select('name email').sort({ name: 1 }).limit(200).lean<{ _id: Types.ObjectId; name?: string; email?: string }[]>();
  return rows.filter((r) => r.email).map((r) => ({ userId: String(r._id), name: r.name?.trim() || r.email!, email: r.email! }));
}

/** Only ids of people in the organization survive. Company access is also checked by Attention. */
export async function keepOrgPeople(organizationId: Types.ObjectId, userIds: string[]): Promise<string[]> {
  const ids = [...new Set(userIds)].filter((id) => Types.ObjectId.isValid(id));
  if (!ids.length) return [];
  const rows = await User.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, organizationId: String(organizationId) }).select('_id').lean<{ _id: Types.ObjectId }[]>();
  const found = new Set(rows.map((r) => String(r._id)));
  return ids.filter((id) => found.has(id));
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Notice {
  subject: string;
  intro: string;
  lines: string[];
  action: string;
}

export function noticeEmail(notice: Notice, name: string | null, link: string, footer: string): { html: string; text: string } {
  const greeting = name ? `Hi ${name.split(/\s+/)[0]},` : 'Hi,';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">
<p>${escape(greeting)}</p>
<p>${escape(notice.intro)}</p>
${notice.lines.length ? `<ul>${notice.lines.map((l) => `<li>${escape(l)}</li>`).join('')}</ul>` : ''}
<p><a href="${escape(link)}" style="display:inline-block;background:#347AF6;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px">${escape(notice.action)}</a></p>
<p style="color:#666;font-size:12px">${escape(footer)}</p>
</div>`;
  const text = [greeting, '', notice.intro, ...notice.lines.map((l) => `- ${l}`), '', `${notice.action}: ${link}`].join('\n');
  return { html, text };
}

export type SendFn = (to: string, subject: string, body: { html: string; text: string }) => Promise<void>;
