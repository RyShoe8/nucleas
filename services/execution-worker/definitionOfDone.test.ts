import { describe, expect, it } from 'vitest';
import { planDefinitionOfDone } from './definitionOfDone';

const base = { hasTsconfig: true, hasLockfile: true, hasNodeModules: false, changedFiles: ['src/a.ts', 'README.md', 'src/b.tsx'] };

describe('planDefinitionOfDone', () => {
  it('installs, typechecks with the repo script, and lints only the changed source files', () => {
    const plan = planDefinitionOfDone({ ...base, packageJson: { scripts: { typecheck: 'tsc -p .', lint: 'eslint' }, devDependencies: { eslint: '9', typescript: '5' } } });
    expect(plan.map((c) => c.argv.join(' '))).toEqual([
      'npm ci --ignore-scripts --no-audit --no-fund',
      'npm run typecheck',
      'npx --no-install eslint src/a.ts src/b.tsx',
    ]);
  });

  it('falls back to tsc --noEmit and the lint script, and skips install when node_modules exists', () => {
    const plan = planDefinitionOfDone({ ...base, hasNodeModules: true, changedFiles: ['x.py'], packageJson: { scripts: { lint: 'next lint' }, dependencies: { typescript: '5' } } });
    expect(plan.map((c) => c.argv.join(' '))).toEqual(['npx --no-install tsc --noEmit', 'npm run lint']);
  });

  it('does nothing for non-Node repositories or ones with no checks, and never passes flag-like file names to eslint', () => {
    expect(planDefinitionOfDone({ ...base, packageJson: null })).toEqual([]);
    expect(planDefinitionOfDone({ ...base, packageJson: { scripts: {} } })).toEqual([]);
    const plan = planDefinitionOfDone({ ...base, hasNodeModules: true, changedFiles: ['--fix.ts', 'ok.ts'], packageJson: { devDependencies: { eslint: '9' } } });
    expect(plan[0].argv).toEqual(['npx', '--no-install', 'eslint', 'ok.ts']);
  });
});
