/**
 * Who uses this file, and what does this page use? Follows references between files backwards
 * (importers) and forwards (dependencies, plus calls to the app's own HTTP routes) through a repository
 * snapshot, so a planner can go from "where is this data defined" to "which page shows it" and back.
 * Languages and platforms are handled in imports.ts; URL-to-file mapping in routes.ts.
 */
import { buildRepoIndex, dependenciesOf, normalizePath } from './imports';
import { collectRoutes, routeFileFor as findRouteFile, routeForFile, type RouteEntry } from './routes';

export { routeForFile };

/** Everything derived from a snapshot that tracing needs, computed once per snapshot. */
interface Analysis {
  routes: RouteEntry[];
  /** file → files it depends on. */
  uses: Map<string, Set<string>>;
  /** file → files that depend on it. */
  usedBy: Map<string, Set<string>>;
  /** file → routes it serves (by location or registration). */
  routesByFile: Map<string, string[]>;
}

const cache = new WeakMap<Map<string, string>, Analysis>();

function analyze(files: Map<string, string>): Analysis {
  const cached = cache.get(files);
  if (cached) return cached;
  const index = buildRepoIndex(files);
  const uses = new Map<string, Set<string>>();
  const usedBy = new Map<string, Set<string>>();
  for (const [path, content] of files) {
    if (content.length > 400_000) continue;
    for (const dependency of dependenciesOf(path, content, index)) {
      (uses.get(path) ?? uses.set(path, new Set()).get(path)!).add(dependency);
      (usedBy.get(dependency) ?? usedBy.set(dependency, new Set()).get(dependency)!).add(path);
    }
  }
  const routes = collectRoutes(files, index);
  // Calling one of the app's own HTTP routes is a dependency on the file that serves it.
  const handlers = routes.filter((r) => r.kind === 'handler' && r.route.length > 1);
  if (handlers.length) {
    for (const [path, content] of files) {
      if (content.length > 400_000) continue;
      for (const served of routeCalls(content, handlers)) {
        if (served === path) continue;
        (uses.get(path) ?? uses.set(path, new Set()).get(path)!).add(served);
        (usedBy.get(served) ?? usedBy.set(served, new Set()).get(served)!).add(path);
      }
    }
  }
  const routesByFile = new Map<string, string[]>();
  for (const entry of routes) (routesByFile.get(entry.file) ?? routesByFile.set(entry.file, []).get(entry.file)!).push(entry.route);
  const analysis: Analysis = { routes, uses, usedBy, routesByFile };
  cache.set(files, analysis);
  return analysis;
}

/** Reverse import graph: target path → files that import it. */
export function buildImporters(files: Map<string, string>): Map<string, Set<string>> {
  return analyze(files).usedBy;
}

