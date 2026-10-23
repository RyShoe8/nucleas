import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/security/rateLimit', () => ({ enforceRateLimit: () => null, rateLimitKey: () => 'test' }));
import { middleware } from './middleware';
const request = (path: string, signedIn = true, host = 'nucleas.app') => new NextRequest(`https://${host}${path}`, { headers: { host, ...(signedIn ? { cookie: 'session=test' } : {}) } });
describe('OS main-domain routing', () => {
  it('opens the OS shell at the main root and requires sign-in', () => {
    const response = middleware(request('/?open=ai-budgets'));
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://nucleas.app/os?open=ai-budgets');
    expect(response.headers.get('x-middleware-request-x-nucleas-shell')).toBe('os');
    expect(middleware(request('/', false)).headers.get('location')).toBe('https://nucleas.app/login');
  });
  it('redirects old app pages and OS bookmarks while preserving public APIs and popouts', () => {
    expect(middleware(request('/planning-map')).headers.get('location')).toBe('https://nucleas.app/');
    expect(middleware(request('/?open=jobs', true, 'os.nucleas.app')).headers.get('location')).toBe('https://nucleas.app/?open=jobs');
    expect(middleware(request('/api/jobs')).headers.get('location')).toBeNull();
    expect(middleware(request('/os/popout')).headers.get('x-middleware-rewrite')).toBe('https://nucleas.app/os/popout');
    expect(middleware(request('/nucleas-os.webmanifest', false)).status).toBe(200);
  });
});
