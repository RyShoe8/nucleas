import { describe, expect, it } from 'vitest';
import { evaluateDefinitionOfDone, formatDefinitionOfDone } from './definitionOfDone';

const dod = (command: string[], exitCode: number | null, output = '', extra: { timedOut?: boolean } = {}) =>
  ({ command, exitCode, timedOut: extra.timedOut ?? false, output, kind: 'definition_of_done' as const });

describe('evaluateDefinitionOfDone', () => {
  it('ignores commands the model ran itself', () => {
    expect(evaluateDefinitionOfDone([{ command: ['npm', 'test'], exitCode: 0, timedOut: false, output: 'ok' }])).toEqual({ ran: false, state: 'none', checks: [] });
  });

  it('passes only when every check passed', () => {
    const result = evaluateDefinitionOfDone([dod(['npm', 'ci'], 0), dod(['npm', 'run', 'typecheck'], 0), dod(['npx', '--no-install', 'eslint', 'a.ts'], 0)]);
    expect(result.state).toBe('passed');
    expect(result.checks.map((c) => c.name)).toEqual(['install', 'typecheck', 'lint']);
  });

  it('reports a real failure with the output tail, and still shows the passing checks', () => {
    const result = evaluateDefinitionOfDone([dod(['npm', 'run', 'typecheck'], 2, `${'x'.repeat(3000)}\nsrc/a.ts(3,1): error TS2304`), dod(['npx', '--no-install', 'eslint', 'a.ts'], 0)]);
    expect(result.state).toBe('failed');
    const text = formatDefinitionOfDone(result);
    expect(text).toContain('FAILED');
    expect(text).toContain('error TS2304');
    expect(text).toContain('✅ lint');
    expect(text.length).toBeLessThan(2500);
  });

  it('treats a failed install or a skipped check as incomplete, not as a code failure', () => {
    expect(evaluateDefinitionOfDone([dod(['npm', 'ci'], 1, 'network unreachable')]).state).toBe('incomplete');
    expect(evaluateDefinitionOfDone([dod(['npm', 'run', 'typecheck'], null, 'Skipped typecheck: the worker ran out of time before it could start.')]).state).toBe('incomplete');
  });
});
