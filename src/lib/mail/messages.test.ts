import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/models/Mail', () => ({ MailAccount: {}, MailMessage: {}, MailRule: {} }));
vi.mock('./accounts', () => ({ apiForAccount: vi.fn(), canUseMail: () => true, MAIL_FORBIDDEN: 'x', mailStoreFor: vi.fn() }));

import { actionPlan, threadFilter, threadPipeline } from './messages';

const org = new Types.ObjectId();

describe('what each place in Mail shows', () => {
  it('keeps the main box to important and normal mail; other places show their own bucket', () => {
    expect(threadFilter(org, { view: 'inbox' })).toMatchObject({ inInbox: true, trashed: false, 'triage.bucket': { $in: ['important', 'normal'] } });
    expect(threadFilter(org, { view: 'unread' })).toMatchObject({ unread: true, 'triage.bucket': { $in: ['important', 'normal'] } });
    expect(threadFilter(org, { view: 'suspicious' })).toMatchObject({ inInbox: true, 'triage.bucket': 'suspicious' });
    expect(threadFilter(org, { view: 'promotions' })).toMatchObject({ 'triage.bucket': 'promotions' });
    // Starred and All are not filtered by triage: anything you starred is yours.
    expect(threadFilter(org, { view: 'starred' })).not.toHaveProperty('triage.bucket');
  });

  it('narrows by mailbox, by company mailboxes, by search and by date', () => {
    const a = new Types.ObjectId().toHexString();
    expect(threadFilter(org, { accountId: a }).accountId).toEqual(new Types.ObjectId(a));
    const b = new Types.ObjectId().toHexString();
    expect((threadFilter(org, { companyAccountIds: [a, b, 'bad'] }).accountId as { $in: unknown[] }).$in).toHaveLength(2);
    expect(threadFilter(org, { q: '  invoice  ' }).$text).toEqual({ $search: 'invoice' });
    expect(threadFilter(org, { before: '2025-01-01T00:00:00Z' }).internalDate).toEqual({ $lt: new Date('2025-01-01T00:00:00Z') });
    expect(threadFilter(org, { before: 'garbage' })).not.toHaveProperty('internalDate');
  });

  it('groups messages into conversations, newest first, capped', () => {
    const stages = threadPipeline({ a: 1 }, 500);
    expect(stages.map((s) => Object.keys(s)[0])).toEqual(['$match', '$sort', '$group', '$sort', '$limit']);
    expect(stages.at(-1)).toEqual({ $limit: 100 });
  });
});

describe('actions', () => {
  it('maps each action to the Gmail label change and the local change', () => {
    expect(actionPlan('read')).toMatchObject({ remove: ['UNREAD'], local: { unread: false }, latestOnly: false });
    expect(actionPlan('archive')).toMatchObject({ remove: ['INBOX'], local: { inInbox: false } });
    expect(actionPlan('star')).toMatchObject({ add: ['STARRED'], latestOnly: true });
    expect(actionPlan('trash')).toMatchObject({ trash: true, local: { trashed: true, inInbox: false } });
  });
});
