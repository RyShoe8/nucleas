import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ThreadList from './ThreadList';
import MessageBody from './MessageBody';
import { shortDate, type Account, type ThreadSummary } from './types';

const account: Account = { id: 'a1', emailAddress: 'support@playbound.club', label: 'Support', color: '', companyId: 'c1', companyName: 'Playbound', unread: 2, lastSyncAt: null, lastSyncOk: true, lastSyncError: null, needsReauth: false };
const thread = (over: Partial<ThreadSummary> = {}): ThreadSummary => ({ id: 't1', accountId: 'a1', threadId: 'th1', subject: 'Server down?', snippet: 'Is the OpenRA server up', from: { name: 'Jane Doe', email: 'jane@x.com' }, date: new Date().toISOString(), unread: true, starred: false, count: 3, hasAttachments: true, aiSummary: null, triage: null, ...over });

describe('mail list', () => {
  it('shows sender, subject, mailbox, company, count and the attachment mark', () => {
    const html = renderToStaticMarkup(<ThreadList threads={[thread()]} accounts={[account]} selectedId={null} onSelect={() => {}} onStar={() => {}} loading={false} onMore={() => {}} hasMore={false} empty="none" />);
    expect(html).toContain('Jane Doe');
    expect(html).toContain('(3)');
    expect(html).toContain('Server down?');
    expect(html).toContain('Support');
    expect(html).toContain('Playbound');
    expect(html).toContain('📎');
  });

  it('says why a filtered conversation is not in the inbox', () => {
    const html = renderToStaticMarkup(<ThreadList threads={[thread({ triage: { bucket: 'suspicious', risk: 90, reasons: ['The domain playb0und.club looks like playbound.club.'] } })]} accounts={[account]} selectedId={null} onSelect={() => {}} onStar={() => {}} loading={false} onMore={() => {}} hasMore={false} empty="none" />);
    expect(html).toContain('looks like playbound.club');
  });

  it('has empty and loading states', () => {
    const render = (threads: ThreadSummary[] | null) => renderToStaticMarkup(<ThreadList threads={threads} accounts={[]} selectedId={null} onSelect={() => {}} onStar={() => {}} loading={false} onMore={() => {}} hasMore={false} empty="Inbox clear" />);
    expect(render([])).toContain('Inbox clear');
    expect(render(null)).toContain('Loading');
  });
});

describe('message body', () => {
  it('shows HTML mail in a frame that cannot run scripts, and plain text as text', () => {
    const framed = renderToStaticMarkup(<MessageBody html="<p>Hi</p>" text="Hi" />);
    expect(framed).toContain('<iframe');
    expect(framed).toContain('sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    expect(framed).not.toContain('allow-scripts');
    expect(framed).toContain('Content-Security-Policy');
    expect(renderToStaticMarkup(<MessageBody html="" text="Plain <b>text</b>" />)).toContain('Plain &lt;b&gt;text&lt;/b&gt;');
  });

  it('formats dates compactly', () => {
    expect(shortDate(new Date(Date.now() - 400 * 86400000).toISOString())).toMatch(/\d/);
  });
});
