import { describe, expect, it } from 'vitest';
import { costSummary, modelStepReason, type ModelStep } from './modelPath';

const step = (over: Partial<ModelStep>): ModelStep => ({
  stage: 'work', note: 'First attempt', model: 'm', free: false, source: 'auto', level: 'medium', fallback: false, costMicros: 0, reason: '', ...over,
});

describe('modelStepReason', () => {
  it('explains that Medium uses the free model for the work and a paid reviewer', () => {
    expect(modelStepReason({ stage: 'work', level: 'medium', free: true, source: 'auto', fallback: false })).toMatch(/Medium level: the free model does the work, with a paid retry only if it fails/);
    expect(modelStepReason({ stage: 'review', level: 'medium', free: false, source: 'auto', fallback: false })).toMatch(/strongest paid model within its price ceiling reviews/);
  });

  it('says when no paid model could review', () => {
    expect(modelStepReason({ stage: 'review', level: 'medium', free: true, source: 'auto', fallback: false })).toMatch(/No paid model was eligible/);
  });

  it('distinguishes pins, the Free level, paid retries, and High work', () => {
    expect(modelStepReason({ stage: 'work', level: 'low', free: false, source: 'pinned', fallback: false })).toMatch(/Chosen for this task and level/);
    expect(modelStepReason({ stage: 'work', level: 'free', free: true, source: 'auto', fallback: false })).toMatch(/Free level/);
    expect(modelStepReason({ stage: 'work', level: 'medium', free: false, source: 'auto', fallback: true })).toMatch(/paid retry/);
    expect(modelStepReason({ stage: 'work', level: 'high', free: false, source: 'auto', fallback: false })).toMatch(/High price ceiling/);
  });
});

describe('costSummary', () => {
  it('adds known costs and names paid models whose price is unknown', () => {
    const out = costSummary([step({ free: true, costMicros: 0 }), step({ stage: 'review', model: 'gpt-6.1-sol', costMicros: null }), step({ model: 'gpt-6.1-sol', costMicros: null }), step({ costMicros: 1200 })]);
    expect(out).toEqual({ knownMicros: 1200, unknownModels: ['gpt-6.1-sol'] });
  });

  it('does not flag free models with no cost figure', () => {
    expect(costSummary([step({ free: true, costMicros: null })]).unknownModels).toEqual([]);
  });
});
