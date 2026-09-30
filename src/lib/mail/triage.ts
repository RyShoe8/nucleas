import type { ParsedMessage } from './gmailParse';

/**
 * Decides where an incoming message belongs, so the main box only holds mail a person should read.
 *
 * It errs toward keeping real mail visible: anything from someone we have written to, or in a conversation we
 * are part of, stays in the main box (unless the sender's identity fails authentication: a forged known
 * contact is the most dangerous kind of spam). Uncertain cases are flagged for the AI second opinion. Nothing
 * is ever deleted; every other bucket is a click away, with the reasons shown.
 */

export type Bucket = 'important' | 'normal' | 'updates' | 'promotions' | 'suspicious';
export const MAIN_BUCKETS: Bucket[] = ['important', 'normal'];

export interface TriageRules {
  allowSenders: Set<string>;
  allowDomains: Set<string>;
  blockSenders: Set<string>;
  blockDomains: Set<string>;
}

export interface TriageContext {
  /** Addresses of the connected mailboxes. */
  ownAddresses: Set<string>;
  /** People we have written to (from sent mail in any connected mailbox). */
  knownContacts: Set<string>;
  /** Domains that are ours or our clients' (company domains, mailbox domains, contacts' own domains). */
  knownDomains: Set<string>;
  /** How many earlier messages this sender has sent us (a first-time sender is weaker evidence). */
  priorFromSender: number;
  rules: TriageRules;
  /** Someone at a connected mailbox has already written in this conversation. */
  threadHasOurReply: boolean;
}

export interface TriageResult {
  bucket: Bucket;
  /** 0-100: how spam-like or dangerous. */
  risk: number;
  reasons: string[];
  /** The rules cannot tell: worth an AI second opinion. */
  uncertain: boolean;
  by: 'rules' | 'user';
}

export const emptyRules = (): TriageRules => ({ allowSenders: new Set(), allowDomains: new Set(), blockSenders: new Set(), blockDomains: new Set() });

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com', 'qq.com']);
const SHORTENERS = /\b(?:bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|is\.gd|cutt\.ly|rb\.gy|t\.ly|shorturl\.at|tiny\.cc)\//i;
const URGENT = /\b(?:verify your (?:account|identity|email)|account (?:has been |will be )?(?:suspended|locked|closed|limited)|unusual (?:sign[- ]?in|activity)|confirm your (?:password|payment|identity)|wire transfer|gift cards?|invoice (?:attached|overdue)|action required|your (?:mailbox|storage) is full|password (?:will )?expire)/i;
const COLD = /\b(?:quick question|partnership opportunit|guest post|backlinks?|seo (?:services|audit|expert|report)|lead generation|increase your (?:traffic|sales|revenue|rankings)|(?:i|we) (?:came across|found|noticed|stumbled upon) your (?:website|site|company|business)|(?:schedule|book) a (?:quick |short )?(?:call|demo|meeting)|web ?(?:site )?design (?:services|company)|white[- ]?label|link building|cold email|appointment setting|outsourc\w+ (?:team|services))\b/i;
const PROMO = /(?:\b\d{1,3}% off\b|\bsale\b|limited[- ]time|\bdiscount\b|\bcoupon\b|\bdeals?\b|black friday|cyber monday|free trial|\bwebinar\b|\bnewsletter\b|\bunsubscribe\b|new arrivals|last chance|ends (?:today|tonight|soon))/i;
const RISKY_ATTACHMENT = /\.(?:exe|scr|js|jse|vbs|bat|cmd|com|pif|iso|img|lnk|hta|jar|msi)$/i;
const NO_REPLY_LOCAL = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|newsletter|news|mailer|updates?|alerts?|info-?noreply|bounce)/i;

const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';
const baseDomain = (domain: string) => domain.split('.').slice(-2).join('.');

/** Levenshtein distance, capped: only "1 or 2 characters away" matters. */
function distance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const normalizeLeet = (s: string) => s.replace(/rn/g, 'm').replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/vv/g, 'w').replace(/5/g, 's');

