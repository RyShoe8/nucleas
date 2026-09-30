import { describe, expect, it } from 'vitest';
import { buildRawMessage, encodeHeaderWord, replySubject } from './gmailMime';
import { decodeMimeWords, parseAddressList, parseGmailMessage, sanitizeMailHtml, type GmailMessage } from './gmailParse';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('addresses and encoded headers', () => {
  it('parses lists with quoted commas, bare addresses and encoded names', () => {
    expect(parseAddressList('"Smith, Al" <AL@z.com>, bob@y.com, =?UTF-8?B?SsO8cmdlbg==?= <j@x.de>')).toEqual([
      { name: 'Smith, Al', email: 'al@z.com' },
      { name: '', email: 'bob@y.com' },
      { name: 'Jürgen', email: 'j@x.de' },
    ]);
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
  });

  it('decodes B and Q encoded words, joining adjacent ones', () => {
    expect(decodeMimeWords('=?UTF-8?B?SGVsbG8g?= =?UTF-8?B?V29ybGQ=?=')).toBe('Hello World');
    expect(decodeMimeWords('=?ISO-8859-1?Q?Caf=E9_menu?=')).toBe('Café menu');
    expect(decodeMimeWords('plain subject')).toBe('plain subject');
  });
});

describe('parseGmailMessage', () => {
  const message: GmailMessage = {
    id: 'm1', threadId: 't1', internalDate: '1700000000000', snippet: 'Hi there &amp; welcome', labelIds: ['INBOX', 'UNREAD', 'STARRED'],
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'From', value: 'Jane <jane@x.com>' }, { name: 'To', value: 'me@y.com' }, { name: 'Subject', value: '=?UTF-8?B?SGVsbG8=?=' }, { name: 'Message-ID', value: '<abc@x.com>' }],
      parts: [
        { mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', body: { data: b64('Plain body') } },
          { mimeType: 'text/html', body: { data: b64('<p>Hello <b>you</b></p><script>alert(1)</script><img src="https://t.example/pixel.gif"><a href="https://ok.example">x</a>') } },
        ] },
        { mimeType: 'application/pdf', filename: 'invoice.pdf', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="invoice.pdf"' }], body: { size: 1234, attachmentId: 'att1' } },
      ],
    },
  };

  it('extracts addresses, flags, bodies and attachments', () => {
    const m = parseGmailMessage(message);
    expect(m).toMatchObject({ gmailId: 'm1', threadId: 't1', subject: 'Hello', unread: true, starred: true, inInbox: true, sent: false, bodyText: 'Plain body', messageIdHeader: '<abc@x.com>' });
    expect(m.from).toEqual({ name: 'Jane', email: 'jane@x.com' });
    expect(m.snippet).toBe('Hi there & welcome');
    expect(m.attachments).toEqual([{ filename: 'invoice.pdf', mimeType: 'application/pdf', size: 1234, attachmentId: 'att1', inline: false }]);
    expect(m.internalDate.getTime()).toBe(1700000000000);
  });

  it('sanitizes the HTML: no scripts, no remote images (tracking pixels), links safe', () => {
    const html = parseGmailMessage(message).bodyHtml;
    expect(html).toContain('<b>you</b>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('pixel.gif');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(sanitizeMailHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
  });

  it('falls back to text made from the HTML when there is no plain part', () => {
    const htmlOnly: GmailMessage = { id: 'm2', threadId: 't2', payload: { mimeType: 'text/html', headers: [], body: { data: b64('<div>Line one</div><div>Line two</div>') } } };
    expect(parseGmailMessage(htmlOnly).bodyText).toBe('Line one\nLine two');
  });
});

describe('buildRawMessage', () => {
  const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

  it('builds a reply with threading headers, an encoded subject and a base64 UTF-8 body', () => {
    const raw = buildRawMessage({ from: { name: 'Ry', email: 'ry@x.com' }, to: [{ name: 'Jane Dóe', email: 'jane@y.com' }], subject: replySubject('Caf\u00e9 plans'), text: 'Sounds good \u2713', inReplyTo: '<abc@y.com>', references: '<root@y.com>' });
    const mime = decode(raw);
    expect(mime).toContain('From: "Ry" <ry@x.com>');
    expect(mime).toContain('To: =?UTF-8?B?');
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('In-Reply-To: <abc@y.com>');
    expect(mime).toContain('References: <root@y.com> <abc@y.com>');
    const body = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Sounds good \u2713');
  });

  it('refuses header injection and bad recipients, and never doubles "Re:"', () => {
    const mime = decode(buildRawMessage({ from: { email: 'a@b.com' }, to: [{ email: 'c@d.com' }], subject: 'Hi\r\nBcc: evil@x.com', text: 'x' }));
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(() => buildRawMessage({ from: { email: 'a@b.com' }, to: [{ email: 'not an address' }], subject: 's', text: 'x' })).toThrow('Not an email address');
    expect(() => buildRawMessage({ from: { email: 'a@b.com' }, to: [], subject: 's', text: 'x' })).toThrow('recipient');
    expect(replySubject('Re: hello')).toBe('Re: hello');
    expect(encodeHeaderWord('plain')).toBe('plain');
  });
});

describe('authentication and bulk headers', () => {
  it('reads SPF/DKIM/DMARC results, the return path and bulk markers', () => {
    const m = parseGmailMessage({
      id: 'a', threadId: 'b', payload: { mimeType: 'text/plain', body: { data: Buffer.from('x').toString('base64url') }, headers: [
        { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.i=@x.com; spf=fail (sender not permitted) smtp.mailfrom=y.com; dmarc=fail (p=REJECT sp=REJECT dis=NONE) header.from=x.com' },
        { name: 'Return-Path', value: '<bounce@y.com>' },
        { name: 'List-Unsubscribe', value: '<mailto:u@x.com>' },
      ] },
    });
    expect(m.auth).toEqual({ spf: 'fail', dkim: 'pass', dmarc: 'fail' });
    expect(m.returnPath).toBe('bounce@y.com');
    expect(m.bulk).toBe(true);
    expect(parseGmailMessage({ id: 'c', threadId: 'd', payload: { mimeType: 'text/plain', headers: [], body: { data: Buffer.from('x').toString('base64url') } } }).bulk).toBe(false);
  });
});
