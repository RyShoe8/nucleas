/**
 * Who uses this file? Follows import/export/require edges backwards through a repository snapshot so
 * a planner can go from "where is the data defined" to "which page renders it" without guessing.
 */

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Files a specifier could mean, or [] for packages. `@/` is the src alias used across the codebase. */
function candidates(importer: string, spec: string): string[] {
  let base: string;
  if (spec.startsWith('.')) base = normalize(`${dirname(importer)}/${spec}`);
  else if (spec.startsWith('@/')) base = normalize(`src/${spec.slice(2)}`);
  else return [];
  return [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`)];
}

/** Next.js App Router route for a page/route file, e.g. src/app/admin/(x)/games/page.tsx → /admin/games. */
export function routeForFile(path: string): string | null {
  const m = /(?:^|\/)app\/(.*?)\/?(?:page|route)\.(?:[jt]sx?|mdx)$/.exec(path);
  if (!m) return null;
  const segments = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return `/${segments.join('/')}`;
}

export interface ReferenceNode {
  path: string;
  /** How many imports away from the target (1 = imports it directly). */
  depth: number;
  route: string | null;
}

export interface ReferenceResult {
  target: string;
  references: ReferenceNode[];
  routes: string[];
  truncated: boolean;
}

/** Reverse import graph: target path → files that import it. */
export function buildImporters(files: Map<string, string>): Map<string, Set<string>> {
  const importers = new Map<string, Set<string>>();
  for (const [path, content] of files) {
    if (!/\.(?:[cm]?[jt]sx?)$/.test(path)) continue;
    for (const match of content.matchAll(SPEC)) {
      for (const candidate of candidates(path, match[2])) {
        if (candidate !== path && files.has(candidate)) {
          let set = importers.get(candidate);
          if (!set) importers.set(candidate, (set = new Set()));
          set.add(path);
          break;
        }
      }
    }
  }
  return importers;
}

export function findReferences(files: Map<string, string>, target: string, options: { maxDepth?: number; limit?: number } = {}): ReferenceResult | { error: string } {
  const path = normalize(target);
  if (!files.has(path)) return { error: `No file at "${path}". Use repo_search or repo_tree to find the right path.` };
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 3, 1), 6);
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  const importers = buildImporters(files);
  const seen = new Set([path]);
  const references: ReferenceNode[] = [];
  let frontier = [path];
  let truncated = false;
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const importer of [...(importers.get(current) ?? [])].sort()) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        if (references.length >= limit) { truncated = true; continue; }
        references.push({ path: importer, depth, route: routeForFile(importer) });
        next.push(importer);
      }
    }
    frontier = next;
  }
  const routes = [...new Set(references.map((r) => r.route).filter((r): r is string => Boolean(r)))].sort();
  return { target: path, references, routes, truncated };
}
