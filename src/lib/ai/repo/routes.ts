/**
 * Which URL a file serves, and which file serves a URL, across common web frameworks. Pure string work
 * over a repository snapshot: no framework is executed or required to be installed.
 *
 * Two families:
 *  - file-based routing, where the path of the file is the URL (Next.js, SvelteKit, Nuxt, Astro, Remix);
 *  - routes declared in code, found by reading registration calls (Express-style, React/Vue Router,
 *    Flask/FastAPI, Django, Rails, Laravel, Go, Spring);
 * plus platforms where the URL maps to a template by convention: WordPress themes (template hierarchy,
 * REST routes, admin pages, rewrite rules) and Shopify themes (fixed URL → template table).
 */

import { buildRepoIndex, type RepoIndex } from './imports';

export type RouteKind = 'page' | 'handler';

export interface RouteEntry {
  /** URL path, params written as :name (e.g. /users/:id). Code-declared child routes may be relative. */
  route: string;
  file: string;
  kind: RouteKind;
  source: 'file' | 'code';
  /** Matches a concrete request path such as /users/42. */
  pattern: RegExp;
  /** A catch-all that only applies when nothing more specific matches (WordPress page.php, Shopify alternates). */
  fallback?: number;
}

// ---------- URL patterns ----------

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|\\]/g, '\\$&');
}

/** A concrete-path matcher for a route: :id, {id}, <int:id>, [id] and * become wildcards. */
export function routePattern(route: string): RegExp {
  const source = route
    .split('/')
    .map((segment) => {
      if (/^(?:\*+|:\w+\*|\[\.\.\.[^\]]+\]|\[\[\.\.\.[^\]]+\]\]|\{\w+\*\}|\*\w*)$/.test(segment)) return '.+';
      if (/^(?::[\w-]+\??|\{[^}]+\}|<[^>]+>|\[[^\]]+\])$/.test(segment)) return '[^/]+';
      return escapeRegex(segment);
    })
    .join('/');
  return new RegExp(`^${source}/?$`, 'i');
}

function normalizeRoute(route: string): string {
  const collapsed = `/${route}`.replace(/\/+/g, '/').replace(/\/$/, '');
  return collapsed || '/';
}

/** `[id]` / `$id` / `<int:id>` / `{id}` → `:id`; catch-alls → `*`. */
function paramSegment(segment: string): string {
  if (/^\[\[?\.\.\.[^\]]*\]\]?$/.test(segment) || segment === '$' || /^\+?\*/.test(segment)) return '*';
  const bracket = /^\[\[?([^\].]+)\]\]?$/.exec(segment);
  if (bracket) return `:${bracket[1]}`;
  if (segment.startsWith('$') && segment.length > 1) return `:${segment.slice(1)}`;
  return segment;
}

// ---------- Which file-routing framework a project uses ----------

export type Framework = 'next' | 'nuxt' | 'astro' | 'sveltekit' | 'remix';

