import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { WRITING_CASES, scoreWriting } from './checkCases';

const dry = WRITING_CASES[0]!;

const VOICED = `A 40x requirement on a $20 bonus is $800 of play before you can withdraw. We think that is the number to look at first.

We read the terms so you do not have to. Most of the catch hides there. Not in the headline.

Then we show the math. It is short.`;

const MACHINE = `In today's fast-paced world, it's worth noting that a 40x wagering requirement on a $20 bonus is a game-changing opportunity — you must wager $800 before you can withdraw, so don't miss out and leverage it today!`;

describe('writing check scoring', () => {
  it('rewards a reply in the voice that keeps the facts, and marks down machine-sounding text', () => {
    const good = scoreWriting(dry, VOICED);
    const bad = scoreWriting(dry, MACHINE);
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.score).toBeGreaterThanOrEqual(0.7);
    expect(bad.note).toBeTruthy();
  });

  it('gives nothing for empty replies and penalises dropped facts', () => {
    expect(scoreWriting(dry, '')).toMatchObject({ score: 0 });
    const noFacts = VOICED.replace('40x', 'big').replace('$20', 'small').replace('$800', 'lots');
    expect(scoreWriting(dry, noFacts).score).toBeLessThan(scoreWriting(dry, VOICED).score);
  });

  it('has cases in distinct voices with required facts', () => {
    expect(WRITING_CASES.length).toBeGreaterThanOrEqual(3);
    for (const c of WRITING_CASES) expect(c.facts.length).toBeGreaterThan(0);
  });
});
