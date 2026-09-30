import { describe, expect, it } from 'vitest';
import { collectRoutes, fileRoute, routeForFile } from './routes';
import { reachableFrom, routeFileFor } from './references';

const project = (entries: Record<string, string>) => new Map(Object.entries(entries));
const routesOf = (files: Map<string, string>) => collectRoutes(files).map((r) => `${r.kind === 'handler' ? 'H ' : ''}${r.route} <- ${r.file}`).sort();

describe('file-based frameworks (gated by package.json)', () => {
  it('SvelteKit: groups vanish, [id] becomes :id, +server.ts is a handler', () => {
    const files = project({
      'package.json': '{"devDependencies":{"@sveltejs/kit":"2"}}',
      'src/routes/admin/(app)/users/[id]/+page.svelte': '<script>import Card from "$lib/Card.svelte"</script>',
      'src/routes/api/ping/+server.ts': 'export const GET = () => new Response("ok")',
    });
    expect(routesOf(files)).toEqual(['/admin/users/:id <- src/routes/admin/(app)/users/[id]/+page.svelte', 'H /api/ping <- src/routes/api/ping/+server.ts']);
  });

  it('Nuxt: pages/*.vue are pages and server/api files are handlers with method suffixes removed', () => {
    const files = project({
      'package.json': '{"dependencies":{"nuxt":"3"}}',
      'pages/admin/users.vue': '<template><div/></template>',
      'pages/index.vue': '<template/>',
      'server/api/users/[id].get.ts': 'export default defineEventHandler(() => ({}))',
    });
    expect(routesOf(files)).toEqual(['/ <- pages/index.vue', '/admin/users <- pages/admin/users.vue', 'H /api/users/:id <- server/api/users/[id].get.ts']);
  });

  it('Remix / React Router framework mode: dots are slashes, $id is a param, _index is the parent', () => {
    const files = project({
      'package.json': '{"dependencies":{"@remix-run/react":"2"}}',
      'app/routes/admin.users.$id.tsx': 'export default function P() {}',
      'app/routes/_index.tsx': 'export default function P() {}',
      'app/routes/admin/route.tsx': 'export default function P() {}',
      'app/routes/_auth.login.tsx': 'export default function P() {}',
    });
    expect(routesOf(files)).toEqual(['/ <- app/routes/_index.tsx', '/admin <- app/routes/admin/route.tsx', '/admin/users/:id <- app/routes/admin.users.$id.tsx', '/login <- app/routes/_auth.login.tsx']);
  });

  it('Astro: .astro and .md pages, dynamic segments, ts endpoints are handlers', () => {
    const files = project({
      'package.json': '{"dependencies":{"astro":"4"}}',
      'src/pages/index.astro': '---\nimport Layout from "../layouts/Layout.astro";\n---\n<Layout/>',
      'src/pages/blog/[slug].astro': '---\nimport Post from "../../layouts/Post.astro";\nimport Header from "../../components/Header.astro";\n---\n',
      'src/pages/blog/[...rest].astro': '',
      'src/pages/api/hello.ts': 'export const GET = () => new Response("hi")',
      'src/pages/about.md': '---\nlayout: ../layouts/Base.astro\n---\n# About',
      'src/pages/_draft.astro': '',
      'src/layouts/Layout.astro': '', 'src/layouts/Post.astro': '', 'src/layouts/Base.astro': '', 'src/components/Header.astro': '',
    });
    expect(routesOf(files)).toEqual([
      '/ <- src/pages/index.astro', '/about <- src/pages/about.md', '/blog/* <- src/pages/blog/[...rest].astro',
      '/blog/:slug <- src/pages/blog/[slug].astro', 'H /api/hello <- src/pages/api/hello.ts',
    ]);
    expect(reachableFrom(files, 'src/pages/blog/[slug].astro').sort()).toEqual(['src/components/Header.astro', 'src/layouts/Post.astro']);
    expect(reachableFrom(files, 'src/pages/about.md')).toEqual(['src/layouts/Base.astro']);
    expect(routeFileFor(files, 'the post page at /blog/hello-world is broken')?.file).toBe('src/pages/blog/[slug].astro');
  });

  it('a project with no file-routing framework does not treat pages/ or app/routes/ as routes', () => {
    const files = project({
      'package.json': '{"dependencies":{"react":"18","react-router-dom":"6"},"devDependencies":{"vite":"5"}}',
      'src/pages/Users.tsx': 'export default function Users() {}',
      'src/app/routes/legacy.tsx': '',
    });
    expect(routesOf(files)).toEqual([]);
    expect(routeForFile('src/pages/Users.tsx')).toBe('/Users'); // with no project info every convention is still tried
  });

  it('Next.js supports both routers', () => {
    const files = project({
      'package.json': '{"dependencies":{"next":"14"}}',
      'app/(shop)/cart/page.tsx': '', 'app/api/items/[id]/route.ts': '', 'pages/legacy/index.tsx': '', 'pages/api/old.ts': '', 'pages/_app.tsx': '',
    });
    expect(routesOf(files)).toEqual(['/cart <- app/(shop)/cart/page.tsx', '/legacy <- pages/legacy/index.tsx', 'H /api/items/:id <- app/api/items/[id]/route.ts', 'H /api/old <- pages/api/old.ts']);
    expect(fileRoute('pages/_app.tsx')).toBeNull();
  });
});

