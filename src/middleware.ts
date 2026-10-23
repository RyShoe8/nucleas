import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';

function osRewriteResponse(url: URL, request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nucleas-shell', 'os');
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const { pathname } = url;
  const host = request.headers.get('host') || '';
  const isOsHost = host.startsWith('os.');
  // The main domain is now the OS entry point. Keep API/auth callbacks on their
  // original origin, but send old OS bookmarks to the canonical application.
  if (isOsHost && (pathname === '/' || pathname === '/os' || pathname === '/os/')) {
    url.host = host.replace(/^os\./, '');
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  if (!isOsHost && pathname === '/') {
    if (!request.cookies.get('session')) return NextResponse.redirect(new URL('/login', request.url));
    url.pathname = '/os';
    return osRewriteResponse(url, request);
  }
  if (!isOsHost && (pathname === '/os' || pathname === '/os/')) {
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  const isPropertyWorkerCallback = pathname.startsWith('/api/internal/property-overviews/');

  // Global API Rate Limiting (Edge Memory)
  if (pathname.startsWith('/api/') && !isPropertyWorkerCallback) {
    const rateLimitResponse = enforceRateLimit({
      key: rateLimitKey(request, 'global-api'),
      limit: 150, // 150 requests
      windowMs: 60 * 1000, // per minute
    });
    if (rateLimitResponse) return rateLimitResponse;
  }

  // Block common WordPress and other CMS probe paths to reduce log noise
  const blockedPaths = [
    '/wp-admin',
    '/wp-login.php',
    '/wp-content',
    '/wp-includes',
    '/administrator',
    '/phpmyadmin',
    '/.env',
    '/.git',
  ];

  if (blockedPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Allow access to sitemap and robots files (must be first)
  if (pathname === '/sitemap.xml' || pathname === '/robots.txt') {
    return NextResponse.next();
  }
  if (pathname === '/nucleas-os.webmanifest' || pathname === '/os-sw.js' || pathname.startsWith('/icons/') || pathname.startsWith('/fonts/')) return NextResponse.next();
  if (['/login', '/register', '/verify-email', '/pending-approval', '/setup-organization'].includes(pathname)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nucleas-shell', 'minimal');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const sharedPrefixes = ['/api', '/_next', '/login', '/register', '/images', '/uploads', '/icons'];
  const isOsSharedRoute =
    isOsHost &&
    (pathname === '/favicon.ico' ||
      pathname === '/nucleas-os.webmanifest' ||
      pathname === '/os-sw.js' ||
      sharedPrefixes.some((p) => pathname.startsWith(p)));

  // PWA assets on os.* must be public (Chrome installability probe has no session)
  if (isOsSharedRoute) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nucleas-shell', 'os');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Allow access to auth pages, setup page, admin page, public pages, and API routes
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/invitations/') ||
    pathname.startsWith('/api/portal/') ||
    pathname.startsWith('/api/contact') ||
    pathname.startsWith('/api/sales-calls') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/verify-email') ||
    pathname.startsWith('/pending-approval') ||
    pathname === '/setup-organization' ||
    pathname === '/about' ||
    pathname === '/contact' ||
    pathname === '/pricing' ||
    pathname === '/book-call' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname.startsWith('/features/') ||
    pathname === '/features' ||
    pathname.startsWith('/blog') ||
    pathname.startsWith('/tools') ||
    pathname.startsWith('/portal/')
  ) {
    if (isOsHost) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-nucleas-shell', 'os');
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    return NextResponse.next();
  }

  // Cron routes authenticate via CRON_SECRET in the route handler, not session cookies
  if (pathname.startsWith('/api/cron/')) {
    return NextResponse.next();
  }

  // The VPS worker authenticates these long-running crawl callbacks with its dedicated bearer token.
  if (isPropertyWorkerCallback) {
    return NextResponse.next();
  }

  // Stripe webhooks authenticate via signature verification in the route handler
  if (pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get('session');

  // If no session and trying to access protected route, redirect to login
  if (!session && !pathname.startsWith('/api/auth') && !pathname.startsWith('/api/invitations/') && !pathname.startsWith('/api/portal/')) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // IDE: keep Navigation, drop marketing Footer (single viewport, no double scroll).
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/os/') && !pathname.startsWith('/icons/') && !pathname.startsWith('/fonts/') && !pathname.startsWith('/images/') && !pathname.startsWith('/uploads/') && !/\.[a-z0-9]+$/i.test(pathname) && !pathname.startsWith('/recording/') && !pathname.startsWith('/recordings/') && !(pathname.startsWith('/scheduling/meeting/') && url.searchParams.get('popout') === '1')) {
    url.pathname = '/';
    if (pathname.startsWith('/admin/ai')) url.searchParams.set('open', 'ai-budgets');
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith('/os/')) return osRewriteResponse(url, request);
  if (pathname === '/ide' || pathname.startsWith('/ide/')) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nucleas-shell', 'ide');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Recording controls popout: minimal chrome-free shell (authenticated)
  if (pathname.startsWith('/recording/controls')) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nucleas-shell', 'minimal');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Meeting popout: minimal chrome-free shell (authenticated)
  if (
    pathname.startsWith('/scheduling/meeting/') &&
    url.searchParams.get('popout') === '1'
  ) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nucleas-shell', 'minimal');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (isOsHost) {
    // Keep the legacy AI settings link inside OS rather than crossing domains and losing its session.
    if (pathname === '/admin/ai' || pathname === '/admin/ai/') {
      url.pathname = '/';
      url.search = '?open=ai-budgets';
      return NextResponse.redirect(url);
    }
    // OS shell home
    if (pathname === '/') {
      url.pathname = '/os';
      return osRewriteResponse(url, request);
    }

    // Explicit /os/* routes (Phase 1: /os only)
    if (pathname.startsWith('/os')) {
      return osRewriteResponse(url, request);
    }

    // Classic app paths on os.* → main domain (e.g. os.nucleas.app/planning-map → nucleas.app/planning-map)
    const classicHost = host.replace(/^os\./, '');
    const classicUrl = new URL(`${pathname}${url.search}`, `${url.protocol}//${classicHost}`);
    return NextResponse.redirect(classicUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - uploads (uploaded user files)
     * - images (static images)
     * - sitemap.xml (sitemap file)
     * - robots.txt (robots file)
     */
    '/((?!_next/static|_next/image|favicon.ico|uploads|images|sitemap.xml|robots.txt).*)',
  ],
};
