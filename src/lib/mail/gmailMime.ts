/** Builds the RFC 2822 message Gmail's send API wants (base64url). Pure. */

export interface OutgoingMail {
  from: { name?: string; email: string };
  to: { name?: string; email: string }[];
  cc?: { name?: string; email: string }[];
  bcc?: { name?: string; email: string }[];
  subject: string;
  text: string;
  /** Replying: the Message-ID of the message answered and the thread's References. */
  inReplyTo?: string;
  references?: string;
}

const clean = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
const ascii = (value: string) => /^[\x20-\x7e]*$/.test(value);

/** RFC 2047 "encoded word" for a header value with non-ASCII characters. */
export function encodeHeaderWord(value: string): string {
  const v = clean(value);
  return ascii(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

function address(a: { name?: string; email: string }): string {
  const email = clean(a.email);
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+$/.test(email)) throw new Error(`Not an email address: ${email.slice(0, 80)}`);
  const name = a.name ? clean(a.name) : '';
  if (!name) return email;
  return ascii(name) ? `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>` : `${encodeHeaderWord(name)} <${email}>`;
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');

export function buildRawMessage(mail: OutgoingMail): string {
  if (!mail.to.length) throw new Error('Add at least one recipient.');
  const lines = [
    `From: ${address(mail.from)}`,
    `To: ${mail.to.map(address).join(', ')}`,
    ...(mail.cc?.length ? [`Cc: ${mail.cc.map(address).join(', ')}`] : []),
    ...(mail.bcc?.length ? [`Bcc: ${mail.bcc.map(address).join(', ')}`] : []),
    `Subject: ${encodeHeaderWord(mail.subject)}`,
    'MIME-Version: 1.0',
    ...(mail.inReplyTo ? [`In-Reply-To: ${clean(mail.inReplyTo)}`] : []),
    ...(mail.references || mail.inReplyTo ? [`References: ${clean([mail.references, mail.inReplyTo].filter(Boolean).join(' ')).slice(0, 1800)}`] : []),
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(mail.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64')),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

/** "Re: subject" once, never "Re: Re:". */
export const replySubject = (subject: string) => (/^\s*re:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`);
