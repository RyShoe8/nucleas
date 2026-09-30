import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { codeChangeRequest, shouldOverrideToCodeChange, type AskPlan } from './askOrchestrator';
import { renderRejectedPlans } from '@/lib/building/builds';

const emptyPlan = { kind: 'answer', scope: 'company', fetch: [], actions: [], research: [], outline: [], review: false } as unknown as AskPlan;

describe('Ask routing safeguard', () => {
  it('sends a problem report to the repository planner when the small planner chose nothing', () => {
    expect(shouldOverrideToCodeChange(emptyPlan, 'On example.com/admin/games, Foo is listed twice. Remove the listing under Bar so it is only standalone')).toBe(true);
  });

  it('leaves questions, data lookups and explicit routing alone', () => {
    expect(shouldOverrideToCodeChange(emptyPlan, 'Why is Foo listed twice on example.com?')).toBe(false);
    expect(shouldOverrideToCodeChange(emptyPlan, 'Show me revenue on the website')).toBe(false);
    expect(shouldOverrideToCodeChange({ ...emptyPlan, fetch: [{ company: 'A', tool: 't' }] } as unknown as AskPlan, 'Remove the listing on example.com')).toBe(false);
    expect(shouldOverrideToCodeChange({ ...emptyPlan, codeChange: { company: 'A', request: 'x'.repeat(10) } }, 'Remove the listing on example.com')).toBe(false);
  });
});

describe('rejected plans as constraints', () => {
  it('lists earlier rejected plans with the reason, and says they are not evidence to repeat', () => {
    const text = renderRejectedPlans([
      { title: 'Remove OpenHV edition', summary: 'Change gameSlug to openhv', request: 'r', events: [{ at: new Date(), action: 'proposed' }, { at: new Date(), action: 'rejected', note: 'creates an openhv:openhv duplicate' }] },
      { title: 'Other', summary: '', request: 'Second request', events: [] },
    ]);
    expect(text).toContain('Do not propose the same fix again');
    expect(text).toContain('"Remove OpenHV edition" (Change gameSlug to openhv) — rejected because: creates an openhv:openhv duplicate');
    expect(text).toContain('"Other" (Second request) — rejected, no reason recorded');
    expect(renderRejectedPlans([])).toBe('');
  });
});

describe('codeChangeRequest', () => {
  it('keeps the user\u2019s own words (page address, exact names) beside the planner\u2019s restatement', () => {
    const original = 'On playbound.club/admin/connect/game-servers, OpenHV is listed twice. Remove the OpenRA one.';
    const out = codeChangeRequest('Remove the duplicate OpenHV listing from the game servers admin page.', original);
    expect(out).toContain('Remove the duplicate OpenHV listing');
    expect(out).toContain('playbound.club/admin/connect/game-servers');
  });
  it('does not repeat itself when the restatement already contains the message', () => {
    const original = 'On example.com/admin, X is listed twice.';
    expect(codeChangeRequest(original, original)).toBe(original);
  });
});
