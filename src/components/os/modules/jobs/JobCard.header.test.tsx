import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import JobCard, { jobFacts, type JobView } from './JobCard';

function render(headerShownAbove: boolean, overrides: Partial<JobView> = {}) {
  const job = {
    id: 'a'.repeat(24), companyId: 'b'.repeat(24), companyName: 'Tailnote', status: 'active', request: 'Spotlight', level: 'medium', completion: 'review',
    monthlyBudgetMicros: 0, spentThisMonthMicros: 0, nextRunAt: null, error: null, runs: [], canManage: true, opportunities: [], publishing: null,
    design: { skill: 'signature_outreach', title: 'Tailnote signature spotlight', category: 'marketing', instructions: '', fields: [], sourcePolicy: '', delivery: { method: 'nucleas', detail: '', setupSteps: [] }, schedule: { kind: 'weekly', weekdays: [1], time: '09:00', timezone: 'America/Chicago' }, recordsPerRun: 1, recommendedCompletion: 'review', safeguards: [], findings: [], questions: [] },
    ...overrides,
  } as unknown as JobView;
  return renderToStaticMarkup(createElement(JobCard, { job, headerShownAbove }));
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe('the job card header', () => {
  it('shows the name when nothing above it does', () => {
    expect(count(render(false), 'Tailnote signature spotlight')).toBeGreaterThan(0);
    expect(render(false)).toContain('Rename job');
  });

  it('does not repeat the name when the row above shows it, and can still be renamed', () => {
    const html = render(true);
    expect(html).not.toContain('font-medium leading-snug');
    expect(html).toContain('Rename job');
    expect(html).toContain('Schedule');
    expect(html).not.toContain('Company</dt>');
  });

  it('still says when a dry run failed, which the row above does not', () => {
    const failed = render(true, { status: 'proposed', runs: [{ id: 'r', status: 'failed', dryRun: true, createdAt: '2026-11-05T00:00:00Z' }] } as never);
    expect(failed).toContain('Dry run failed');
  });

  it('labels each detail instead of running them together', () => {
    const job = { companyName: 'Tailnote', completion: 'review', lastRunAt: null, monthlyBudgetMicros: 10_100_000, spentThisMonthMicros: 1_470_000, design: { skill: 'signature_outreach', schedule: { kind: 'weekly', weekdays: [1, 3, 5], time: '09:00', timezone: 'America/Chicago' } } } as unknown as JobView;
    const facts = jobFacts(job, { showCompany: true });
    expect(facts.map((fact) => fact.label)).toEqual(['Company', 'Schedule', 'Last checked', 'Results', 'This month']);
    expect(facts.find((fact) => fact.label === 'Last checked')?.value).toBe('Not yet');
    expect(facts.find((fact) => fact.label === 'Results')?.value).toBe('You review');
    expect(facts.find((fact) => fact.label === 'This month')).toMatchObject({ value: '$1.47 of $10.10' });
    expect(facts.find((fact) => fact.label === 'This month')?.used).toBeCloseTo(0.146, 2);
    expect(jobFacts(job, { showCompany: false }).map((fact) => fact.label)).not.toContain('Company');
  });

  it('does not show a budget where it would only be noise, and caps the bar when over budget', () => {
    const base = { companyName: 'T', monthlyBudgetMicros: 1_000_000, spentThisMonthMicros: 3_000_000, design: { schedule: { kind: 'once' } } };
    expect(jobFacts({ ...base, design: { ...base.design, skill: 'social_publish' } } as unknown as JobView, { showCompany: false }).map((fact) => fact.label)).not.toContain('This month');
    expect(jobFacts(base as unknown as JobView, { showCompany: false }).find((fact) => fact.label === 'This month')?.used).toBe(1);
  });

  it('draws the rename icon as an icon, centred in its button', () => {
    const html = render(true);
    expect(html).not.toContain('✎');
    expect(html).toMatch(/inline-flex h-6 w-6[^"]*items-center justify-center/);
  });
});
