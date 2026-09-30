/**
 * What does this file depend on? Resolves the references a file makes to other files in the same
 * repository, for the languages and platforms websites are built with: JavaScript/TypeScript (and Vue,
 * Svelte, Astro single-file components and markdown layouts), Python (with Django/Jinja templates), Go
 * (packages, modules, templates), PHP (WordPress themes and plugins, Laravel classes and Blade views) and
 * Liquid (Shopify themes). Pure string work over a repository snapshot.
 */

const RESOLVE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.vue', '.svelte', '.astro', '.mdx'];
const JS_LIKE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|mdx)$/;
const JS_SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** The `src/` folder an `@/` alias points into, from the importing file's own path (monorepo safe). */
function srcRoot(importer: string): string {
  if (importer.startsWith('src/')) return 'src/';
  const at = importer.indexOf('/src/');
  return at >= 0 ? importer.slice(0, at + 5) : 'src/';
}

// ---------- Suffix index (Python modules, PHP namespaces) ----------

export interface RepoIndex {
  files: Map<string, string>;
  /** path without extension, and every trailing run of its segments → files. `a/b/c.py` answers `a/b/c`, `b/c` and `c`. */
  suffixes: Map<string, string[]>;
  /** Directories that are the root of a Shopify theme (they contain layout/theme.liquid), longest first. */
  shopifyRoots: string[];
  /** Server-rendered template files by trailing path, extension kept: `users/list.html` → files. */
  templates: Map<string, string[]>;
  /** Go modules declared by go.mod files, longest directory first. */
  goModules: { module: string; dir: string }[];
  /** Directory → its non-test .go files (a Go package is a directory). */
  goDirs: Map<string, string[]>;
  /** Directory of each tsconfig/jsconfig → its `paths` aliases, e.g. `@/*` → `./src/*`. */
  aliases: Map<string, { prefix: string; targets: string[] }[]>;
  /** Directories that hold a package.json (project roots), longest first. */
  projectDirs: string[];
}

const INDEXED = /\.(?:py|php)$/;
const TEMPLATE_EXT = /\.(?:html?|jinja2?|j2|twig|njk|hbs|handlebars|ejs|pug|erb|tmpl|gohtml|mustache)$/i;
const TEMPLATE_SUFFIXES = ['.html', '.htm', '.jinja', '.jinja2', '.j2', '.twig', '.njk', '.hbs', '.ejs', '.pug', '.erb'];

/** Removes // and /* comments and trailing commas from JSON-with-comments, leaving string contents alone. */
function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** `compilerOptions.paths` (and baseUrl) from a tsconfig/jsconfig. Targets keep their trailing slash. */
function parseAliases(text: string): { prefix: string; targets: string[] }[] {
  try {
    const json = JSON.parse(stripJsonComments(text)) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    const options = json.compilerOptions ?? {};
    return Object.entries(options.paths ?? {}).flatMap(([pattern, targets]) => {
      if (!pattern.endsWith('/*') || !Array.isArray(targets)) return [];
      const base = options.baseUrl && options.baseUrl !== '.' ? `${options.baseUrl.replace(/\/+$/, '')}/` : '';
      return [{ prefix: pattern.slice(0, -1), targets: targets.filter((t) => t.endsWith('/*')).map((t) => `${base}${t.slice(0, -1)}`) }];
    });
  } catch {
    return [];
  }
}

