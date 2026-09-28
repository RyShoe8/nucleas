import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { executionWorkerResponseSchema } from '@nucleas/ai-contracts';
import { verifyExecutionWorkerPayload } from './executionWorkerClient';

function result(overrides: Record<string, unknown> = {}) {
  return executionWorkerResponseSchema.parse({
    protocolVersion: 1,
    requestId: '11111111-1111-4111-8111-111111111111',
    routing: { requestedModel: 'coder', providerReportedModels: ['coder'] },
    status: 'completed',
    summary: 'Updated the file.',
    baseCommit: 'a'.repeat(40),
    patch: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
    changedFiles: ['src/a.ts'],
    evidence: [{ command: ['npm', 'test'], exitCode: 0, timedOut: false, output: 'passed' }],
    limitations: [],
    ...overrides,
  });
}

describe('execution worker payload verification', () => {
  it('hashes the actual patch and records observed command outcomes', () => {
    expect(verifyExecutionWorkerPayload(result())).toMatchObject({ verified: true, checksObserved: 1, checksPassed: 1 });
  });

  it('rejects completion claims that do not match the returned patch', () => {
    expect(() => verifyExecutionWorkerPayload(result({ changedFiles: ['src/missing.ts'] }))).toThrow(/does not contain/);
    expect(() => verifyExecutionWorkerPayload(result({ patch: '', changedFiles: [] }))).toThrow(/without a patch/);
  });

  it('rejects unsafe changed-file paths', () => {
    expect(() => verifyExecutionWorkerPayload(result({ changedFiles: ['../secret'] }))).toThrow(/unsafe/);
  });
});