describe('React (Vite or Create React App) with React Router and an Express API', () => {
  const files = project({
    'package.json': '{"dependencies":{"react":"18","react-router-dom":"6"}}',
    'src/main.tsx': "import App from './App';",
    'src/App.tsx': "import Users from './pages/Users';\nexport default () => <Routes><Route path=\"/admin/users\" element={<Users/>} /></Routes>;",
    'src/pages/Users.tsx': "import UserTable from './UserTable';\nexport default function Users() { fetch('/api/users'); return null }",
    'src/pages/UserTable.tsx': 'export default function UserTable() {}',
    'server/index.js': "const { listUsers } = require('./users');\napp.get('/api/users', listUsers);",
    'server/users.js': 'exports.listUsers = () => {}',
    'server/unrelated.js': 'exports.x = 1',
  });

  it('finds the file that declares the route, and follows imports and the API call into the server', () => {
    expect(routeFileFor(files, 'On example.com/admin/users the table repeats a row')?.file).toBe('src/App.tsx');
    expect(reachableFrom(files, 'src/App.tsx').sort()).toEqual(['server/index.js', 'server/users.js', 'src/pages/UserTable.tsx', 'src/pages/Users.tsx']);
  });

  it('reads object routes and nested children (Vue Router style) too', () => {
    const vue = project({
      'package.json': '{"dependencies":{"vue":"3","vue-router":"4"}}',
      'src/router.ts': "import Settings from './views/Settings.vue';\nexport default [{ path: '/account', children: [{ path: 'settings', component: Settings }] }];",
      'src/views/Settings.vue': '<template/>',
    });
    expect(routeFileFor(vue, 'the page at /account/settings looks wrong')?.file).toBe('src/router.ts');
  });
});

describe('Express, Flask and FastAPI declare routes in code', () => {
  it('reads registration calls including params', () => {
    const files = project({
      'package.json': '{"dependencies":{"express":"4"}}',
      'server.js': "app.get('/users/:id', h);\nrouter.post('/orders', h);",
      'app.py': "@app.route('/admin/users')\ndef a(): pass\n@app.get('/items/{item_id}')\ndef b(): pass",
    });
    expect(routesOf(files)).toEqual(['H /admin/users <- app.py', 'H /items/{item_id} <- app.py', 'H /orders <- server.js', 'H /users/:id <- server.js']);
    expect(routeFileFor(files, 'GET /users/42 returns the wrong user')?.file).toBe('server.js');
    expect(routeFileFor(files, 'the endpoint /users/42 is wrong')?.file).toBe('server.js');
  });
});

