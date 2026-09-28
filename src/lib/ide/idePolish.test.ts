import { describe, expect, it } from 'vitest';
import { buildDioramaDesks, ideChatThreadCacheKey } from '@/lib/ide/ideChatThreadCache';
import { runSceneFromState } from '@/lib/ide/runScenePhases';
import { ideChatModes } from '@/lib/ide/modes';

describe('ideChatThreadCacheKey', () => {
  it('never shares cached turns or draft keys across roles, projects, or Direct selections', () => {
    const keys = ['projA', 'projB'].flatMap((projectId) => [
      ...ideChatModes.map(({ id: mode }) => ideChatThreadCacheKey({ projectId, mode, modelProfileId: 'a', model: 'one' })),
      ideChatThreadCacheKey({ projectId, mode: 'direct', modelProfileId: 'b', model: 'one' }),
      ideChatThreadCacheKey({ projectId, mode: 'direct', modelProfileId: 'a', model: 'two' }),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('projA:direct');
  });
  it('keeps one orchestrated transcript per project', () => {
    expect(
      ideChatThreadCacheKey({ projectId: 'projA', mode: 'orchestrated', modelProfileId: 'x', model: 'y' })
    ).toBe('projA:orchestrated');
    expect(ideChatThreadCacheKey({ projectId: 'projB', mode: 'orchestrated' })).toBe('projB:orchestrated');
  });

  it('keys Direct by project, profile, and model', () => {
    expect(
      ideChatThreadCacheKey({
        projectId: 'projA',
        mode: 'direct',
        modelProfileId: 'abc',
        model: 'o4-mini',
      })
    ).toBe('projA:direct:abc:o4-mini');
  });
});

describe('buildDioramaDesks', () => {
  it('builds one Direct desk', () => {
    expect(
      buildDioramaDesks({ direct: true, directModelLabel: 'o4-mini', busy: true })
    ).toEqual([{ role: 'direct', modelLabel: 'o4-mini', active: true, status: 'active' }]);
  });

  it('builds three team desks with the active stage lit when busy', () => {
    const desks = buildDioramaDesks({
      stages: { planner: 'gpt-a', worker: 'gpt-b', reviewer: 'gpt-c' },
      busy: true,
      activeStage: 'planner',
    });
    expect(desks).toHaveLength(3);
    expect(desks.map((d) => d.role)).toEqual(['planner', 'worker', 'reviewer']);
    expect(desks.find((d) => d.role === 'planner')?.active).toBe(true);
    expect(desks.find((d) => d.role === 'planner')?.status).toBe('active');
    expect(desks.find((d) => d.role === 'worker')?.active).toBe(false);
    expect(desks.find((d) => d.role === 'worker')?.status).toBe('idle');
  });

  it('marks finished stages as done while another is active', () => {
    const desks = buildDioramaDesks({
      stages: { planner: 'p', worker: 'w', reviewer: 'r' },
      busy: true,
      activeStage: 'reviewer',
      doneStages: ['worker'],
    });
    expect(desks.find((d) => d.role === 'worker')?.status).toBe('done');
    expect(desks.find((d) => d.role === 'reviewer')?.status).toBe('active');
    expect(desks.find((d) => d.role === 'planner')?.status).toBe('idle');
  });

  it('does not light planner or reviewer for chat-style worker stage', () => {
    const desks = buildDioramaDesks({
      stages: { planner: 'p', worker: 'w', reviewer: 'r' },
      busy: true,
      activeStage: 'worker',
    });
    expect(desks.find((d) => d.role === 'planner')?.active).toBe(false);
    expect(desks.find((d) => d.role === 'reviewer')?.active).toBe(false);
    expect(desks.find((d) => d.role === 'worker')?.active).toBe(true);
  });
});

describe('runSceneFromState desks', () => {
  it('labels idle floor quietly', () => {
    const desks = buildDioramaDesks({
      stages: { planner: 'p', worker: 'w', reviewer: 'r' },
    });
    expect(runSceneFromState({ busy: false, interactionMode: 'chat', desks }).label).toMatch(
      /quiet|Standing by/i
    );
  });

  it('puts activity verbs on desks while busy', () => {
    const desks = buildDioramaDesks({
      stages: { planner: 'p', worker: 'w', reviewer: 'r' },
      busy: true,
      activeStage: 'worker',
      doneStages: ['planner'],
    });
    const scene = runSceneFromState({
      busy: true,
      interactionMode: 'chat',
      busyTick: 1,
      desks,
      liveStage: 'worker',
    });
    expect(scene.label).toMatch(/Team floor · researching/i);
    expect(scene.desks?.find((d) => d.role === 'planner')?.activityLabel).toBe('finished');
    expect(scene.desks?.find((d) => d.role === 'worker')?.activityLabel).toBe(
      'looking through the code…'
    );
    expect(scene.desks?.find((d) => d.role === 'reviewer')?.activityLabel).toBe('on standby…');
  });

  it('labels busy reviewer from live stage', () => {
    const desks = buildDioramaDesks({
      stages: { planner: 'p', worker: 'w', reviewer: 'Sol' },
      busy: true,
      activeStage: 'reviewer',
      doneStages: ['worker'],
    });
    const scene = runSceneFromState({
      busy: true,
      interactionMode: 'build',
      busyTick: 1,
      desks,
      liveStage: 'reviewer',
    });
    expect(scene.label).toMatch(/Team floor · reviewing/i);
    expect(scene.desks?.find((d) => d.role === 'reviewer')?.activityLabel).toBe(
      'reviewing changes…'
    );
  });
});
