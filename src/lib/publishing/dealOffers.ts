import { buildDealKey } from '@/lib/watches/dealFormat';
import { dealStrengthPct } from '@/lib/watches/dealMetrics';
import type { DealMetrics } from '@/lib/watches/types';

/**
 * An email that lists several packages is several deals. Its best package keeps the email's own id as its key, as a
 * single-offer email does, and each other package is "<email id>~<deal key>".
 */
const OFFER_KEY = /^([a-f0-9]{24})~(.+)$/;
const MAX_OFFERS_PER_EMAIL = 5;

export interface EmailOffers {
  _id: unknown;
  bestDeal?: DealMetrics | null;
  /** Written by the scan, only when reading an email for the first time, so emails already handled never split later. */
  offers?: DealMetrics[] | null;
}

/** The email a publishing key came from. A key from any other source, such as a page URL, is returned as it is. */
export function sourceItemId(key: string): string {
  return OFFER_KEY.exec(key)?.[1] ?? key;
}

/** Social posts carry only an email's best package, so followers do not see the same promotion several times. */
export function isBestOffer(key: string): boolean {
  return sourceItemId(key) === key;
}

export function hasSeveralOffers(email: Pick<EmailOffers, 'offers'>): boolean {
  return (email.offers?.length ?? 0) > 1;
}

/** The deals to post from one email. minPct applies to each package of a split email; a single offer was already judged when it was flagged. */
export function emailOffers(email: EmailOffers, minPct = 0): { key: string; deal: DealMetrics | null }[] {
  const id = String(email._id);
  if (!email.bestDeal || !email.offers || email.offers.length < 2) return [{ key: id, deal: email.bestDeal ?? null }];
  const bestKey = buildDealKey(email.bestDeal);
  return email.offers
    .filter((deal) => dealStrengthPct(deal) > 0 && Math.round(dealStrengthPct(deal) * 100) >= minPct)
    .sort((a, b) => dealStrengthPct(b) - dealStrengthPct(a))
    .slice(0, MAX_OFFERS_PER_EMAIL)
    .map((deal) => ({ key: buildDealKey(deal) === bestKey ? id : `${id}~${buildDealKey(deal)}`, deal }));
}

/** The deal a publishing key stands for. */
export function dealForKey(email: Pick<EmailOffers, 'bestDeal' | 'offers'>, key: string): DealMetrics | null {
  const tier = OFFER_KEY.exec(key)?.[2];
  const offer = tier ? email.offers?.find((deal) => buildDealKey(deal) === tier) : null;
  return offer ?? email.bestDeal ?? null;
}