describe('WordPress', () => {
  const files = project({
    'wp-content/themes/acme/style.css': '/*\nTheme Name: Acme\n*/',
    'wp-content/themes/acme/page-about.php': "<?php get_header(); get_template_part('template-parts/content', 'page'); get_footer();",
    'wp-content/themes/acme/page.php': '<?php get_header(); the_content(); get_footer();',
    'wp-content/themes/acme/single-product.php': '<?php get_header();',
    'wp-content/themes/acme/header.php': '<?php // header',
    'wp-content/themes/acme/footer.php': '<?php // footer',
    'wp-content/themes/acme/template-parts/content-page.php': '<?php // page content',
    'wp-content/themes/acme/functions.php': "<?php\nrequire_once get_template_directory() . '/inc/helpers.php';\nregister_rest_route('acme/v1', '/items/(?P<id>\\d+)', []);\nadd_menu_page('Acme', 'Acme', 'manage_options', 'acme-settings', 'render');\nadd_action('wp_ajax_save_thing', 'save');",
    'wp-content/themes/acme/inc/helpers.php': '<?php // helpers',
    'wp-content/themes/acme/assets/app.js': "jQuery.post(ajaxurl, { action: 'save_thing' }); fetch('/wp-json/acme/v1/items/42');",
  });

  it('maps template hierarchy names, REST routes, admin menu pages and AJAX actions', () => {
    expect(routesOf(files)).toEqual([
      '/* <- wp-content/themes/acme/page.php',
      '/about <- wp-content/themes/acme/page-about.php',
      '/product/:slug <- wp-content/themes/acme/single-product.php',
      '/wp-admin/admin.php?page=acme-settings <- wp-content/themes/acme/functions.php',
      'H /wp-admin/admin-ajax.php?action=save_thing <- wp-content/themes/acme/functions.php',
      'H /wp-json/acme/v1/items/:id <- wp-content/themes/acme/functions.php',
    ]);
  });

  it('finds the template for a URL, falls back to page.php, and understands admin URLs', () => {
    expect(routeFileFor(files, 'the /about page is wrong')?.file).toBe('wp-content/themes/acme/page-about.php');
    expect(routeFileFor(files, 'https://example.com/contact/us shows a broken form')?.file).toBe('wp-content/themes/acme/page.php');
    expect(routeFileFor(files, 'settings at /wp-admin/admin.php?page=acme-settings crash')?.file).toBe('wp-content/themes/acme/functions.php');
  });

  it('follows template parts, header/footer, includes, and script calls to REST and AJAX handlers', () => {
    expect(reachableFrom(files, 'wp-content/themes/acme/page-about.php').sort()).toEqual([
      'wp-content/themes/acme/footer.php', 'wp-content/themes/acme/header.php', 'wp-content/themes/acme/template-parts/content-page.php',
    ]);
    expect(reachableFrom(files, 'wp-content/themes/acme/functions.php')).toEqual(['wp-content/themes/acme/inc/helpers.php']);
    // A script reaches the handlers it calls, and through them whatever those files include.
    expect(reachableFrom(files, 'wp-content/themes/acme/assets/app.js').sort()).toEqual(['wp-content/themes/acme/functions.php', 'wp-content/themes/acme/inc/helpers.php']);
  });
});

describe('Shopify', () => {
  const files = project({
    'layout/theme.liquid': "{{ 'theme.css' | asset_url | stylesheet_tag }}\n{% sections 'header-group' %}\n{{ content_for_layout }}",
    'templates/product.json': '{"sections":{"main":{"type":"main-product"}},"order":["main"]}',
    'templates/page.contact.json': '{"sections":{"main":{"type":"contact-form"}}}',
    'templates/index.json': '{"sections":{}}',
    'templates/customers/login.liquid': '<h1>Login</h1>',
    'sections/main-product.liquid': "{% render 'price', product: product %}\n{% schema %}{\"name\":\"Product\"}{% endschema %}",
    'sections/contact-form.liquid': '',
    'sections/header-group.json': '{"sections":{"header":{"type":"header"}}}',
    'sections/header.liquid': "{% render 'icon-cart' %}",
    'snippets/price.liquid': '{{ product.price }}',
    'snippets/icon-cart.liquid': '<svg/>',
    'assets/theme.css': 'body{}',
  });

  it('maps Shopify\'s fixed URL → template table, including alternates', () => {
    expect(routesOf(files)).toEqual([
      '/ <- templates/index.json', '/account/login <- templates/customers/login.liquid', '/pages/:handle <- templates/page.contact.json',
      '/pages/contact <- templates/page.contact.json', '/products/:handle <- templates/product.json',
    ]);
    expect(routeFileFor(files, 'the product page /products/blue-shirt price is wrong')?.file).toBe('templates/product.json');
    expect(routeFileFor(files, 'example.com/pages/contact form fails')?.file).toBe('templates/page.contact.json');
  });

  it('follows the layout, section types in JSON, snippets, section groups and assets', () => {
    expect(reachableFrom(files, 'templates/product.json').sort()).toEqual([
      'assets/theme.css', 'layout/theme.liquid', 'sections/header-group.json', 'sections/header.liquid', 'sections/main-product.liquid', 'snippets/icon-cart.liquid', 'snippets/price.liquid',
    ]);
  });
});