export function buildRepoIndex(files: Map<string, string>): RepoIndex {
  const suffixes = new Map<string, string[]>();
  const templates = new Map<string, string[]>();
  const shopifyRoots: string[] = [];
  const goModules: { module: string; dir: string }[] = [];
  const goDirs = new Map<string, string[]>();
  const aliases = new Map<string, { prefix: string; targets: string[] }[]>();
  const projectDirs: string[] = [];
  for (const [path, content] of files) {
    if (path === 'package.json' || (path.endsWith('/package.json') && !path.includes('node_modules/'))) projectDirs.push(path.slice(0, -'package.json'.length).replace(/\/$/, ''));
    if (/(?:^|\/)(?:ts|js)config[\w.-]*\.json$/.test(path) && !path.includes('node_modules/')) {
      const found = parseAliases(content);
      if (found.length) aliases.set(dirname(path), found);
    }
    const theme = /^(.*?)layout\/theme\.liquid$/.exec(path);
    if (theme) shopifyRoots.push(theme[1]);
    if (path === 'go.mod' || path.endsWith('/go.mod')) {
      const moduleName = /^module\s+(\S+)/m.exec(content)?.[1];
      if (moduleName) goModules.push({ module: moduleName, dir: path.slice(0, -'go.mod'.length).replace(/\/$/, '') });
    }
    if (path.endsWith('.go') && !path.endsWith('_test.go')) {
      const dir = dirname(path);
      const list = goDirs.get(dir);
      if (list) list.push(path);
      else goDirs.set(dir, [path]);
    }
    if (TEMPLATE_EXT.test(path)) {
      const parts = path.split('/');
      for (let i = 0; i < parts.length && i < 8; i += 1) {
        const key = parts.slice(i).join('/');
        const list = templates.get(key);
        if (list) list.push(path);
        else templates.set(key, [path]);
      }
    }
    if (!INDEXED.test(path)) continue;
    const segments = path.replace(/\.[^.]+$/, '').replace(/\/__init__$/, '').split('/');
    for (let i = 0; i < segments.length && i < 8; i += 1) {
      const key = segments.slice(i).join('/');
      const list = suffixes.get(key);
      if (list) list.push(path);
      else suffixes.set(key, [path]);
    }
  }
  return { files, suffixes, templates, aliases, projectDirs: projectDirs.sort((a, b) => b.length - a.length), goModules: goModules.sort((a, b) => b.module.length - a.module.length), goDirs, shopifyRoots: shopifyRoots.sort((a, b) => b.length - a.length) };
}

/** Prefer the match that shares the most leading directories with the file doing the referencing. */
function closest(from: string, matches: string[] | undefined, max = 3): string[] {
  if (!matches?.length) return [];
  const shared = (p: string) => {
    const a = from.split('/');
    const b = p.split('/');
    let n = 0;
    while (n < a.length - 1 && n < b.length - 1 && a[n] === b[n]) n += 1;
    return n;
  };
  return [...matches].sort((x, y) => shared(y) - shared(x) || x.localeCompare(y)).slice(0, max);
}

// ---------- Per-language resolvers ----------

/** Template files a name could mean: `users/list` or `users/list.html`, nearest to the referencing file first. */
function templateFiles(from: string, name: string, index: RepoIndex): string[] {
  const clean = name.replace(/^\.?\/+/, '');
  if (!clean || clean.includes('://')) return [];
  const names = TEMPLATE_EXT.test(clean) ? [clean] : TEMPLATE_SUFFIXES.map((e) => clean + e);
  return names.flatMap((n) => closest(from, index.templates.get(n), 2)).slice(0, 2);
}

/** Possible locations for a non-relative import: the project's own tsconfig/jsconfig aliases, else `@/` and `~/` guesses. */
function aliasBases(path: string, spec: string, index: RepoIndex): string[] {
  const bases: string[] = [];
  let dir = dirname(path);
  for (;;) {
    for (const alias of index.aliases.get(dir) ?? []) {
      if (spec.startsWith(alias.prefix)) for (const target of alias.targets) bases.push(normalizePath(`${dir}/${target}${spec.slice(alias.prefix.length)}`));
    }
    if (bases.length || !dir) break;
    dir = dirname(dir);
  }
  if (!bases.length && (spec.startsWith('@/') || spec.startsWith('~/'))) {
    // No config to read: a src/ folder beside the file's project, else the project root itself.
    const project = index.projectDirs.find((d) => !d || path.startsWith(`${d}/`)) ?? '';
    const rest = spec.slice(2);
    bases.push(normalizePath(`${srcRoot(path)}${rest}`), normalizePath(`${project}/src/${rest}`), normalizePath(`${project}/${rest}`));
  }
  return bases;
}

