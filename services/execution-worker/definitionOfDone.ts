import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { runCommand, type CommandEvidence } from './runtime';

/**
 * "Definition of done": after the model finishes, the worker itself runs the repository's typecheck and
 * lint on the result, independent of anything the model claims. Results are returned as evidence tagged
 * `definition_of_done` so Nucleas can show them to the Reviewer.
 */

export type DodEvidence = CommandEvidence & { kind: 'definition_of_done' };
export interface DodCheck { name: 'install' | 'typecheck' | 'lint'; argv: string[] }
export interface DodPlanInput { packageJson: Record<string, unknown> | null; hasTsconfig: boolean; hasLockfile: boolean; hasNodeModules: boolean; changedFiles: string[] }

const LINTABLE = /\.(?:[cm]?[jt]sx?)$/;
const SAFE_PATH = /^[A-Za-z0-9_@./()[\]+-]+$/;

function scripts(pkg: Record<string, unknown> | null): Record<string, string> {
  const value = pkg?.scripts;
  return value && typeof value === 'object' ? (value as Record<string, string>) : {};
}

function hasDependency(pkg: Record<string, unknown> | null, name: string): boolean {
  for (const key of ['dependencies', 'devDependencies']) {
    const group = pkg?.[key];
    if (group && typeof group === 'object' && name in (group as object)) return true;
  }
  return false;
}

/** Pure: decide which checks apply. Returns [] for repositories with no Node project. */
export function planDefinitionOfDone(input: DodPlanInput): DodCheck[] {
  const pkg = input.packageJson;
  if (!pkg) return [];
  const checks: DodCheck[] = [];
  const s = scripts(pkg);
  const typecheckScript = ['typecheck', 'type-check'].find((name) => s[name]);
  const lintFiles = input.changedFiles.filter((file) => LINTABLE.test(file) && SAFE_PATH.test(file) && !file.startsWith('-')).slice(0, 30);
  let typecheck: DodCheck | null = null;
  if (typecheckScript) typecheck = { name: 'typecheck', argv: ['npm', 'run', typecheckScript] };
  else if (input.hasTsconfig && hasDependency(pkg, 'typescript')) typecheck = { name: 'typecheck', argv: ['npx', '--no-install', 'tsc', '--noEmit'] };
  let lint: DodCheck | null = null;
  if (hasDependency(pkg, 'eslint') && lintFiles.length) lint = { name: 'lint', argv: ['npx', '--no-install', 'eslint', ...lintFiles] };
  else if (s.lint) lint = { name: 'lint', argv: ['npm', 'run', 'lint'] };
  if (!typecheck && !lint) return [];
  if (!input.hasNodeModules) {
    checks.push({ name: 'install', argv: input.hasLockfile ? ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'] : ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'] });
  }
  if (typecheck) checks.push(typecheck);
  if (lint) checks.push(lint);
  return checks;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true, () => false);
}

/**
 * Runs the planned checks inside the workspace within a time budget. Stops after a failed install
 * (nothing else can run) but still runs both typecheck and lint when either fails, so one round of
 * feedback covers everything.
 */
export async function runDefinitionOfDone(input: {
  workspace: string;
  changedFiles: string[];
  allowedExecutables: Set<string>;
  /** Absolute ms timestamp after which no new check may start. */
  deadline: number;
  perCommandTimeoutMs: number;
  spawnOptions?: { uid?: number; gid?: number; extraEnv?: Record<string, string> };
}): Promise<DodEvidence[]> {
  let packageJson: Record<string, unknown> | null = null;
  try { packageJson = JSON.parse(await readFile(path.join(input.workspace, 'package.json'), 'utf8')) as Record<string, unknown>; } catch { return []; }
  const plan = planDefinitionOfDone({
    packageJson,
    hasTsconfig: await exists(path.join(input.workspace, 'tsconfig.json')),
    hasLockfile: await exists(path.join(input.workspace, 'package-lock.json')),
    hasNodeModules: await exists(path.join(input.workspace, 'node_modules')),
    changedFiles: input.changedFiles,
  });
  const results: DodEvidence[] = [];
  for (const check of plan) {
    const remaining = input.deadline - Date.now();
    if (remaining < 5_000) {
      results.push({ kind: 'definition_of_done', command: check.argv, exitCode: null, timedOut: true, output: `Skipped ${check.name}: the worker ran out of time before it could start.` });
      continue;
    }
    if (!input.allowedExecutables.has(check.argv[0])) {
      results.push({ kind: 'definition_of_done', command: check.argv, exitCode: null, timedOut: false, output: `Skipped ${check.name}: ${check.argv[0]} is not an allowed executable on this worker.` });
      continue;
    }
    const record = await runCommand({
      cwd: input.workspace, argv: check.argv, allowedExecutables: input.allowedExecutables,
      timeoutMs: Math.min(input.perCommandTimeoutMs, remaining), outputLimit: 8_000, ...input.spawnOptions,
    }).catch((error): CommandEvidence => ({ command: check.argv, exitCode: null, timedOut: false, output: error instanceof Error ? error.message : 'Check failed to start.' }));
    results.push({ ...record, kind: 'definition_of_done' });
    if (check.name === 'install' && (record.exitCode !== 0 || record.timedOut)) break;
  }
  return results;
}