describe('Django', () => {
  const files = project({
    'config/urls.py': "from django.urls import path, include\nurlpatterns = [path('admin/users/', include('users.urls')), path('', include('pages.urls'))]",
    'users/urls.py': "from django.urls import path\nfrom . import views\nurlpatterns = [path('settings/', views.settings, name='s'), path('<int:pk>/', views.detail)]",
    'pages/urls.py': "from django.urls import path\nfrom . import views\nurlpatterns = [path('about/', views.about)]",
    'users/views.py': "from django.shortcuts import render\nfrom .models import User\ndef settings(request):\n    return render(request, 'users/settings.html')\ndef detail(request, pk): pass",
    'pages/views.py': 'def about(request): pass',
    'users/models.py': 'class User: pass',
    'users/templates/users/settings.html': "{% extends 'base.html' %}\n{% include 'partials/nav.html' %}",
    'templates/base.html': '<html/>',
    'templates/partials/nav.html': '<nav/>',
  });

  it('joins include() prefixes across urls.py files', () => {
    expect(routesOf(files)).toEqual(['/about <- pages/urls.py', '/admin/users/:pk <- users/urls.py', '/admin/users/settings <- users/urls.py']);
    expect(routeFileFor(files, 'the page at example.com/admin/users/settings/ is slow')?.file).toBe('users/urls.py');
  });

  it('follows the urls module to views, models and the template inheritance chain', () => {
    expect(reachableFrom(files, 'users/urls.py').sort()).toEqual([
      'templates/base.html', 'templates/partials/nav.html', 'users/models.py', 'users/templates/users/settings.html', 'users/views.py',
    ]);
  });

  it('expands DRF routers and reads re_path regexes', () => {
    const drf = project({
      'api/urls.py': "router = DefaultRouter()\nrouter.register(r'orders', OrderViewSet)\nurlpatterns = [path('api/', include(router.urls)), re_path(r'^legacy/(?P<id>\\d+)/$', v)]",
    });
    expect(routesOf(drf)).toEqual(['/api/orders <- api/urls.py', '/api/orders/:pk <- api/urls.py', '/legacy/:id <- api/urls.py']);
  });
});

describe('Go', () => {
  const files = project({
    'go.mod': 'module example.com/shop\n\ngo 1.22\n',
    'cmd/server/main.go': [
      'package main',
      'import (',
      '  "net/http"',
      '  "example.com/shop/internal/handlers"',
      '  "github.com/go-chi/chi/v5"',
      ')',
      'func main() {',
      '  r := gin.Default()',
      '  api := r.Group("/api")',
      '  v1 := api.Group("/v1")',
      '  v1.GET("/items/:id", handlers.GetItem)',
      '  c := chi.NewRouter()',
      '  c.Route("/admin", func(r chi.Router) {',
      '    r.Get("/users", handlers.Users)',
      '    r.Route("/reports", func(r chi.Router) { r.Get("/daily", handlers.Daily) })',
      '  })',
      '  mux := http.NewServeMux()',
      '  mux.HandleFunc("GET /health/{id}", handlers.Health)',
      '}',
    ].join('\n'),
    'cmd/server/render.go': 'package main\nfunc render() { template.ParseFiles("templates/item.html") }',
    'internal/handlers/items.go': 'package handlers\nimport "example.com/shop/internal/store"\nfunc GetItem() { store.Find() }',
    'internal/handlers/users.go': 'package handlers',
    'internal/store/store.go': 'package store',
    'internal/other/other.go': 'package other',
    'templates/item.html': '<p/>',
  });

  it('composes gin groups, chi Route blocks, and Go 1.22 method patterns', () => {
    expect(routesOf(files)).toEqual([
      'H /admin/reports/daily <- cmd/server/main.go', 'H /admin/users <- cmd/server/main.go',
      'H /api/v1/items/:id <- cmd/server/main.go', 'H /health/{id} <- cmd/server/main.go',
    ]);
    expect(routeFileFor(files, 'GET /api/v1/items/42 returns 500')?.file).toBe('cmd/server/main.go');
  });

  it('follows module-local package imports, same-package files and template files', () => {
    expect(reachableFrom(files, 'cmd/server/main.go').sort()).toEqual([
      'cmd/server/render.go', 'internal/handlers/items.go', 'internal/handlers/users.go', 'internal/store/store.go', 'templates/item.html',
    ]);
  });
});