/** A domain one or two characters from one of ours (playb0und.club vs playbound.club): the classic look-alike. */
export function lookalikeOf(domain: string, known: Set<string>): string | null {
  const base = baseDomain(domain);
  for (const k of known) {
    const kb = baseDomain(k);
    if (!kb || kb === base || FREE_MAIL.has(kb) || kb.length < 6) continue;
    const plain = distance(base, kb);
    // One character off, two on a long name, or identical once look-alike characters (0/o, rn/m, 1/l) are folded.
    if (plain === 1 || (plain === 2 && kb.length >= 10) || (plain > 0 && normalizeLeet(base) === normalizeLeet(kb))) return kb;
  }
  return null;
}

/** "support@paypal.com" shown as the name of a message actually sent from another domain. */
function displayNameSpoof(name: string, email: string): string | null {
  const inName = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/.exec(name)?.[1]?.toLowerCase() ?? /\b((?:[a-z0-9-]+\.)+(?:com|net|org|io|co|app|club|dev))\b/i.exec(name)?.[1]?.toLowerCase();
  if (!inName) return null;
  return baseDomain(inName) === baseDomain(domainOf(email)) ? null : inName;
}

export function triageMessage(m: ParsedMessage, ctx: TriageContext): TriageResult {
  const email = m.from.email.toLowerCase();
  const domain = domainOf(email);
  const reasons: string[] = [];
  const done = (bucket: Bucket, risk: number, by: TriageResult['by'] = 'rules', uncertain = false): TriageResult => ({ bucket, risk: Math.min(100, Math.max(0, Math.round(risk))), reasons: reasons.slice(0, 6), uncertain, by });

  // Mail we sent ourselves is never triaged away.
  if (m.sent || ctx.ownAddresses.has(email)) return done('normal', 0);

  // What a person has taught the filter wins over everything else.
  if (ctx.rules.blockSenders.has(email) || ctx.rules.blockDomains.has(domain) || ctx.rules.blockDomains.has(baseDomain(domain))) {
    reasons.push(`You blocked ${ctx.rules.blockSenders.has(email) ? email : domain}.`);
    return done('suspicious', 95, 'user');
  }
  const allowed = ctx.rules.allowSenders.has(email) || ctx.rules.allowDomains.has(domain) || ctx.rules.allowDomains.has(baseDomain(domain));
  if (allowed) {
    reasons.push(`You allowed ${ctx.rules.allowSenders.has(email) ? email : domain}.`);
    return done('normal', 0, 'user');
  }

  // Identity: did the sender's server prove who sent this?
  let risk = 0;
  const { spf, dkim, dmarc } = m.auth;
  const authFailed = dmarc === 'fail' || (spf === 'fail' && dkim !== 'pass') || (dkim === 'fail' && spf !== 'pass');
  if (dmarc === 'fail') { risk += 35; reasons.push('Failed DMARC: the sender could not prove they own this address.'); }
  if (spf === 'fail' || spf === 'softfail') { risk += spf === 'fail' ? 20 : 10; reasons.push(`SPF ${spf}.`); }
  if (dkim === 'fail') { risk += 15; reasons.push('DKIM signature failed.'); }

  const knownContact = ctx.knownContacts.has(email);
  // A forged known contact or our own domain is the most dangerous kind.
  if ((knownContact || ctx.knownDomains.has(domain) || ctx.knownDomains.has(baseDomain(domain))) && authFailed) {
    reasons.unshift(`Pretends to be ${knownContact ? 'someone you write to' : `your domain ${baseDomain(domain)}`} but fails authentication.`);
    return done('suspicious', Math.max(85, risk));
  }

  const look = ctx.knownDomains.has(domain) ? null : lookalikeOf(domain, ctx.knownDomains);
  if (look) { risk += 40; reasons.push(`The domain ${domain} looks like ${look}.`); }
  const spoof = displayNameSpoof(m.from.name, email);
  if (spoof) { risk += 30; reasons.push(`The name shows ${spoof} but it was sent from ${domain}.`); }
  const replyDomain = m.replyTo ? domainOf(m.replyTo) : '';
  if (replyDomain && baseDomain(replyDomain) !== baseDomain(domain) && !m.bulk) { risk += 12; reasons.push(`Replies go to a different domain (${replyDomain}).`); }
  const returnDomain = m.returnPath ? domainOf(m.returnPath) : '';
  if (returnDomain && !m.bulk && baseDomain(returnDomain) !== baseDomain(domain) && !FREE_MAIL.has(baseDomain(domain)) && dmarc !== 'pass') { risk += 8; reasons.push('Sent through a different domain than it claims.'); }

  const text = `${m.subject}\n${m.bodyText.slice(0, 4000)}`;
  if (URGENT.test(text)) { risk += 15; reasons.push('Urgent account/payment wording.'); if (/https?:\/\//i.test(m.bodyText) || m.bodyHtml.includes('href')) risk += 8; }
  if (SHORTENERS.test(m.bodyText)) { risk += 10; reasons.push('Uses a link shortener.'); }
  if (m.attachments.some((a) => RISKY_ATTACHMENT.test(a.filename))) { risk += 25; reasons.push('Has an executable-type attachment.'); }
  const letters = m.subject.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 8 && letters === letters.toUpperCase()) { risk += 6; reasons.push('Subject is all capitals.'); }
  if ((m.subject.match(/!/g) ?? []).length >= 3) { risk += 4; reasons.push('Lots of exclamation marks.'); }

  // Trust: who it is from, and whether we are already talking.
  const trusted = knownContact || ctx.threadHasOurReply || ctx.knownDomains.has(domain) || ctx.knownDomains.has(baseDomain(domain));
  if (trusted && risk < 60) {
    reasons.unshift(knownContact ? 'From someone you have written to.' : ctx.threadHasOurReply ? 'In a conversation you are part of.' : `From ${baseDomain(domain)}, one of your domains or clients.`);
    const direct = m.to.length <= 4 && !m.bulk;
    return done(knownContact && direct ? 'important' : 'normal', risk);
  }

  if (risk >= 60) return done('suspicious', risk);

  // Automated and promotional mail.
  const category = m.labels.find((l) => l.startsWith('CATEGORY_'));
  const noReply = NO_REPLY_LOCAL.test(email.split('@')[0] ?? '');
  const bulky = m.bulk || noReply || ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].includes(category ?? '');
  const promo = category === 'CATEGORY_PROMOTIONS' || (bulky && PROMO.test(text)) || /\bunsubscribe\b/i.test(m.bodyText) && PROMO.test(m.subject);
  if (bulky) {
    reasons.unshift(m.bulk ? 'Bulk mail (has an unsubscribe header).' : noReply ? 'Automated sender.' : `Gmail files it under ${category!.replace('CATEGORY_', '').toLowerCase()}.`);
    if (promo) return done('promotions', Math.max(risk, 20));
    return done('updates', risk, 'rules', risk >= 25);
  }

  // A stranger selling something.
  const stranger = ctx.priorFromSender === 0;
  if (COLD.test(text)) {
    reasons.unshift(stranger ? 'Cold outreach from someone new.' : 'Sales outreach.');
    return done('promotions', Math.max(risk, 30), 'rules', false);
  }

  if (risk >= 30) return done('promotions', risk, 'rules', true);
  // Unknown sender, direct message, nothing wrong: keep it, but let the second opinion look at first contacts.
  if (stranger && FREE_MAIL.has(baseDomain(domain)) === false && risk > 0) return done('normal', risk, 'rules', true);
  if (stranger && risk > 0) return done('normal', risk, 'rules', true);
  reasons.unshift(stranger ? 'New sender, nothing suspicious.' : 'Nothing suspicious.');
  return done('normal', risk, 'rules', stranger && authFailed);
}
