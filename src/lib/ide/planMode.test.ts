import { describe, expect, it } from 'vitest';
import { ideChatSchema } from '@/lib/ide/ideChatSchema';
import {
  appendInteractionModePrompt,
  orchestraStagePrompt,
  pipelineStageForInteractionMode,
  shouldForcePlainChat,
  toolProfileForOrchestraStage,
} from '@/lib/ide/planModePrompt';
import { parseNucleasPlan } from '@/lib/ide/parseNucleasPlan';
import { runSceneFromState } from '@/lib/ide/runScenePhases';

describe('ide plan mode helpers', () => {
  it('accepts interactionMode on the IDE chat schema', () => {
    const parsed = ideChatSchema.parse({
      mode: 'direct',
      text: 'hello',
      modelProfileId: 'a'.repeat(24),
      model: 'o4-mini',
      interactionMode: 'plan',
    });
    expect(parsed.interactionMode).toBe('plan');
    expect(ideChatSchema.parse({ mode: 'engineering', text: 'hi' }).interactionMode).toBe('chat');
    expect(
      ideChatSchema.parse({
        mode: 'engineering',
        text: 'hi',
        stream: true,
      }).stream
    ).toBe(true);
  });

  it('appends Direct plan/build/chat instructions', () => {
    expect(appendInteractionModePrompt('Base.', 'chat')).toMatch(/repo_search/);
    expect(appendInteractionModePrompt('Base.', 'plan')).toMatch(/Plan mode/);
    expect(appendInteractionModePrompt('Base.', 'plan')).toMatch(/nucleas-plan/);
    expect(appendInteractionModePrompt('Base.', 'plan')).toMatch(/repo_read/);
    expect(appendInteractionModePrompt('Base.', 'build')).toMatch(/approved the plan/);
    expect(shouldForcePlainChat('plan')).toBe(false);
    expect(shouldForcePlainChat('chat')).toBe(false);
  });

  it('gives orchestra stage prompts for chat lead → dig → review', () => {
    expect(orchestraStagePrompt('planner', 'chat')).toMatch(/Lead deep investigation/);
    expect(orchestraStagePrompt('worker', 'chat')).toMatch(/Execute the Planner/);
    expect(orchestraStagePrompt('worker', 'chat')).toMatch(/quote short excerpts/i);
    expect(orchestraStagePrompt('reviewer', 'chat')).toMatch(/nucleas-gate/);
    expect(orchestraStagePrompt('reviewer', 'chat')).toMatch(/explain from those excerpts/i);
    expect(orchestraStagePrompt('reviewer', 'chat')).toMatch(/Do not invent/);
    expect(orchestraStagePrompt('planner', 'plan')).toMatch(/nucleas-plan/);
    expect(toolProfileForOrchestraStage('planner', 'chat')).toBe('repo');
    expect(toolProfileForOrchestraStage('worker', 'chat')).toBe('full');
    expect(toolProfileForOrchestraStage('reviewer', 'chat')).toBe('none');
    expect(pipelineStageForInteractionMode('chat')).toBe('planner');
    expect(pipelineStageForInteractionMode('build')).toBe('planner');
  });

  it('parses a nucleas-plan fence and strips it from display text', () => {
    const raw = [
      'Here is the approach.',
      '```nucleas-plan',
      JSON.stringify({
        title: 'Ship Plan mode',
        summary: 'Add Chat/Plan switch and center review.',
        steps: ['Toggle', 'Prompts', 'Approve'],
      }),
      '```',
      'Plan ready to review in the center pane.',
    ].join('\n');
    const parsed = parseNucleasPlan(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.plan.title).toBe('Ship Plan mode');
    expect(parsed!.plan.steps).toHaveLength(3);
    expect(parsed!.plan.status).toBe('ready_for_review');
    expect(parsed!.displayText).toMatch(/Plan ready/);
    expect(parsed!.displayText).not.toMatch(/nucleas-plan/);
  });

  it('returns null when the fence is missing', () => {
    expect(parseNucleasPlan('Just a chat reply.')).toBeNull();
  });

  it('accepts valid plan JSON when a small model uses a generic JSON fence', () => {
    const parsed = parseNucleasPlan('```json\n{"title":"Remove duplicate","summary":"Remove OpenHV under OpenRA","steps":["Edit recipes"]}\n```');
    expect(parsed?.plan).toMatchObject({ title: 'Remove duplicate', steps: ['Edit recipes'] });
  });

  it('preserves visual wireframes and architecture prose in plan markdown (F16)', () => {
    const raw = [
      '## Architecture Wireframe',
      '```',
      '+-------------------+',
      '| [Header]          |',
      '| [Sidebar] [Main]  |',
      '+-------------------+',
      '```',
      '```nucleas-plan',
      JSON.stringify({
        title: 'Layout Overhaul',
        summary: 'Redesign IDE layout',
        steps: ['Header', 'Sidebar'],
      }),
      '```',
    ].join('\n');
    const parsed = parseNucleasPlan(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.plan.markdown).toContain('+-------------------+');
    expect(parsed!.plan.markdown).toContain('## Details & Architecture');
  });

  it('maps run-scene phases without network', () => {
    expect(runSceneFromState({ busy: false, interactionMode: 'chat' }).label).toMatch(/Standing by|quiet/i);
    expect(
      runSceneFromState({
        busy: true,
        interactionMode: 'plan',
        busyTick: 1,
        liveStage: 'planner',
      }).label
    ).toMatch(/Team floor · planning/i);
    expect(
      runSceneFromState({
        busy: false,
        interactionMode: 'plan',
        planReady: true,
      }).phase
    ).toBe('plan_ready');
  });
});