describe('Laravel', () => {
  const files = project({
    'routes/web.php': [
      '<?php',
      'use App\\Http\\Controllers\\UserController;',
      "Route::prefix('admin')->middleware('auth')->group(function () {",
      "    Route::get('/users', [UserController::class, 'index']);",
      "    Route::resource('photos', PhotoController::class);",
      '});',
      "Route::view('/welcome', 'welcome');",
    ].join('\n'),
    'routes/api.php': "<?php\nRoute::get('/ping', fn () => 'pong');\nRoute::group(['prefix' => 'v2'], function () { Route::get('/status', fn () => 'ok'); });",
    'app/Http/Controllers/UserController.php': "<?php\nnamespace App\\Http\\Controllers;\nclass UserController { function index() { return view('users.index'); } }",
    'app/Http/Controllers/PhotoController.php': '<?php class PhotoController {}',
    'resources/views/users/index.blade.php': "@extends('layouts.app')\n<x-alert type=\"error\"/>\n@include('partials.nav')",
    'resources/views/layouts/app.blade.php': '<html>@yield("content")</html>',
    'resources/views/components/alert.blade.php': '<div/>',
    'resources/views/partials/nav.blade.php': '<nav/>',
    'resources/views/welcome.blade.php': '<h1>Welcome</h1>',
  });

  it('applies prefix groups, resource routes, the automatic api prefix and Route::view', () => {
    expect(routesOf(files)).toEqual([
      '/admin/photos <- routes/web.php', '/admin/photos/:id <- routes/web.php', '/admin/photos/:id/edit <- routes/web.php', '/admin/photos/create <- routes/web.php',
      '/admin/users <- routes/web.php', '/api/ping <- routes/api.php', '/api/v2/status <- routes/api.php', '/welcome <- routes/web.php',
    ]);
    expect(routeFileFor(files, 'example.com/admin/users lists a user twice')?.file).toBe('routes/web.php');
  });

  it('follows controllers, Blade layouts, includes, components and Route::view targets', () => {
    expect(reachableFrom(files, 'routes/web.php').sort()).toEqual([
      'app/Http/Controllers/PhotoController.php', 'app/Http/Controllers/UserController.php', 'resources/views/components/alert.blade.php',
      'resources/views/layouts/app.blade.php', 'resources/views/partials/nav.blade.php', 'resources/views/users/index.blade.php', 'resources/views/welcome.blade.php',
    ]);
  });
});

describe('import aliases', () => {
  const layout = (tsconfig: string | null, root = '') => project({
    [`${root}package.json`]: '{"dependencies":{"react":"18"}}',
    ...(tsconfig ? { [`${root}tsconfig.json`]: tsconfig } : {}),
    [`${root}src/App.tsx`]: "import Button from '@/ui/Button';\nimport { api } from '@lib/api';\nimport local from '~/helpers/local';",
    [`${root}src/ui/Button.tsx`]: '', [`${root}src/lib/api.ts`]: '', [`${root}src/helpers/local.ts`]: '',
    [`${root}ui/Button.tsx`]: 'root-level twin',
  });

  it('reads paths from tsconfig, including comments, trailing commas and custom prefixes', () => {
    const files = layout(`{
      // compiler settings
      "compilerOptions": { "paths": { "@/*": ["./src/*"], "@lib/*": ["./src/lib/*"], "~/*": ["./src/*"], }, }
    }`);
    expect(reachableFrom(files, 'src/App.tsx').sort()).toEqual(['src/helpers/local.ts', 'src/lib/api.ts', 'src/ui/Button.tsx']);
  });

  it('honours baseUrl and a project that lives in a subfolder', () => {
    const files = layout('{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["./*"]}}}', 'web/');
    expect(reachableFrom(files, 'web/src/App.tsx')).toContain('web/src/ui/Button.tsx');
  });

  it('without a config, guesses the project\'s src folder, then its root (create-next-app has no src)', () => {
    expect(reachableFrom(layout(null), 'src/App.tsx')).toContain('src/ui/Button.tsx');
    const rootLevel = project({
      'package.json': '{"dependencies":{"next":"14"}}',
      'app/page.tsx': "import Card from '@/components/Card';",
      'components/Card.tsx': '',
    });
    expect(reachableFrom(rootLevel, 'app/page.tsx')).toEqual(['components/Card.tsx']);
  });
});
