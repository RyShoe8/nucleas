import { describe, expect, it } from 'vitest';
import { emptyRules, lookalikeOf, triageMessage, type TriageContext } from './triage';
import type { ParsedMessage } from './gmailParse';

const base = (over: Partial<ParsedMessage> = {}): ParsedMessage => ({
  gmailId: 'm', threadId: 't', internalDate: new Date(), from: { name: 'Jane', email: 'jane@acme.com' }, to: [{ name: '', email: 'me@playbound.club' }], cc: [],
  subject: 'Question about the launch', snippet: '', bodyText: 'Hi, can we talk about the launch?', bodyHtml: '', labels: ['INBOX'], unread: true, starred: false, inInbox: true, sent: false, trashed: false,
  attachments: [], auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' }, bulk: false, ...over,
});
const ctx = (over: Partial<TriageContext> = {}): TriageContext => ({
  ownAddresses: new Set(['me@playbound.club']), knownContacts: new Set(), knownDomains: new Set(['playbound.club', 'acme.com']), priorFromSender: 0, rules: emptyRules(), threadHasOurReply: false, ...over,
});

describe('triageMessage: keeping real mail', () => {
  it('puts a direct message from someone we have written to at the top of the main box', () => {
    const r = triageMessage(base({ from: { name: 'Bob', email: 'bob@client.org' } }), ctx({ knownContacts: new Set(['bob@client.org']), priorFromSender: 4 }));
    expect(r.bucket).toBe('important');
    expect(r.reasons[0]).toContain('written to');
  });

  it('keeps mail from our own clients’ domains and conversations we are in', () => {
    expect(triageMessage(base(), ctx()).bucket).toBe('normal');
    expect(triageMessage(base({ from: { name: 'Zed', email: 'zed@random.io' } }), ctx({ threadHasOurReply: true })).bucket).toBe('normal');
  });

  it('never triages our own sent mail away', () => {
    expect(triageMessage(base({ sent: true, labels: ['SENT'] }), ctx()).bucket).toBe('normal');
  });
});

describe('triageMessage: identity and look-alikes', () => {
  it('flags a forged known contact as suspicious even though they are trusted', () => {
    const r = triageMessage(base({ from: { name: 'Bob', email: 'bob@client.org' }, auth: { spf: 'fail', dkim: 'none', dmarc: 'fail' } }), ctx({ knownContacts: new Set(['bob@client.org']) }));
    expect(r.bucket).toBe('suspicious');
    expect(r.reasons[0]).toContain('Pretends to be someone you write to');
  });

  it('catches a look-alike of our domain and a spoofed display name', () => {
    expect(lookalikeOf('playb0und.club', new Set(['playbound.club']))).toBe('playbound.club');
    expect(lookalikeOf('acme.com', new Set(['acme.com']))).toBeNull();
    const r = triageMessage(base({ from: { name: 'Jane', email: 'jane@playb0und.club' }, bodyText: 'Verify your account now: https://x.test/login', auth: { spf: 'softfail', dkim: 'none', dmarc: 'fail' } }), ctx());
    expect(r.bucket).toBe('suspicious');
    expect(r.reasons.join(' ')).toContain('looks like playbound.club');
    const spoof = triageMessage(base({ from: { name: 'support@paypal.com', email: 'x@mailer.biz' }, auth: { spf: 'fail', dkim: 'fail', dmarc: 'fail' } }), ctx());
    expect(spoof.bucket).toBe('suspicious');
    expect(spoof.reasons.join(' ')).toContain('paypal.com');
  });

  it('treats risky attachments and urgent wording with shorteners as dangerous', () => {
    const r = triageMessage(base({ from: { name: 'Billing', email: 'billing@unknown-corp.biz' }, subject: 'INVOICE OVERDUE!!!', bodyText: 'Invoice overdue, account will be suspended. Pay at https://bit.ly/abc', attachments: [{ filename: 'invoice.exe', mimeType: 'application/octet-stream', size: 1, attachmentId: 'a', inline: false }], auth: { spf: 'none', dkim: 'none', dmarc: 'none' } }), ctx());
    expect(r.bucket).toBe('suspicious');
  });
});

describe('triageMessage: automated, promotional and cold mail', () => {
  it('files newsletters and notifications away from the main box', () => {
    const news = triageMessage(base({ from: { name: 'Shop', email: 'news@shop.com' }, bulk: true, subject: '50% off everything this weekend', bodyText: 'Sale! Unsubscribe here', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }), ctx());
    expect(news.bucket).toBe('promotions');
    const receipt = triageMessage(base({ from: { name: 'Stripe', email: 'receipts@stripe.com' }, bulk: true, subject: 'Your receipt', bodyText: 'Payment received', labels: ['INBOX', 'CATEGORY_UPDATES'] }), ctx());
    expect(receipt.bucket).toBe('updates');
    expect(triageMessage(base({ from: { name: '', email: 'noreply@github.com' }, subject: 'New sign-in' }), ctx()).bucket).toBe('updates');
  });

  it('sends cold sales outreach from strangers to promotions', () => {
    const r = triageMessage(base({ from: { name: 'Sam', email: 'sam@growthseo.io' }, subject: 'Quick question', bodyText: 'I came across your website and we offer SEO services and link building. Can we schedule a quick call?' }), ctx());
    expect(r.bucket).toBe('promotions');
    expect(r.reasons[0]).toContain('Cold outreach');
  });

  it('leaves an unremarkable first-time sender in the main box', () => {
    const r = triageMessage(base({ from: { name: 'Pat', email: 'pat@smallbiz.net' }, subject: 'Interested in your game servers', bodyText: 'Hi, how do I join the OpenRA server?' }), ctx());
    expect(r.bucket).toBe('normal');
  });
});

describe('triageMessage: what you taught it', () => {
  it('always lets an allowed sender through, even from a bulk sender, and always blocks a blocked domain', () => {
    const rules = emptyRules();
    rules.allowSenders.add('news@shop.com');
    expect(triageMessage(base({ from: { name: 'Shop', email: 'news@shop.com' }, bulk: true, labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }), ctx({ rules })).bucket).toBe('normal');
    const blocked = emptyRules();
    blocked.blockDomains.add('annoying.io');
    const r = triageMessage(base({ from: { name: 'A', email: 'hello@annoying.io' } }), ctx({ rules: blocked }));
    expect(r).toMatchObject({ bucket: 'suspicious', by: 'user' });
  });
});
