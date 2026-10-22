import { describe, expect, it } from 'vitest';
import { recipientOnlyItem, recipientOnlyOffer } from './offerEligibility';

describe('public deal eligibility', () => {
  it.each([
    'Limitation: This is an exclusive offer for ryshoe@gmail.com',
    'Exclusive offer for: ryshoe@gmail.com',
    'This offer is only available to your account.',
    'This deal is for your account only.',
    'Only the recipient can redeem this promotion.',
  ])('excludes recipient-only terms: %s', (text) => expect(recipientOnlyOffer(text)).toBe(true));
  it.each([
    'An exclusive offer: pay $20 and get 30 SC. Available to all players.',
    'Hi Ryan! Pay $20 and get 30 SC. This email was sent to ryshoe@gmail.com.',
    'Offer available only to new players aged 21 and over.',
  ])('keeps general promotions: %s', (text) => expect(recipientOnlyOffer(text)).toBe(false));
  it('checks recorded eligibility points as well as raw email text', () => {
    expect(recipientOnlyItem({ keyPoints: [{ text: 'This is an exclusive offer for ryshoe@gmail.com' }] })).toBe(true);
  });
});
