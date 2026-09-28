import type { LoadedSnapshot } from './snapshot';

/**
 * The project's own guidance for anyone changing its code, gathered from the repository: agent and
 * contributor instructions, the README, the scripts that check the code, and the top-level layout.
 * Given to code planners and builders so changes follow the project's conventions and run its checks.
 */

/** Instruction files, most specific to AI coding first. */
const GUIDE_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.github/copilot-instructions.md',
  '.cursorrules',
  '.windsurfrules',
  'CONTRIBUTING.md',
  'docs/ARCHITECTURE.md',
  'ARCHITECTURE.md',
  'README.md',
];

function find(snapshot: LoadedSnapshot, path: string): string | undefined {
  if (snapshot.files.has(path)) return snapshot.files.get(path);
  const lower = path.toLowerCase();
  for (const [p, content] of snapshot.files) if (p.toLowerCase() === lower) return content;
  return undefined;
}

function packageSummary(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const pkg = JSON.parse(raw) as { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; packageManager?: string };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const notable = ['next', 'react', 'vue', 'svelte', '@angular/core', 'express', 'mongoose', 'prisma', 'drizzle-orm', 'tailwindcss', 'typescript', 'vitest', 'jest', 'playwright', 'eslint']
      .filter((d) => deps[d])
      .map((d) => `${d}@${deps[d]}`);
    const scripts = Object.entries(pkg.scripts ?? {})
      .filter(([name]) => /^(dev|build|start|lint|test|typecheck|type-check|check|format|e2e)/.test(name))
      .map(([name, cmd]) => `  - npm run ${name}: ${cmd}`);
    return [
      `package: ${pkg.name ?? '(unnamed)'}${pkg.packageManager ? ` (${pkg.packageManager})` : ''}`,
      notable.length ? `stack: ${notable.join(', ')}` : '',
      scripts.length ? `checks and scripts:\n${scripts.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    return null;
  }
}

function topLevel(snapshot: LoadedSnapshot): string {
  const entries = new Set<string>();
  for (const path of [...snapshot.files.keys(), ...snapshot.skipped]) {
    const [first, ...rest] = path.split('/');
    entries.add(rest.length ? `${first}/` : first);
  }
  return [...entries].sort((a, b) => (a.endsWith('/') === b.endsWith('/') ? a.localeCompare(b) : a.endsWith('/') ? -1 : 1)).slice(0, 80).join('  ');
}

export function projectGuide(snapshot: LoadedSnapshot, maxChars = 20_000): string {
  const parts: string[] = [
    `Repository ${snapshot.owner}/${snapshot.repo} at ${snapshot.commit.slice(0, 12)} (${snapshot.files.size} text files)`,
    `Top level: ${topLevel(snapshot)}`,
  ];
  const pkg = packageSummary(find(snapshot, 'package.json'));
  if (pkg) parts.push(pkg);

  let used = parts.join('\n').length;
  const cursorRules = [...snapshot.files.keys()].filter((p) => /^\.cursor\/rules\/.+\.mdc?$/i.test(p)).slice(0, 5);
  for (const path of [...GUIDE_FILES.slice(0, 5), ...cursorRules, ...GUIDE_FILES.slice(5)]) {
    const content = find(snapshot, path);
    if (!content?.trim()) continue;
    const room = maxChars - used - 200;
    if (room < 500) break;
    const body = content.trim().slice(0, Math.min(8000, room));
    parts.push(`--- ${path} ---\n${body}${body.length < content.trim().length ? '\n[…]' : ''}`);
    used += body.length + path.length + 10;
  }
  return parts.join('\n\n');
}
