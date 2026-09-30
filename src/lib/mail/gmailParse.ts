import sanitizeHtml from 'sanitize-html';

/** Turns a Gmail API message (format=full) into the fields Nucleas stores. Pure: no network, no database. */

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart;
}
export interface MailAddress { name: string; email: string }
export interface ParsedAttachment { filename: string; mimeType: string; size: number; attachmentId: string; inline: boolean }
export interface ParsedMessage {
  gmailId: string;
  threadId: string;
  internalDate: Date;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  replyTo?: string;
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string;
  messageIdHeader?: string;
  referencesHeader?: string;
  labels: string[];
  unread: boolean;
  starred: boolean;
  inInbox: boolean;
  sent: boolean;
  trashed: boolean;
  attachments: ParsedAttachment[];
  /** What the receiving server concluded about who really sent it. */
  auth: { spf: string; dkim: string; dmarc: string };
  /** Sent to many people: a List-Unsubscribe header, bulk/list precedence, or an automatic sender. */
  bulk: boolean;
  returnPath?: string;
}

export const decodeBase64Url = (data: string) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** RFC 2047 encoded words ("=?UTF-8?B?...?=") in a header value. */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset: string, enc: string, text: string) => {
      try {
        const bytes = enc.toUpperCase() === 'B'
          ? Buffer.from(text, 'base64')
          : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1');
        return new TextDecoder(/^(?:utf-?8|us-ascii)$/i.test(charset) ? 'utf-8' : charset.toLowerCase()).decode(bytes);
      } catch {
        return text;
      }
    });
}

/** "Jane Doe <jane@x.com>, bob@y.com, \"Smith, Al\" <al@z.com>" → addresses. Commas inside quotes do not split. */
export function parseAddressList(header: string | undefined): MailAddress[] {
  if (!header) return [];
  const out: MailAddress[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  const flush = () => {
    const raw = current.trim();
    current = '';
    if (!raw) return;
    const angle = /^(.*?)<([^<>]+)>\s*$/.exec(raw);
    const email = (angle ? angle[2] : raw).trim().replace(/^mailto:/i, '');
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) return;
    const name = angle ? decodeMimeWords(angle[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1')).trim() : '';
    out.push({ name: name === email ? '' : name, email: email.toLowerCase() });
  };
  for (const ch of header) {
    if (ch === '"' ) quoted = !quoted;
    if (!quoted && ch === '<') depth += 1;
    if (!quoted && ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && !quoted && depth === 0) flush();
    else current += ch;
  }
  flush();
  return out;
}

/** HTML from an email made safe to show: no scripts, styles, forms or remote images (tracking pixels); links open in a new tab. */
export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['a', 'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'small', 'sub', 'sup'],
    allowedAttributes: { a: ['href', 'name', 'target', 'rel'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], img: ['src', 'alt', 'width', 'height'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // Images are only kept when they are embedded in the message (cid:), never fetched from the web.
    allowedSchemesByTag: { img: ['cid', 'data'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } }),
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html.replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, '\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const header = (part: GmailPart | undefined, name: string): string | undefined =>
  part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

function walk(part: GmailPart | undefined, out: { text: string[]; html: string[]; attachments: ParsedAttachment[] }) {
  if (!part) return;
  const mime = (part.mimeType ?? '').toLowerCase();
  if (part.filename && part.body?.attachmentId) {
    const disposition = (header(part, 'Content-Disposition') ?? '').toLowerCase();
    out.attachments.push({
      filename: decodeMimeWords(part.filename).slice(0, 300),
      mimeType: mime || 'application/octet-stream',
      size: part.body.size ?? 0,
      attachmentId: part.body.attachmentId,
      inline: disposition.startsWith('inline') || Boolean(header(part, 'Content-ID')),
    });
    return;
  }
  if (part.body?.data && mime === 'text/plain') out.text.push(decodeBase64Url(part.body.data));
  else if (part.body?.data && mime === 'text/html') out.html.push(decodeBase64Url(part.body.data));
  for (const child of part.parts ?? []) walk(child, out);
}

function authResults(p: GmailPart | undefined): ParsedMessage['auth'] {
  const raw = [header(p, 'Authentication-Results'), header(p, 'Received-SPF')].filter(Boolean).join(' ').toLowerCase();
  const pick = (name: string) => new RegExp(`\\b${name}=([a-z]+)`).exec(raw)?.[1] ?? (name === 'spf' ? /^\s*(pass|fail|softfail|neutral|none)\b/.exec(header(p, 'Received-SPF')?.toLowerCase() ?? '')?.[1] : undefined) ?? '';
  return { spf: pick('spf'), dkim: pick('dkim'), dmarc: pick('dmarc') };
}

export function parseGmailMessage(message: GmailMessage): ParsedMessage {
  const collected = { text: [] as string[], html: [] as string[], attachments: [] as ParsedAttachment[] };
  walk(message.payload, collected);
  const labels = message.labelIds ?? [];
  const rawHtml = collected.html.join('\n');
  const bodyHtml = rawHtml ? sanitizeMailHtml(rawHtml) : '';
  const bodyText = (collected.text.join('\n') || (rawHtml ? htmlToText(rawHtml) : '')).slice(0, 120_000);
  const p = message.payload;
  const from = parseAddressList(header(p, 'From'))[0] ?? { name: '', email: '' };
  return {
    gmailId: message.id,
    threadId: message.threadId,
    internalDate: new Date(Number(message.internalDate) || Date.now()),
    from,
    to: parseAddressList(header(p, 'To')),
    cc: parseAddressList(header(p, 'Cc')),
    replyTo: parseAddressList(header(p, 'Reply-To'))[0]?.email,
    subject: decodeMimeWords(header(p, 'Subject') ?? '').slice(0, 500),
    snippet: (message.snippet ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 400),
    bodyText,
    bodyHtml: bodyHtml.slice(0, 400_000),
    messageIdHeader: header(p, 'Message-ID') ?? header(p, 'Message-Id'),
    referencesHeader: header(p, 'References')?.slice(0, 2000),
    labels,
    unread: labels.includes('UNREAD'),
    starred: labels.includes('STARRED'),
    inInbox: labels.includes('INBOX'),
    sent: labels.includes('SENT'),
    trashed: labels.includes('TRASH'),
    attachments: collected.attachments.slice(0, 40),
    auth: authResults(p),
    bulk: Boolean(header(p, 'List-Unsubscribe')) || /^(?:bulk|list|junk)$/i.test(header(p, 'Precedence')?.trim() ?? '') || /^auto-(?:generated|replied)/i.test(header(p, 'Auto-Submitted')?.trim() ?? ''),
    returnPath: header(p, 'Return-Path')?.replace(/[<>]/g, '').trim().toLowerCase() || undefined,
  };
}
