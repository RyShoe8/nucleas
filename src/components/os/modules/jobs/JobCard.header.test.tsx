import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import JobCard, { type JobView } from './JobCard';

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
    expect(html).toContain('Tailnote ·');
  });

  it('still says when a dry run failed, which the row above does not', () => {
    const failed = render(true, { status: 'proposed', runs: [{ id: 'r', status: 'failed', dryRun: true, createdAt: '2026-11-05T00:00:00Z' }] } as never);
    expect(failed).toContain('Dry run failed');
  });

  it('draws the rename icon as an icon, centred in its button', () => {
    const html = render(true);
    expect(html).not.toContain('✎');
    expect(html).toMatch(/inline-flex h-6 w-6[^"]*items-center justify-center/);
  });
});