/** Files that call the app's own HTTP routes, through path literals such as '/api/users' or `/api/users/${id}`. */
function routeCalls(content: string, handlers: RouteEntry[]): string[] {
  const found = new Set<string>();
  for (const m of content.matchAll(/['"`](?:https?:\/\/[^/'"`\s]+)?(\/[^'"`?\s#]*)/g)) {
    const literal = m[1].replace(/\$\{[^}]*\}/g, 'x').replace(/\/+$/, '');
    if (literal.length < 2) continue;
    for (const handler of handlers) if (handler.pattern.test(literal)) found.add(handler.file);
  }
  // WordPress: a script posting { action: 'save_thing' } reaches the wp_ajax_save_thing handler.
  for (const m of content.matchAll(/\baction\b['"]?\s*[:=]\s*['"](\w+)['"]/g)) {
    for (const handler of handlers) if (handler.route.endsWith(`admin-ajax.php?action=${m[1].toLowerCase()}`) || handler.route.endsWith(`admin-ajax.php?action=${m[1]}`)) found.add(handler.file);
  }
  return [...found];
}

export interface ReferenceNode {
  path: string;
  /** How many hops away from the target (1 = uses it directly). */
  depth: number;
  route: string | null;
}

export interface ReferenceResult {
  target: string;
  references: ReferenceNode[];
  routes: string[];
  truncated: boolean;
}

/** Routes a file serves, but not for files that register a great many (a central router is not one page). */
function routesOf(analysis: Analysis, file: string): string[] {
  const routes = analysis.routesByFile.get(file) ?? [];
  return routes.length <= 6 ? routes : [];
}

/** Who depends on `target`, hop by hop, and the routes those files serve. */
export function findReferences(files: Map<string, string>, target: string, options: { maxDepth?: number; limit?: number } = {}): ReferenceResult | { error: string } {
  const path = normalizePath(target);
  if (!files.has(path)) return { error: `No file at "${path}". Use repo_search or repo_tree to find the right path.` };
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 3, 1), 6);
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  const analysis = analyze(files);
  const seen = new Set([path]);
  const references: ReferenceNode[] = [];
  let frontier = [path];
  let truncated = false;
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const importer of [...(analysis.usedBy.get(current) ?? [])].sort()) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        if (references.length >= limit) { truncated = true; continue; }
        references.push({ path: importer, depth, route: routesOf(analysis, importer)[0] ?? null });
        next.push(importer);
      }
    }
    frontier = next;
  }
  const routes = [...new Set(references.flatMap((r) => routesOf(analysis, r.path)))].sort();
  return { target: path, references, routes, truncated };
}

/** Everything a file depends on: what it imports or includes, and the app's own routes it calls. */
export function reachableFrom(files: Map<string, string>, start: string, options: { maxDepth?: number; limit?: number } = {}): string[] {
  const analysis = analyze(files);
  const handlers = analysis.routes.filter((r) => r.kind === 'handler' && r.route.length > 1);
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 6, 1), 10);
  const limit = Math.min(Math.max(options.limit ?? 400, 1), 2000);
  const seen = new Set([start]);
  const order: string[] = [];
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const dependency of [...(analysis.uses.get(current) ?? []), ...routeCalls(files.get(current) ?? '', handlers)]) {
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

/** The file that serves a URL named in the request (see routes.ts). */
export function routeFileFor(files: Map<string, string>, text: string): { file: string; route: string } | null {
  return findRouteFile(files, text, analyze(files).routes);
}

// ---------- Chains and connecting lines ----------

/**
 * Shortest chain of dependencies from `start` to each of `targets` (start first, target last), following
 * imports and calls to the app's own routes. Targets that cannot be reached are omitted.
 */
export function shortestPaths(files: Map<string, string>, start: string, targets: Set<string>, options: { maxDepth?: number } = {}): Map<string, string[]> {
  const analysis = analyze(files);
  const handlers = analysis.routes.filter((r) => r.kind === 'handler' && r.route.length > 1);
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 8, 1), 12);
  const parent = new Map<string, string>();
  const seen = new Set([start]);
  const found = new Map<string, string[]>();
  let frontier = [start];
  const chainTo = (node: string): string[] => {
    const chain = [node];
    while (chain[0] !== start) chain.unshift(parent.get(chain[0])!);
    return chain;
  };
  for (let depth = 1; depth <= maxDepth && frontier.length && found.size < targets.size; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const dependency of [...(analysis.uses.get(current) ?? []), ...routeCalls(files.get(current) ?? '', handlers)]) {
        if (seen.has(dependency)) continue;
        seen.add(dependency);
        parent.set(dependency, current);
        next.push(dependency);
        if (targets.has(dependency)) found.set(dependency, chainTo(dependency));
      }
    }
    frontier = next;
  }
  return found;
}

/** The line in `from` that leads to `to`: the import/include line, or the call to one of `to`'s routes. */
export function connectingLine(files: Map<string, string>, from: string, to: string): { line: number; text: string } | null {
  const content = files.get(from);
  if (content === undefined) return null;
  const lines = content.split('\n');
  const clip = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 160);
  const analysis = analyze(files);
  // A call to one of the target's HTTP routes.
  const routes = analysis.routes.filter((r) => r.file === to && r.kind === 'handler' && r.route.length > 1);
  if (routes.length) {
    for (let i = 0; i < lines.length; i += 1) {
      for (const m of lines[i].matchAll(/['"`](?:https?:\/\/[^/'"`\s]+)?(\/[^'"`?\s#]*)/g)) {
        const literal = m[1].replace(/\$\{[^}]*\}/g, 'x').replace(/\/+$/, '');
        if (literal.length > 1 && routes.some((r) => r.pattern.test(literal))) return { line: i + 1, text: clip(lines[i]) };
      }
    }
  }
  // An import or include of the target file, found by its name.
  const segments = to.replace(/\.[^./]+$/, '').replace(/\/(?:index|__init__)$/, '').split('/');
  const tail = segments[segments.length - 1];
  const tail2 = segments.slice(-2).join('/');
  const escaped = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const needle of [tail2, tail]) {
    const re = new RegExp(`(?<![\\w-])${escaped(needle)}(?![\\w-])`);
    const index = lines.findIndex((l) => re.test(l) && /import|require|include|from|use\b|render|@extends|get_template_part|layout|section/i.test(l));
    if (index >= 0) return { line: index + 1, text: clip(lines[index]) };
  }
  return null;
}