function jsDependencies(path: string, content: string, index: RepoIndex): string[] {
  const files = index.files;
  const out: string[] = [];
  for (const m of content.matchAll(JS_SPEC)) {
    const spec = m[2];
    const bases = spec.startsWith('.') ? [normalizePath(`${dirname(path)}/${spec}`)] : aliasBases(path, spec, index);
    for (const base of bases) {
      const hit = [base, ...RESOLVE_EXT.map((e) => base + e), ...RESOLVE_EXT.map((e) => `${base}/index${e}`)].find((c) => files.has(c));
      if (hit) { out.push(hit); break; }
    }
  }
  return out;
}

function pythonDependencies(path: string, content: string, index: RepoIndex): string[] {
  const out: string[] = [];
  const lookup = (module: string) => {
    for (const hit of closest(path, index.suffixes.get(module))) out.push(hit);
  };
  for (const m of content.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\(?[^\n#]*)/gm)) {
    const dots = m[1].length;
    const modulePath = m[2].replace(/\./g, '/');
    const names = m[3].split(/[\s,()]+/).filter((n) => /^\w+$/.test(n) && n !== 'as');
    if (dots > 0) {
      let base = dirname(path);
      for (let i = 1; i < dots; i += 1) base = dirname(base);
      const root = normalizePath(`${base}/${modulePath}`);
      for (const candidate of [`${root}.py`, `${root}/__init__.py`, ...names.map((n) => `${root}/${n}.py`)]) if (index.files.has(candidate)) out.push(candidate);
    } else if (modulePath) {
      lookup(modulePath);
      for (const name of names) lookup(`${modulePath}/${name}`);
    }
  }
  for (const m of content.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].replace(/\./g, '/');
      if (name && /^[\w/]+$/.test(name)) lookup(name);
    }
  }
  // Templates named in render(request, 'app/page.html'), template_name = '...', render_template('x.html').
  for (const m of content.matchAll(/(['"])([\w./-]+\.(?:html?|jinja2?|j2|txt))\1/g)) out.push(...templateFiles(path, m[2], index));
  return out;
}

/** A path made of the last string literal in a PHP path expression: `__DIR__ . '/inc/x.php'` → `inc/x.php`. */
function lastStringLiteral(expression: string): string | null {
  const literals = [...expression.matchAll(/(['"])((?:(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
  return literals.length ? literals[literals.length - 1] : null;
}

/** Look for `relative` beside the file, then in each parent directory (theme and plugin roots are parents). */
function phpResolve(from: string, relative: string, files: Map<string, string>): string | null {
  const wanted = relative.replace(/^\/+/, '');
  if (!wanted || wanted.includes('://')) return null;
  let dir = dirname(from);
  for (;;) {
    const candidate = normalizePath(dir ? `${dir}/${wanted}` : wanted);
    if (files.has(candidate)) return candidate;
    if (!dir) return null;
    dir = dirname(dir);
  }
}

/** Blade view name (dots for folders) → resources/views/.../name.blade.php. */
function viewFiles(from: string, name: string, index: RepoIndex): string[] {
  if (name.includes('::')) return [];
  return closest(from, index.suffixes.get(`${name.replace(/\./g, '/')}.blade`)?.filter((p) => p.endsWith('.php')), 2);
}

function phpDependencies(path: string, content: string, index: RepoIndex): string[] {
  const out: string[] = [];
  const push = (target: string | null) => { if (target) out.push(target); };
  // include/require with a path expression, including WordPress helpers that build the base path.
  for (const m of content.matchAll(/\b(?:require|require_once|include|include_once)\b\s*\(?\s*([^;]+?)\s*\)?\s*;/g)) {
    const literal = lastStringLiteral(m[1]);
    if (literal) push(phpResolve(path, literal, index.files));
  }
  for (const m of content.matchAll(/\b(?:get_theme_file_path|get_parent_theme_file_path|locate_template)\s*\(\s*\[?\s*(['"])([^'"]+)\1/g)) push(phpResolve(path, m[2], index.files));
  // WordPress template parts: get_template_part('parts/card', 'post') → parts/card-post.php, parts/card.php.
  for (const m of content.matchAll(/\bget_template_part\s*\(\s*(['"])([^'"]+)\1(?:\s*,\s*(['"])([^'"]+)\3)?/g)) {
    if (m[4]) push(phpResolve(path, `${m[2]}-${m[4]}.php`, index.files));
    push(phpResolve(path, `${m[2]}.php`, index.files));
  }
  for (const m of content.matchAll(/\bget_(header|footer|sidebar)\s*\(\s*(?:(['"])(\w+)\2)?\s*\)/g)) {
    if (m[3]) push(phpResolve(path, `${m[1]}-${m[3]}.php`, index.files));
    push(phpResolve(path, `${m[1]}.php`, index.files));
  }
  // Blade templates: @extends('layouts.app'), @include('partials.nav'), <x-alert />.
  if (path.endsWith('.blade.php')) {
    for (const directive of content.matchAll(/@(?:extends|include\w*|each|component|slot)\(([^)]*)\)/g)) {
      for (const view of directive[1].matchAll(/(['"])([\w.\-]+)\1/g)) out.push(...viewFiles(path, view[2], index));
    }
    for (const m of content.matchAll(/<x-([\w.-]+)/g)) {
      out.push(...viewFiles(path, `components.${m[1]}`, index));
      const pascal = m[1].split(/[-.]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
      out.push(...closest(path, index.suffixes.get(`Components/${pascal}`)?.filter((p) => p.endsWith('.php'))));
    }
  }
  // Laravel: view('users.index'), View::make(...), Route::view('/x', 'welcome'), Foo::class, 'FooController@index'.
  for (const m of content.matchAll(/\b(?:view|View::make)\(\s*(['"])([\w.\-]+)\1/g)) out.push(...viewFiles(path, m[2], index));
  for (const m of content.matchAll(/Route::view\(\s*(['"])[^'"]*\1\s*,\s*(['"])([\w.\-]+)\2/g)) out.push(...viewFiles(path, m[3], index));
  for (const m of content.matchAll(/\b([A-Z]\w+)::class\b/g)) out.push(...closest(path, index.suffixes.get(m[1])?.filter((p) => p.endsWith('.php')), 2));
  for (const m of content.matchAll(/(['"])(?:[\w\\]+\\)?(\w+Controller)@\w+\1/g)) out.push(...closest(path, index.suffixes.get(m[2])?.filter((p) => p.endsWith('.php')), 2));
  // Namespaced classes: use App\Http\Controllers\UserController; → a path ending Http/Controllers/UserController.php.
  for (const m of content.matchAll(/^[ \t]*use[ \t]+([\w\\]+)(?:[ \t]+as[ \t]+\w+)?;/gm)) {
    const key = m[1].replace(/\\/g, '/');
    for (const hit of closest(path, index.suffixes.get(key)?.filter((p) => p.endsWith('.php')))) out.push(hit);
  }
  return out;
}

/** Django, Jinja, Twig: {% extends 'base.html' %}, {% include 'partials/nav.html' %}. */
function htmlTemplateDependencies(path: string, content: string, index: RepoIndex): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/\{%-?\s*(?:extends|include|import|embed|from)\s+(['"])([^'"]+)\1/g)) out.push(...templateFiles(path, m[2], index));
  return out;
}

function goDependencies(path: string, content: string, index: RepoIndex): string[] {
  const out: string[] = [];
  const specs = [...content.matchAll(/^[ \t]*import[ \t]+(?:[\w.]+[ \t]+)?"([^"]+)"/gm)].map((m) => m[1]);
  for (const block of content.matchAll(/\bimport\s*\(([^)]*)\)/g)) specs.push(...[...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  for (const spec of specs) {
    const owner = index.goModules.find((g) => spec === g.module || spec.startsWith(`${g.module}/`));
    if (!owner) continue;
    const dir = normalizePath(`${owner.dir}/${spec.slice(owner.module.length)}`);
    out.push(...(index.goDirs.get(dir) ?? []).slice(0, 8));
  }
  // The rest of this file's package: handlers are often defined beside the router that registers them.
  out.push(...(index.goDirs.get(dirname(path)) ?? []).slice(0, 10));
  for (const m of content.matchAll(/"([\w./-]+\.(?:html?|tmpl|gohtml))"/g)) out.push(...templateFiles(path, m[1], index));
  return out;
}

function shopifyRootOf(path: string, index: RepoIndex): string | null {
  return index.shopifyRoots.find((root) => path.startsWith(root)) ?? null;
}

function liquidDependencies(path: string, content: string, index: RepoIndex): string[] {
  const root = shopifyRootOf(path, index);
  if (root === null) return [];
  const out: string[] = [];
  const has = (p: string) => index.files.has(p);
  const add = (p: string) => { if (has(p)) out.push(p); };
  for (const m of content.matchAll(/\{%-?\s*(?:render|include)\s+(['"])([^'"]+)\1/g)) add(`${root}snippets/${m[2]}.liquid`);
  for (const m of content.matchAll(/\{%-?\s*section\s+(['"])([^'"]+)\1/g)) add(`${root}sections/${m[2]}.liquid`);
  for (const m of content.matchAll(/\{%-?\s*sections\s+(['"])([^'"]+)\1/g)) add(`${root}sections/${m[2]}.json`);
  for (const m of content.matchAll(/\{%-?\s*layout\s+(['"])([^'"]+)\1/g)) add(`${root}layout/${m[2]}.liquid`);
  for (const m of content.matchAll(/(['"])([^'"]+\.(?:css|js|liquid|svg|png|jpe?g|webp|gif))\1\s*\|\s*(?:asset_url|asset_img_url|stylesheet_tag|script_tag)/g)) add(`${root}assets/${m[2]}`);
  // JSON templates and section groups name their sections by type.
  if (path.endsWith('.json') && /(?:^|\/)(?:templates|sections)\//.test(path)) {
    for (const m of content.matchAll(/"type"\s*:\s*"([\w-]+)"/g)) add(`${root}sections/${m[1]}.liquid`);
  }
  // Every template is rendered inside the theme layout.
  if (path.startsWith(`${root}templates/`) && !/\{%-?\s*layout\s+none/.test(content)) add(`${root}layout/theme.liquid`);
  return out;
}

/** Files a file refers to, in any supported language. Missing targets are dropped. */
export function dependenciesOf(path: string, content: string, index: RepoIndex): string[] {
  let found: string[] = [];
  if (JS_LIKE.test(path)) found = jsDependencies(path, content, index);
  else if (path.endsWith('.py')) found = pythonDependencies(path, content, index);
  else if (path.endsWith('.php')) found = phpDependencies(path, content, index);
  else if (path.endsWith('.go')) found = goDependencies(path, content, index);
  else if (path.endsWith('.liquid') || path.endsWith('.json')) found = liquidDependencies(path, content, index);
  else if (TEMPLATE_EXT.test(path)) found = htmlTemplateDependencies(path, content, index);
  if (/\.mdx?$/.test(path)) {
    // Astro/Next MDX: layout named in the frontmatter.
    const layout = /^---[\s\S]*?\blayout:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(content.slice(0, 2000))?.[1];
    if (layout?.startsWith('.')) found.push(normalizePath(`${dirname(path)}/${layout}`));
  }
  // Server-side rendering calls in JS: res.render('users/list'), reply.view('x').
  if (JS_LIKE.test(path)) for (const m of content.matchAll(/\.(?:render|view)\(\s*(['"])([\w./-]+)\1/g)) found.push(...templateFiles(path, m[2], index));
  return [...new Set(found)].filter((p) => p !== path && index.files.has(p));
}
