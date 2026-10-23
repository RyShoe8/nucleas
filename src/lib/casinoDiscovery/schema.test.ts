import { describe, expect, it } from 'vitest';
import { nextScheduledAt } from '@/lib/jobs/schedule';
import { jobDesignSchema } from '@/lib/jobs/schema';
import { casinoDiscoveryDesign } from '@/lib/jobs/templates/casinoDiscovery';
import { canonicalCasinoDomain, casinoResearchSchema } from './schema';
describe('casino and sportsbook discovery configuration',()=>{
 it('keeps a three-day calendar cadence across daylight saving time',()=>{
 const schedule={kind:'daily' as const,everyDays:3,anchorDate:'2026-10-22',time:'09:00',timezone:'America/Chicago'};
 expect(nextScheduledAt(schedule,new Date('2026-10-22T20:00:00Z'))?.toISOString()).toBe('2026-10-25T14:00:00.000Z');
 expect(nextScheduledAt(schedule,new Date('2026-10-31T15:00:00Z'))?.toISOString()).toBe('2026-11-03T15:00:00.000Z');
 });
 it('validates a research-only job and matches the real admin shape',()=>{
 expect(jobDesignSchema.parse(casinoDiscoveryDesign('2026-10-22'))).toMatchObject({skill:'casino_discovery',recommendedCompletion:'review',schedule:{everyDays:3},delivery:{method:'nucleas'}});
 expect(canonicalCasinoDomain('https://WWW.Example.com/signup?code=abc')).toBe('example.com');
 expect(casinoResearchSchema.safeParse({name:'Invented','website_url':'javascript:alert(1)'}).success).toBe(false);
 });
});
