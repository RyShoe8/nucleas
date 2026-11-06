import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./ActivityList', () => ({ ActivityRows: () => createElement('li', null, 'activity rows') }));
import type { JobView } from './JobCard';
import RunningNow, { isRunningJob, jobActivityLines } from './RunningNow';

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 'a'.repeat(24), companyId: 'b'.repeat(24), companyName: 'Tailnote', status: 'testing', request: 'Spotlight', canManage: true, runs: [], opportunities: [], publishing: null,
  design: { skill: 'signature_outreach', title: 'Tailnote signature spotlight', category: 'marketing', fields: [], schedule: { kind: 'weekly', weekdays: [1], time: '09:00', timezone: 'America/Chicago' } },
  ...overrides,
}) as unknown as JobView;
const running = (progress: string[]) => ({ id: 'r', status: 'running', progress, progressState: { stage: 'researching', label: progress.at(-1) ?? 'Starting', percent: 40, updatedAt: '2026-11-05T00:00:00Z' } });
const render = (jobs: JobView[]) => renderToStaticMarkup(createElement(RunningNow, { jobs, items: [], onChange: () => {} }));

describe('which jobs count as running', () => {
  it('includes a dry run from the moment it is started', () => {
    expect(isRunningJob(job({ status: 'testing' }))).toBe(true);
  });
  it('includes a scheduled run and a job being designed', () => {
    expect(isRunningJob(job({ status: 'active', runs: [running([])] }))).toBe(true);
    expect(isRunningJob(job({ status: 'designing' }))).toBe(true);
  });
  it('leaves out finished and waiting jobs', () => {
    expect(isRunningJob(job({ status: 'proposed' }))).toBe(false);
    expect(isRunningJob(job({ status: 'active', runs: [{ id: 'r', status: 'completed', progress: [] }] }))).toBe(false);
  });
});

describe('the running section', () => {
  it('shows nothing when nothing is running', () => {
    expect(render([])).toBe('');
  });

  it('stays pinned to the bottom of the window', () => {
    expect(render([job()])).toContain('sticky bottom-0');
  });

  it('shows what the job is doing, with the newest line last', () => {
    const html = render([job({ runs: [running(['Researching with gemma', 'Searching the web for “bluesky”', 'Opening gilarpgs.com'])] })]);
    expect(html).toContain('Tailnote signature spotlight');
    expect(html.indexOf('Researching with gemma')).toBeLessThan(html.lastIndexOf('Opening gilarpgs.com'));
    expect(html).toContain('40%');
  });

  it('shows the recent lines and offers the rest', () => {
    const lines = Array.from({ length: 10 }, (_, index) => `Step ${index + 1}`);
    const html = render([job({ runs: [running(lines)] })]);
    expect(html).toContain('Step 10');
    expect(html).not.toContain('>Step 1<');
    expect(html).toContain('Show all 10');
  });

  it('drops repeated lines', () => {
    expect(jobActivityLines(job({ runs: [running(['Reading', 'Reading', 'Writing'])] }))).toEqual(['Reading', 'Writing']);
  });

  it('still shows a job with no activity yet', () => {
    expect(render([job({ status: 'testing' })])).toContain('Preparing dry run');
  });
});
