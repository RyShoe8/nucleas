import { z } from 'zod';
const url = z.string().url().max(2000).refine(value => new URL(value).protocol === 'https:', 'Use HTTPS source URLs.');
const text = z.string().trim().max(4000);
const list = z.array(z.string().trim().min(1).max(200)).max(100);
export const casinoPayloadSchema = z.object({
  name: text.min(2).max(255), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(255),
  website_url: url.pipe(z.string().max(255)), login_url: url.pipe(z.string().max(255)), about: text.min(30),
  game_types: list.min(1), platforms: list.min(1), countries: list.min(1), restricted_states: list,
  payment_options: list, redemption_options: list, to_redeem: list,
  bonus_1_amount: z.number().nonnegative().nullable(), bonus_1_timer: z.number().positive().nullable(),
  bonus_2_amount: z.number().nonnegative().nullable(), bonus_2_timer: z.number().positive().nullable(),
  signup_bonus: z.number().nonnegative().nullable(), phone_verification_bonus: z.number().nonnegative().nullable(), social_media_link_bonus: z.number().nonnegative().nullable(),
  phone_verification: z.boolean(), id_and_bank_verification: z.boolean(), referral_program: z.boolean(),
  playthrough: text.max(255).nullable(), enveloping: z.boolean(), enveloping_frequency: z.enum(['daily','weekly','monthly']).nullable(), enveloping_amount: z.number().nonnegative().nullable(), enveloping_rules: text.nullable(),
  daily_reward_link: url.pipe(z.string().max(255)).nullable(), subreddit: text.max(255).nullable(),
  // Only the account owner's actual tracking links belong here; program/application URLs do not.
  affiliate_link: url.pipe(z.string().max(255)).nullable(), referral_link: url.pipe(z.string().max(255)).nullable(),
});
export const casinoResearchSchema = z.object({
  name: text.min(2), website_url: url,
  site_type: z.enum(['sweepstakes_casino','social_casino','sportsbook','sweepstakes_sportsbook','casino_and_sportsbook']),
  program_type: z.enum(['affiliate','referral','both','none','unverified']), program_url: url.nullable(), program_terms: text,
  operator: text.min(2), terms_url: url, eligibility_url: url,
  eligibility_evidence: text.min(30), bonus_terms: text, redemption_terms: text,
  field_sources: z.record(z.string(), z.array(url).min(1).max(6)),
  missing_information: list, payload: casinoPayloadSchema,
});
export type CasinoResearch = z.infer<typeof casinoResearchSchema>;
export function canonicalCasinoDomain(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}
export function readiness(research: CasinoResearch): string[] {
  const issues = [...research.missing_information];
  if (canonicalCasinoDomain(research.website_url) !== canonicalCasinoDomain(research.payload.website_url)) issues.push('The candidate and admin website domains do not match.');
  if (research.name.toLowerCase().replace(/\W/g,'') !== research.payload.name.toLowerCase().replace(/\W/g,'')) issues.push('The candidate and admin casino names do not match.');
  if (['affiliate','referral','both'].includes(research.program_type) && !research.program_url) issues.push('The claimed affiliate/referral program needs an official URL.');
  for (const field of ['name','website_url','login_url','about','game_types','platforms','countries','restricted_states','payment_options','redemption_options','to_redeem','phone_verification','id_and_bank_verification','referral_program','enveloping']) {
    if (!research.field_sources[field]?.length) issues.push(`Missing source for ${field}.`);
  }
  return [...new Set(issues)];
}

