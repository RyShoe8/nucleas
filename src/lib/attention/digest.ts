import 'server-only';
import { randomUUID } from 'node:crypto';
import { AttentionPreference } from '@/lib/models/AttentionPreference';
import User from '@/lib/models/User';
import { loadCompanyViewer } from '@/lib/companies/companyProfile';
import { attentionFor } from './service';
import { sendEmail } from '@/lib/services/email';
import type { AttentionItem } from './types';
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function digestContent(items: AttentionItem[]) {
  const companies = [...new Set(items.map(i => i.companyName))];
  const groups = companies.map(name => ({ name, items: items.filter(i => i.companyName === name) }));
  return {
    subject: `Nucleas · ${items.length} item${items.length === 1 ? '' : 's'} need your attention`,
    html: `<div style="font-family:Arial,sans-serif;color:#173b2e;max-width:720px"><h1>Your team needs you</h1><p>Everything currently waiting for you. Completed items are removed from your next summary.</p>${groups.map(g => `<h2>${escape(g.name)}</h2><ul>${g.items.map(i => `<li style="margin-bottom:18px"><a href="${escape(i.href)}">${escape(i.title)}</a><br><strong>${escape(i.employeeName)}</strong> · ${escape(i.detail)}</li>`).join('')}</ul>`).join('')}<p>Change email frequency in the Nucleas taskbar notification menu. <a href="https://nucleas.app/os/desktop?module=attention">Notification settings</a></p></div>`,
    text: `Your team needs you\n\n${groups.map(g => `${g.name}\n${g.items.map(i => `${i.title}\n${i.employeeName}: ${i.detail}\n${i.href}`).join('\n\n')}`).join('\n\n')}\n\nSettings: https://nucleas.app/os/desktop?module=attention`,
  };
}
/** Atomic leases prevent concurrent cron deliveries. Only successful sends advance lastDigestAt. */
export async function sendDueAttentionDigests(now = new Date(), send = sendEmail) {
  let sent = 0, checked = 0;
  const seen: unknown[] = [];
  for (let n = 0; n < 25; n++) {
    const token = randomUUID();
    const pref = await AttentionPreference.findOneAndUpdate({ _id: { $nin: seen }, intervalMinutes: { $gt: 0 }, nextDigestAt: { $lte: now }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] }, { $set: { leaseToken: token, leaseUntil: new Date(now.getTime() + 5 * 60_000) } }, { new: true }).lean();
    if (!pref) break;
    seen.push(pref._id); checked++;
    try {
      const viewer = await loadCompanyViewer(String(pref.userId));
      const user = await User.findById(pref.userId).select('email').lean();
      if (!viewer || !user || String(viewer.organizationId) !== String(pref.organizationId)) {
        await AttentionPreference.updateOne({ _id: pref._id, leaseToken: token }, { $set: { intervalMinutes: 0 }, $unset: { leaseToken: '', leaseUntil: '' } });
        continue;
      }
      const items = await attentionFor(viewer);
      // A preference changed while collecting is not permission to send at the old frequency.
      if (!await AttentionPreference.exists({ _id: pref._id, leaseToken: token, intervalMinutes: pref.intervalMinutes, updatedAt: pref.updatedAt })) {
        await AttentionPreference.updateOne({ _id: pref._id, leaseToken: token }, { $unset: { leaseToken: '', leaseUntil: '' } });
        continue;
      }
      if (items.length) { await send({ to: user.email, ...digestContent(items) }); sent++; }
      await AttentionPreference.updateOne({ _id: pref._id, leaseToken: token }, { $set: { nextDigestAt: new Date(now.getTime() + pref.intervalMinutes * 60_000), ...(items.length ? { lastDigestAt: now } : {}) }, $unset: { leaseToken: '', leaseUntil: '' } });
    } catch (error) {
      await AttentionPreference.updateOne({ _id: pref._id, leaseToken: token }, { $set: { nextDigestAt: new Date(now.getTime() + 10 * 60_000) }, $unset: { leaseToken: '', leaseUntil: '' } });
      console.error('[attention] digest failed', error instanceof Error ? error.message : 'unknown');
    }
  }
  return { checked, sent };
}