const FRAMEWORK_PACKAGES: [RegExp, Framework][] = [
  [/^next$/, 'next'], [/^nuxt3?$|^@nuxt\//, 'nuxt'], [/^astro$/, 'astro'], [/^@sveltejs\/kit$/, 'sveltekit'],
  [/^@remix-run\/|^@react-router\/dev$/, 'remix'],
];

/** Directory of each package.json → the file-routing frameworks it depends on (possibly none). */
function frameworkIndex(files: Map<string, string>): Map<string, Set<Framework>> {
  const index = new Map<string, Set<Framework>>();
  for (const [path, content] of files) {
    if (!path.endsWith('package.json') || (path !== 'package.json' && !path.endsWith('/package.json')) || path.includes('node_modules/')) continue;
    try {
      const pkg = JSON.parse(content) as { dependencies?: object; devDependencies?: object };
      const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
      index.set(path.slice(0, -'package.json'.length).replace(/\/$/, ''), new Set(FRAMEWORK_PACKAGES.filter(([re]) => names.some((n) => re.test(n))).map(([, f]) => f)));
    } catch { /* not valid JSON */ }
  }
  return index;
}

/**
 * The frameworks of the nearest package.json above a file, or null when there is none (then every
 * convention is tried). An empty set means a project with no file-routing framework, such as a Vite or
 * Create React App project, where a `pages/` folder holds components and not routes.
 */
function frameworksFor(path: string, index: Map<string, Set<Framework>>): Set<Framework> | null {
  let dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  for (;;) {
    const found = index.get(dir);
    if (found) return found;
    if (!dir) return null;
    dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
  }
}

// ---------- File-based routing ----------

const PAGE_EXT = 'tsx|jsx|vue|astro|mdx?|svelte';
const CODE_EXT = '[cm]?[jt]s';

/** Route for a file whose location defines its URL, or null. Covers Next, SvelteKit, Nuxt, Astro, Remix. */
export function fileRoute(path: string, frameworks: Set<Framework> | null = null): { route: string; kind: RouteKind } | null {
  let m: RegExpExecArray | null;
  const uses = (f: Framework) => !frameworks || frameworks.has(f);

  // SvelteKit: src/routes/<url>/+page.svelte (page) and +server.ts (endpoint).
  if (uses('sveltekit') && (m = new RegExp(`(?:^|/)src/routes/(.*?)/?\\+(page|server)\\.(?:svelte|${CODE_EXT})$`).exec(path))) {
    const segments = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s)).map(paramSegment);
    return { route: normalizeRoute(segments.join('/')), kind: m[2] === 'server' ? 'handler' : 'page' };
  }

  // Next.js App Router: page and route files under app/ (unless this is a Remix routes folder).
  if (uses('next') && (m = new RegExp(`(?:^|/)app/(.*?)/?(page|route)\\.(?:[jt]sx?|mdx)$`).exec(path)) && !/(?:^|\/)app\/routes\//.test(path)) {
    const segments = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')).map(paramSegment);
    return { route: normalizeRoute(segments.join('/')), kind: m[2] === 'route' ? 'handler' : 'page' };
  }

  // Remix / React Router file routes: app/routes/admin.users.tsx, admin.$id/route.tsx, _index.tsx.
  if (uses('remix') && (m = /(?:^|\/)app\/routes\/(.+?)\.(?:[jt]sx?|mdx?)$/.exec(path))) {
    let name = m[1].replace(/\/(?:route|index)$/, '').replace(/\//g, '.');
    if (/\.(?:server|client)$/.test(name)) return null;
    name = name.replace(/\._index$/, '').replace(/^_index$/, '');
    const segments = name
      .split('.')
      .filter((s) => s && !s.startsWith('_') && !/^\(.*\)$/.test(s))
      .map((s) => paramSegment(s.replace(/_$/, '')));
    return { route: normalizeRoute(segments.join('/')), kind: 'page' };
  }

  // Nuxt server routes: server/api/users/[id].get.ts → /api/users/:id, server/routes/x.ts → /x.
  if (uses('nuxt') && (m = new RegExp(`(?:^|/)server/(api|routes)/(.*)\\.${CODE_EXT}$`).exec(path))) {
    const segments = m[2].replace(/\.(?:get|post|put|patch|delete)$/, '').split('/').filter(Boolean);
    if (segments[segments.length - 1] === 'index') segments.pop();
    return { route: normalizeRoute([...(m[1] === 'api' ? ['api'] : []), ...segments.map(paramSegment)].join('/')), kind: 'handler' };
  }

  // pages/ directory: Next Pages Router, Nuxt (.vue), Astro (.astro/.md, or ts/js endpoints).
  if ((m = new RegExp(`(?:^|/)pages/(.*)\\.(${PAGE_EXT}|${CODE_EXT})$`).exec(path))) {
    const segments = m[1].split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (/^_/.test(last) || segments.some((s) => s.startsWith('_') && s !== last) || /\.(?:test|spec)$/.test(last)) return null;
    if (last === 'index') segments.pop();
    const ext = m[2];
    // The extension says which framework's pages/ this is; a project with none of them has no such routes.
    const owner = ext === 'vue' ? uses('nuxt') : ext === 'astro' ? uses('astro') : /^(?:md|svelte)$/.test(ext) ? uses('astro') : uses('next') || (uses('astro') && /(?:^|\/)src\/pages\//.test(path));
    if (!owner) return null;
    const handler = segments[0] === 'api' || (new RegExp(`^${CODE_EXT}$`).test(ext) && uses('astro') && !uses('next') && /(?:^|\/)src\/pages\//.test(path));
    return { route: normalizeRoute(segments.map(paramSegment).join('/')), kind: handler ? 'handler' : 'page' };
  }

  return null;
}

// ---------- WordPress ----------

/** Theme directories: those whose style.css declares a Theme Name. */
function wordpressThemeRoots(files: Map<string, string>): string[] {
  const roots: string[] = [];
  for (const [path, content] of files) {
    if (/(?:^|\/)style\.css$/.test(path) && /^\s*(?:\/\*)?[\s*]*Theme Name:/m.test(content.slice(0, 2000))) roots.push(path.slice(0, -'style.css'.length));
  }
  return roots;
}

/**
 * Routes from the WordPress template hierarchy: the theme file name says which URLs it renders.
 * page-about.php serves /about, single-product.php serves /product/<slug>, front-page.php serves /.
 * page.php, single.php and index.php serve any URL nothing more specific handles (fallbacks).
 */
function wordpressTemplateRoutes(files: Map<string, string>): Omit<RouteEntry, 'pattern'>[] {
  const out: Omit<RouteEntry, 'pattern'>[] = [];
  for (const root of wordpressThemeRoots(files)) {
    for (const file of files.keys()) {
      if (!file.startsWith(root)) continue;
      const rel = file.slice(root.length);
      const m = /^(?:templates\/)?([\w-]+)\.(php|html)$/.exec(rel);
      if (!m) continue;
      const name = m[1];
      let route: string | null = null;
      let weight: number | undefined;
      if (name === 'front-page' || name === 'home') route = '/';
      else if (name === '404') route = '/404';
      else if (name === 'search') route = '/search';
      else if (name.startsWith('page-')) route = `/${name.slice(5)}`;
      else if (name.startsWith('single-')) route = `/${name.slice(7)}/:slug`;
      else if (name.startsWith('archive-')) route = `/${name.slice(8)}`;
      else if (name.startsWith('category-')) route = `/category/${name.slice(9)}`;
      else if (name.startsWith('tag-')) route = `/tag/${name.slice(4)}`;
      else if (name.startsWith('author-')) route = `/author/${name.slice(7)}`;
      else if (name === 'page') { route = '/*'; weight = 20; }
      else if (name === 'singular') { route = '/*'; weight = 18; }
      else if (name === 'single') { route = '/*'; weight = 17; }
      else if (name === 'index') { route = '/*'; weight = 15; }
      if (route) out.push({ route, file, kind: 'page', source: 'file', ...(weight ? { fallback: weight } : {}) });
    }
  }
  return out;
}

function wordpressDeclared(content: string): Declared[] {
  const out: Declared[] = [];
  for (const m of content.matchAll(/\bregister_rest_route\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3/g)) {
    out.push({ route: normalizeRoute(`/wp-json/${m[2]}/${regexRoute(m[4])}`), kind: 'handler' });
  }
  // Admin screens are addressed by ?page=<menu slug>.
  for (const m of content.matchAll(/\badd_menu_page\(\s*(?:[^,]+,\s*){3}(['"])([^'"]+)\1/g)) out.push({ route: `/wp-admin/admin.php?page=${m[2]}`, kind: 'page' });
  for (const m of content.matchAll(/\badd_submenu_page\(\s*(?:[^,]+,\s*){4}(['"])([^'"]+)\1/g)) out.push({ route: `/wp-admin/admin.php?page=${m[2]}`, kind: 'page' });
  for (const m of content.matchAll(/\badd_(?:options|management|theme|tools|users|dashboard|plugins|comments|posts|media|pages)_page\(\s*(?:[^,]+,\s*){3}(['"])([^'"]+)\1/g)) {
    out.push({ route: `/wp-admin/options-general.php?page=${m[2]}`, kind: 'page' }, { route: `/wp-admin/admin.php?page=${m[2]}`, kind: 'page' });
  }
  for (const m of content.matchAll(/\badd_rewrite_rule\(\s*(['"])([^'"]+)\1/g)) out.push({ route: normalizeRoute(regexRoute(m[2])), kind: 'page' });
  for (const m of content.matchAll(/\badd_action\(\s*(['"])wp_ajax_(?:nopriv_)?(\w+)\1/g)) out.push({ route: `/wp-admin/admin-ajax.php?action=${m[2]}`, kind: 'handler' });
  return out;
}

// ---------- Shopify ----------

/** Shopify decides which template renders a URL; this is that fixed mapping. */
const SHOPIFY_TEMPLATES: Record<string, string> = {
  index: '/', product: '/products/:handle', collection: '/collections/:handle', 'list-collections': '/collections',
  page: '/pages/:handle', blog: '/blogs/:blog', article: '/blogs/:blog/:article', cart: '/cart', search: '/search',
  '404': '/404', password: '/password', gift_card: '/gift_cards/:id',
  'customers/login': '/account/login', 'customers/register': '/account/register', 'customers/account': '/account',
  'customers/addresses': '/account/addresses', 'customers/order': '/account/orders/:id',
  'customers/reset_password': '/account/reset/:id/:token', 'customers/activate_account': '/account/activate/:id/:token',
};

function shopifyTemplateRoutes(files: Map<string, string>): Omit<RouteEntry, 'pattern'>[] {
  const out: Omit<RouteEntry, 'pattern'>[] = [];
  const roots = [...files.keys()].flatMap((p) => { const m = /^(.*?)layout\/theme\.liquid$/.exec(p); return m ? [m[1]] : []; });
  for (const root of roots) {
    for (const file of files.keys()) {
      if (!file.startsWith(`${root}templates/`)) continue;
      const m = /^templates\/((?:customers\/)?[\w-]+?)(?:\.([\w-]+))?\.(?:json|liquid)$/.exec(file.slice(root.length));
      if (!m) continue;
      const base = SHOPIFY_TEMPLATES[m[1]];
      if (!base) continue;
      if (!m[2]) { out.push({ route: base, file, kind: 'page', source: 'file' }); continue; }
      // Alternate template (page.contact.json): chosen in the admin per resource, so it also applies
      // to the URL of the same handle, and to the default URL only when nothing else does.
      if (m[1] === 'page') out.push({ route: `/pages/${m[2]}`, file, kind: 'page', source: 'file' });
      if (m[1] === 'product') out.push({ route: `/products/${m[2]}`, file, kind: 'page', source: 'file' });
      if (m[1] === 'collection') out.push({ route: `/collections/${m[2]}`, file, kind: 'page', source: 'file' });
      out.push({ route: base, file, kind: 'page', source: 'file', fallback: 12 });
    }
  }
  return out;
}

// ---------- Shared helpers for composed routes ----------

/** Index of the `}` matching the `{` at `open`, ignoring braces inside simple string literals. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

interface PrefixBlock { start: number; end: number; prefix: string }

/** The prefixes of every block that encloses `index`, outermost first, joined. */
function enclosingPrefix(blocks: PrefixBlock[], index: number): string {
  return blocks.filter((b) => index > b.start && index < b.end).sort((a, b) => a.start - b.start).map((b) => b.prefix).join('/');
}

const joinRoute = (...parts: string[]): string => normalizeRoute(parts.filter(Boolean).join('/'));

/** Regex routes (Django re_path, WordPress rewrites) into route syntax: (?P<id>\d+) and ([^/]+) become :param. */
function regexRoute(route: string): string {
  return route
    .replace(/\(\?P<(\w+)>[^)]*\)/g, ':$1')
    .replace(/\([^)]*\)/g, ':param')
    .replace(/^\^|\$$/g, '')
    .replace(/\\/g, '')
    .replace(/[?*+]+$/, '');
}

// ---------- Django ----------

interface DjangoEntry { route: string; include?: string; routerVar?: string }

function djangoEntries(content: string): { entries: DjangoEntry[]; routers: Map<string, string[]> } {
  const entries: DjangoEntry[] = [];
  for (const m of content.matchAll(/\b(re_)?path\(\s*r?(['"])([^'"]*)\2\s*,((?:(?!\b(?:re_)?path\()[^\n])*)/g)) {
    const route = m[1] ? regexRoute(m[3]) : m[3].replace(/<(?:\w+:)?(\w+)>/g, ':$1'); // <int:pk> → :pk
    const rest = m[4];
    const include = /\binclude\(\s*(?:\(\s*)?['"]([\w.]+)['"]/.exec(rest)?.[1];
    const routerVar = /\binclude\(\s*(\w+)\.urls/.exec(rest)?.[1];
    entries.push({ route, ...(include ? { include } : {}), ...(routerVar ? { routerVar } : {}) });
  }
  const routers = new Map<string, string[]>();
  for (const m of content.matchAll(/\b(\w+)\.register\(\s*r?(['"])([^'"]*)\2/g)) {
    const list = routers.get(m[1]) ?? [];
    list.push(m[3]);
    routers.set(m[1], list);
  }
  return { entries, routers };
}

/**
 * Django: full URLs from urls.py files, joining each include('app.urls') prefix to the routes of the
 * included file, and expanding DRF routers. The route belongs to the file that declares it.
 */
function djangoRoutes(files: Map<string, string>, index: RepoIndex): Omit<RouteEntry, 'pattern'>[] {
  const urlFiles = [...files].filter(([p, c]) => p.endsWith('.py') && c.includes('urlpatterns')).map(([p]) => p);
  if (!urlFiles.length) return [];
  const parsed = new Map(urlFiles.map((f) => [f, djangoEntries(files.get(f)!)]));
  const included = new Set<string>();
  const target = (from: string, module: string): string | undefined => {
    const hits = (index.suffixes.get(module.replace(/\./g, '/')) ?? []).filter((p) => parsed.has(p));
    return hits.sort((a, b) => Number(b.startsWith(from.slice(0, from.indexOf('/') + 1))) - Number(a.startsWith(from.slice(0, from.indexOf('/') + 1))))[0];
  };
  for (const [file, { entries }] of parsed) for (const e of entries) if (e.include) { const t = target(file, e.include); if (t) included.add(t); }
  const roots = urlFiles.filter((f) => !included.has(f));
  const out: Omit<RouteEntry, 'pattern'>[] = [];
  const walk = (file: string, prefix: string, depth: number) => {
    if (depth > 6 || out.length > 5000) return;
    const { entries, routers } = parsed.get(file)!;
    for (const e of entries) {
      const full = joinRoute(prefix, e.route);
      if (e.include) {
        const t = target(file, e.include);
        if (t) walk(t, full, depth + 1);
      } else if (e.routerVar && routers.has(e.routerVar)) {
        for (const registered of routers.get(e.routerVar)!) {
          out.push({ route: joinRoute(full, registered), file, kind: 'page', source: 'code' }, { route: joinRoute(full, registered, ':pk'), file, kind: 'page', source: 'code' });
        }
      } else {
        out.push({ route: full, file, kind: 'page', source: 'code' });
      }
    }
  };
  for (const root of roots.length ? roots : urlFiles) walk(root, '', 0);
  return out;
}

// ---------- Go ----------

/** gin, echo, chi, gorilla/mux and net/http (including Go 1.22 "GET /items/{id}" patterns), with groups. */
function goRoutes(content: string): Declared[] {
  const blocks: PrefixBlock[] = [];
  // chi: r.Route("/api", func(r chi.Router) { ... })
  for (const m of content.matchAll(/\.Route\(\s*"([^"]*)"\s*,\s*func\s*\([^)]*\)\s*\{/g)) {
    const open = m.index! + m[0].length - 1;
    blocks.push({ start: open, end: matchingBrace(content, open), prefix: m[1] });
  }
  // gin/echo: v1 := r.Group("/v1"), chained through other groups.
  const groups = new Map<string, { parent: string; prefix: string }>();
  for (const m of content.matchAll(/\b(\w+)\s*:?=\s*(\w+)\.Group\(\s*"([^"]*)"/g)) groups.set(m[1], { parent: m[2], prefix: m[3] });
  const groupPrefix = (name: string, depth = 0): string => {
    const g = groups.get(name);
    return g && depth < 6 ? joinRoute(groupPrefix(g.parent, depth + 1), g.prefix) : '';
  };
  const out: Declared[] = [];
  for (const m of content.matchAll(/\b(\w+)\s*\.\s*(?:GET|POST|PUT|PATCH|DELETE|Any|Get|Post|Put|Patch|Delete|Handle|HandleFunc)\(\s*"(?:[A-Z]+\s+)?(\/[^"]*)"/g)) {
    out.push({ route: joinRoute(enclosingPrefix(blocks, m.index!), groupPrefix(m[1]), m[2]), kind: 'handler' });
  }
  return out;
}

// ---------- Laravel ----------

function laravelRoutes(path: string, content: string): Declared[] {
  const blocks: PrefixBlock[] = [];
  const chainPrefix = (before: string): string => /(?:->|Route::)prefix\(\s*(['"])([^'"]*)\1/.exec(before)?.[2] ?? '';
  for (const m of content.matchAll(/->group\(\s*function\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{/g)) {
    const open = m.index! + m[0].length - 1;
    const statementStart = Math.max(content.lastIndexOf(';', m.index!), content.lastIndexOf('}', m.index!)) + 1;
    blocks.push({ start: open, end: matchingBrace(content, open), prefix: chainPrefix(content.slice(statementStart, m.index!)) });
  }
  for (const m of content.matchAll(/Route::group\(\s*\[([^\]]*)\]\s*,\s*function\s*\([^)]*\)\s*\{/g)) {
    const open = m.index! + m[0].length - 1;
    blocks.push({ start: open, end: matchingBrace(content, open), prefix: /['"]prefix['"]\s*=>\s*(['"])([^'"]*)\1/.exec(m[1])?.[2] ?? '' });
  }
  const base = /(?:^|\/)routes\/api\.php$/.test(path) ? 'api' : '';
  const out: Declared[] = [];
  const at = (index: number, route: string) => joinRoute(base, enclosingPrefix(blocks, index), route);
  for (const m of content.matchAll(/Route::(?:get|post|put|patch|delete|any|options|view|redirect)\(\s*(['"])([^'"]*)\1/g)) out.push({ route: at(m.index!, m[2]), kind: 'page' });
  for (const m of content.matchAll(/Route::match\(\s*\[[^\]]*\]\s*,\s*(['"])([^'"]*)\1/g)) out.push({ route: at(m.index!, m[2]), kind: 'page' });
  for (const m of content.matchAll(/Route::(resource|apiResource)\(\s*(['"])([^'"]+)\2/g)) {
    const name = m[3].replace(/\./g, '/:id/');
    const api = m[1] === 'apiResource';
    out.push({ route: at(m.index!, name), kind: 'page' }, { route: at(m.index!, `${name}/:id`), kind: 'page' });
    if (!api) out.push({ route: at(m.index!, `${name}/create`), kind: 'page' }, { route: at(m.index!, `${name}/:id/edit`), kind: 'page' });
  }
  return out;
}

// ---------- Routes declared in code ----------

interface Declared { route: string; kind: RouteKind }

const JS_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;

function declaredRoutes(path: string, content: string): Declared[] {
  const out: Declared[] = [];
  const add = (route: string, kind: RouteKind) => {
    const cleaned = route.replace(/^\^|\$$/g, '').trim();
    if (!cleaned || cleaned.length > 200 || /[\s()|\\]/.test(cleaned)) return;
    out.push({ route: normalizeRoute(cleaned), kind });
  };

  if (JS_FILE.test(path)) {
    // Express / Koa router / Fastify / Hono / Elysia style: app.get('/users/:id', handler).
    for (const m of content.matchAll(/\b(?:app|router|route|routes|server|fastify|api|r)\s*\.\s*(?:get|post|put|patch|delete|all|options|head)\s*\(\s*(['"`])(\/[^'"`]*)\1/g)) add(m[2], 'handler');
    // React Router JSX: <Route path="/admin/users" element={...} />.
    for (const m of content.matchAll(/<Route\b[^>]*?\bpath=(?:"([^"]+)"|'([^']+)'|\{\s*['"`]([^'"`]+)['"`]\s*\})/g)) add(m[1] ?? m[2] ?? m[3], 'page');
    // Object routes (React Router, Vue Router, Angular): { path: '/x', component | element | children | loadChildren }.
    if (/\b(?:component|element|children|loadChildren|loadComponent|lazy)\b/.test(content)) {
      for (const m of content.matchAll(/\bpath\s*:\s*(['"`])([^'"`]*)\1/g)) add(m[2], 'page');
    }
  } else if (/\.py$/.test(path)) {
    for (const m of content.matchAll(/@\w+\.route\(\s*['"]([^'"]+)['"]/g)) add(m[1], 'handler'); // Flask
    for (const m of content.matchAll(/@\w+\.(?:get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) add(m[1], 'handler'); // FastAPI, Flask 2
  } else if (/routes\.rb$/.test(path)) {
    for (const m of content.matchAll(/^\s*(?:get|post|put|patch|delete|match)\s+['"]([^'"]+)['"]/gm)) add(m[1], 'page'); // Rails
    for (const m of content.matchAll(/^\s*resources?\s+:(\w+)/gm)) add(m[1], 'page');
  } else if (/\.php$/.test(path)) {
    for (const d of wordpressDeclared(content)) out.push(d);
    for (const d of laravelRoutes(path, content)) out.push(d);
  } else if (/\.go$/.test(path)) {
    for (const d of goRoutes(content)) out.push(d);
  } else if (/\.(?:java|kt)$/.test(path)) {
    for (const m of content.matchAll(/@(?:Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:(?:value|path)\s*=\s*)?"([^"]*)"/g)) add(m[1], 'handler'); // Spring
  }
  return out;
}

/** Every route the repository declares, by file location, by platform convention, or by registration in code. */
export function collectRoutes(files: Map<string, string>, index: RepoIndex = buildRepoIndex(files)): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const add = (e: Omit<RouteEntry, 'pattern'>) => entries.push({ ...e, pattern: routePattern(e.route) });
  const frameworks = frameworkIndex(files);
  for (const [file, content] of files) {
    const located = fileRoute(file, frameworksFor(file, frameworks));
    if (located) add({ ...located, file, source: 'file' });
    if (content.length > 400_000) continue;
    const seen = new Set<string>();
    for (const declared of declaredRoutes(file, content)) {
      const key = `${declared.kind}:${declared.route}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add({ ...declared, file, source: 'code' });
    }
  }
  for (const e of djangoRoutes(files, index)) add(e);
  for (const e of wordpressTemplateRoutes(files)) add(e);
  for (const e of shopifyTemplateRoutes(files)) add(e);
  return entries;
}

/** Back-compat helper: the route a file-based route file serves. */
export function routeForFile(path: string): string | null {
  return fileRoute(path)?.route ?? null;
}

// ---------- Finding the file for a URL in the request ----------

/** URL paths mentioned in a request, with a query string kept when present (WordPress admin uses ?page=). */
function urlPathsIn(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?:^|[\s(`'"])(?:https?:\/\/)?(?:[a-z0-9-]+(?:\.[a-z0-9-]+)+)?(\/[a-z0-9_.:[\]-]+(?:\/[a-z0-9_.:[\]-]+)*)(\?[a-z0-9_=&%.-]+)?/gi)) {
    const path = m[1].toLowerCase().replace(/[.,;:]+$/, '');
    const query = m[2]?.toLowerCase() ?? '';
    if (path.split('/').length >= 3 || query) found.push(path + query);
    else if (path !== '/' && /^\/[a-z0-9_-]+$/.test(path)) found.push(path); // single segment such as /cart
  }
  return found;
}

/**
 * The file that serves a URL named in the request, e.g. "example.com/admin/users/settings". Exact
 * matches come first, then pattern matches (/users/:id), then code-declared routes written relative to a
 * parent, then platform fallbacks such as a WordPress theme's page.php. Pages beat API handlers.
 */
export function routeFileFor(files: Map<string, string>, text: string, entries: RouteEntry[] = collectRoutes(files)): { file: string; route: string } | null {
  const wanted = urlPathsIn(text);
  if (!wanted.length) return null;
  const scored: { entry: RouteEntry; score: number }[] = [];
  for (const entry of entries) {
    const route = entry.route.toLowerCase();
    for (const path of wanted) {
      const pathOnly = path.split('?')[0];
      let score = 0;
      if (entry.fallback !== undefined) score = entry.pattern.test(pathOnly) ? entry.fallback : 0;
      else if (route === path || route === pathOnly) score = 100;
      else if (route.includes(':') || route.includes('*')) score = entry.pattern.test(pathOnly) ? (route.includes('*') ? 80 : 90) : 0;
      else if (entry.source === 'code' && route !== '/' && pathOnly.endsWith(route) && route.split('/').length >= 2) score = 40 + route.length / 10;
      if (score) scored.push({ entry, score: score - (entry.kind === 'handler' ? 10 : 0) - (entry.source === 'code' ? 5 : 0) });
    }
  }
  const best = scored.sort((a, b) => b.score - a.score || a.entry.file.localeCompare(b.entry.file))[0];
  return best ? { file: best.entry.file, route: best.entry.route } : null;
}
