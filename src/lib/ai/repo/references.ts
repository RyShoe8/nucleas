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

/**
 * The `src/` folder an `@/` alias points into, taken from the importing file's own path, so a project in
 * a subfolder (platform/src/...) resolves to platform/src/ and not to a top-level src/.
 */
function srcRoot(importer: string): string {
  if (importer.startsWith('src/')) return 'src/';
  const at = importer.indexOf('/src/');
  return at >= 0 ? importer.slice(0, at + 5) : 'src/';
}

/** Files a specifier could mean, or [] for packages. `@/` is the src alias used across the codebase. */
function candidates(importer: string, spec: string): string[] {
  let base: string;
  if (spec.startsWith('.')) base = normalize(`${dirname(importer)}/${spec}`);
  else if (spec.startsWith('@/')) base = normalize(`${srcRoot(importer)}${spec.slice(2)}`);
  else return [];
  return [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`)];
}

/**
 * Route for a Next.js page or API route file. Handles the App Router (page and route files under app/)
 * and the Pages Router (files under pages/, with index files and _app/_document ignored). Other
 * frameworks return null.
 */
export function routeForFile(path: string): string | null {
  const app = /(?:^|\/)app\/(.*?)\/?(?:page|route)\.(?:[jt]sx?|mdx)$/.exec(path);
  if (app) {
    const segments = app[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
    return `/${segments.join('/')}`;
  }
  const pages = /(?:^|\/)pages\/(.*)\.(?:[jt]sx?|mdx)$/.exec(path);
  if (pages && !/(?:^|\/)_(?:app|document|error)$/.test(pages[1]) && !/\.(?:test|spec)$/.test(pages[1])) {
    const segments = pages[1].split('/').filter(Boolean);
    if (segments[segments.length - 1] === 'index') segments.pop();
    return `/${segments.join('/')}`;
  }
  return null;
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

// ---------- Forward tracing: what does this page use? ----------

/** `/api/x/[id]/y` route files as patterns a fetched path can be matched against. */
function apiRoutePatterns(files: Map<string, string>): { file: string; pattern: RegExp }[] {
  const out: { file: string; pattern: RegExp }[] = [];
  for (const file of files.keys()) {
    const m = /(?:^|\/)app(\/api\/.*)\/route\.[jt]sx?$/.exec(file) ?? /(?:^|\/)pages(\/api\/.*?)(?:\/index)?\.[jt]sx?$/.exec(file);
    if (!m) continue;
    const source = m[1]
      .replace(/[.+?^${}()|\\]/g, '\\$&')
      .replace(/\/\[\[?\.\.\.[^\]]+\]\]?/g, '(?:/.+)?')
      .replace(/\[[^\]]+\]/g, '[^/]+');
    out.push({ file, pattern: new RegExp(`^${source}$`) });
  }
  return out;
}

/** Route files a source file calls through fetch/axios-style string literals like '/api/admin/x' or `/api/x/${id}`. */
function apiCalls(content: string, routes: { file: string; pattern: RegExp }[]): string[] {
  const found = new Set<string>();
  for (const m of content.matchAll(/['"`](\/api\/[^'"`?\s]*)/g)) {
    const literal = m[1].replace(/\$\{[^}]*\}/g, 'x').replace(/\/+$/, '');
    for (const route of routes) if (route.pattern.test(literal)) found.add(route.file);
  }
  return [...found];
}

/** Everything a file depends on, following imports and calls to the app's own /api routes. */
export function reachableFrom(files: Map<string, string>, start: string, options: { maxDepth?: number; limit?: number } = {}): string[] {
  const importers = buildImporters(files);
  const uses = new Map<string, Set<string>>();
  for (const [dependency, from] of importers) {
    for (const path of from) {
      let set = uses.get(path);
      if (!set) uses.set(path, (set = new Set()));
      set.add(dependency);
    }
  }
  const routes = apiRoutePatterns(files);
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 6, 1), 10);
  const limit = Math.min(Math.max(options.limit ?? 400, 1), 2000);
  const seen = new Set([start]);
  const order: string[] = [];
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const dependency of [...(uses.get(current) ?? []), ...apiCalls(files.get(current) ?? '', routes)]) {
        if (seen.has(dependency) || order.length >= limit) continue;
        seen.add(dependency);
        order.push(dependency);
        next.push(dependency);
      }
    }
    frontier = next;
  }
  return order;
}

/**
 * The page or route file a request is talking about, from a URL path in the text
 * ("example.com/admin/users/settings" → .../app/admin/users/settings/page.tsx, or pages/admin/users/settings.tsx).
 */
export function routeFileFor(files: Map<string, string>, text: string): { file: string; route: string } | null {
  const wanted = [...text.matchAll(/(?:^|[\s(])(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+)?(\/[a-z0-9_-]+(?:\/[a-z0-9_[\]-]+)+)/gi)].map((m) => m[1].toLowerCase());
  if (!wanted.length) return null;
  const candidates: { file: string; route: string }[] = [];
  for (const file of files.keys()) {
    const route = routeForFile(file);
    if (route && wanted.includes(route.toLowerCase())) candidates.push({ file, route });
  }
  // Prefer a page over an API route of the same path.
  return candidates.sort((a, b) => Number(/\/route\./.test(a.file)) - Number(/\/route\./.test(b.file)) || a.file.localeCompare(b.file))[0] ?? null;
}
