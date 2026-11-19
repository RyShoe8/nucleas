import { describe, expect, it } from 'vitest';
import { findRemovedTasks } from '@/lib/cleanup/entityCleanup';
import {
  isContentEligibleForPurge,
  isLegacyRetentionCandidate,
  isProjectEligibleForPurge,
  isTaskEligibleForPurge,
} from '@/lib/cleanup/retentionEligibility';

const cutoff = new Date('2026-01-01T00:00:00.000Z');
const oldDate = new Date('2025-06-01T00:00:00.000Z');
const recentDate = new Date('2026-06-01T00:00:00.000Z');

describe('retentionEligibility', () => {
  it('purges only completed tasks with completedAt before cutoff', () => {
    expect(isTaskEligibleForPurge({ status: 'completed', completedAt: oldDate }, cutoff)).toBe(true);
    expect(isTaskEligibleForPurge({ status: 'completed', completedAt: recentDate }, cutoff)).toBe(false);
    expect(isTaskEligibleForPurge({ status: 'active', completedAt: oldDate }, cutoff)).toBe(false);
    expect(isTaskEligibleForPurge({ status: 'completed' }, cutoff)).toBe(false);
  });

  it('purges only published content with statusPublishedAt before cutoff', () => {
    expect(isContentEligibleForPurge({ status: 'published', statusPublishedAt: oldDate }, cutoff)).toBe(
      true
    );
    expect(isContentEligibleForPurge({ status: 'ready', statusPublishedAt: oldDate }, cutoff)).toBe(false);
    expect(isContentEligibleForPurge({ status: 'published' }, cutoff)).toBe(false);
  });

  it('purges only completed projects with completedAt before cutoff', () => {
    expect(isProjectEligibleForPurge({ status: 'completed', completedAt: oldDate }, cutoff)).toBe(true);
    expect(isProjectEligibleForPurge({ status: 'in-development', completedAt: oldDate }, cutoff)).toBe(
      false
    );
    expect(isProjectEligibleForPurge({ status: 'completed' }, cutoff)).toBe(false);
  });

  it('flags legacy rows missing terminal timestamps', () => {
    expect(isLegacyRetentionCandidate('task', { status: 'completed' })).toBe(true);
    expect(isLegacyRetentionCandidate('content', { status: 'published' })).toBe(true);
    expect(isLegacyRetentionCandidate('project', { status: 'completed' })).toBe(true);
    expect(
      isLegacyRetentionCandidate('task', { status: 'completed', completedAt: oldDate })
    ).toBe(false);
  });
});

describe('findRemovedTasks', () => {
  it('detects tasks removed by id from project updates', () => {
    const previous = [
      { _id: { toString: () => 'aaa' } },
      { _id: { toString: () => 'bbb' } },
    ];
    const next = [{ _id: { toString: () => 'bbb' } }];
    expect(findRemovedTasks(previous, next)).toEqual([{ taskId: 'aaa', taskIndex: 0 }]);
  });
});
