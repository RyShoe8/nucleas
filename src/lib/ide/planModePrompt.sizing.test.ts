import { describe, expect, it } from 'vitest';
import { orchestraStagePrompt } from './planModePrompt';

describe('plan sizing', () => {
  it('asks the planner for the smallest change that meets the need, and the critic to push back on oversized plans', () => {
    expect(orchestraStagePrompt('planner', 'plan')).toContain('Size the plan to the request');
    expect(orchestraStagePrompt('planner', 'plan')).toContain('first check it does not already exist');
    expect(orchestraStagePrompt('reviewer', 'plan')).toContain('is there a clearly smaller change that meets the same need');
  });
});
