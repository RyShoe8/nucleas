import 'server-only';
import { Types } from 'mongoose';
import { MailAccount, MailMessage, MailRule } from '@/lib/models/Mail';
import Client from '@/lib/models/Client';
import { emptyRules, triageMessage, type TriageContext, type TriageResult } from './triage';
import type { ParsedMessage } from './gmailParse';
import type { MailStore } from './syncEngine';

/** Free-mail providers say nothing about who the sender works for, so their domains are never "known domains". */
const FREE = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com']);

export interface OrgTriageData {
  ownAddresses: Set<string>;
  knownContacts: Set<string>;
  knownDomains: Set<string>;
  rules: TriageContext['rules'];
}

/** What triage needs to know about an organization, loaded once per sync: who we write to, our domains, the rules taught. */
export async function loadOrgTriageData(organizationId: Types.ObjectId, extraDomains: string[] = []): Promise<OrgTriageData> {
  const [companyDomains, accounts, sentTo, rules] = await Promise.all([
    Client.find({ organizationId, domain: { $exists: true, $ne: '' } }).select('domain').lean<{ domain?: string }[]>().catch(() => [] as { domain?: string }[]),
    MailAccount.find({ organizationId }).select('emailAddress').lean<{ emailAddress: string }[]>(),
    MailMessage.aggregate<{ _id: string }>([
      { $match: { organizationId, sent: true } },
      { $sort: { internalDate: -1 } },
      { $limit: 5000 },
      { $unwind: '$to' },
      { $group: { _id: '$to.email' } },
      { $limit: 5000 },
    ]),
    MailRule.find({ organizationId }).select('kind type value').lean<{ kind: 'allow' | 'block'; type: 'sender' | 'domain'; value: string }[]>(),
  ]);
  const ownAddresses = new Set(accounts.map((a) => a.emailAddress.toLowerCase()));
  const knownContacts = new Set(sentTo.map((r) => r._id?.toLowerCase()).filter((e): e is string => Boolean(e) && !ownAddresses.has(e)));
  const domains = new Set<string>([...extraDomains, ...companyDomains.map((c) => c.domain ?? '')].map((d) => d.toLowerCase().replace(/^www\./, '')).filter(Boolean));
  for (const address of [...ownAddresses, ...knownContacts]) {
    const d = address.split('@')[1];
    if (d && !FREE.has(d)) domains.add(d);
  }
  const r = emptyRules();
  for (const rule of rules) (rule.kind === 'allow' ? (rule.type === 'sender' ? r.allowSenders : r.allowDomains) : rule.type === 'sender' ? r.blockSenders : r.blockDomains).add(rule.value);
  return { ownAddresses, knownContacts, knownDomains: domains, rules: r };
}

/** The store the sync writes through: every incoming message is triaged on its way in, and a person's own decision is never overwritten. */
export function triagingStore(organizationId: Types.ObjectId, accountId: Types.ObjectId, data: OrgTriageData): MailStore {
  return {
    async upsert(m: ParsedMessage) {
      const { gmailId, ...fields } = m;
      const existing = await MailMessage.findOne({ organizationId, accountId, gmailId }).select('triage').lean<{ triage?: { by?: string; bucket?: string } }>();
      const set: Record<string, unknown> = { ...fields, organizationId, accountId, gmailId };
      // A decision by the person or by the AI second opinion stands; the rules only decide new messages.
      if (existing?.triage?.by === 'user' || existing?.triage?.by === 'ai') {
        // keep as is
      } else {
        const [prior, ours] = await Promise.all([
          m.from.email ? MailMessage.countDocuments({ organizationId, 'from.email': m.from.email, gmailId: { $ne: gmailId } }) : 0,
          MailMessage.exists({ organizationId, accountId, threadId: m.threadId, sent: true }),
        ]);
        const result: TriageResult = triageMessage(m, { ...data, priorFromSender: prior, threadHasOurReply: Boolean(ours) });
        set.triage = { bucket: result.bucket, risk: result.risk, reasons: result.reasons, by: 'rules', uncertain: result.uncertain };
      }
      await MailMessage.updateOne({ organizationId, accountId, gmailId }, { $set: set }, { upsert: true });
    },
    async remove(ids: string[]) {
      if (ids.length) await MailMessage.deleteMany({ organizationId, accountId, gmailId: { $in: ids } });
    },
  };
}
