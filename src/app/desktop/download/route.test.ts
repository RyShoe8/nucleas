import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/blob', () => ({ list: vi.fn() }));
import { list } from '@vercel/blob';
import { GET } from './route';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('native desktop download', () => {
    it('uses the published version rather than a hardcoded installer', async () => {
        vi.mocked(list).mockResolvedValue({ blobs: [{ pathname: 'desktop/releases/windows/latest.yml', url: 'https://store.public.blob.vercel-storage.com/latest.yml' }] } as never);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('version: 0.1.23\npath: Nucleas-Setup-0.1.23.exe\n')));
        const response = await GET(new Request('https://nucleas.app/desktop/download'));
        expect(response.headers.get('location')).toBe('https://nucleas.app/desktop/releases/windows/Nucleas-Setup-0.1.23.exe');
        expect(response.headers.get('cache-control')).toBe('no-store');
    });
    it('rejects an unexpected manifest target', async () => {
        vi.mocked(list).mockResolvedValue({ blobs: [{ pathname: 'desktop/releases/windows/latest.yml', url: 'https://store.public.blob.vercel-storage.com/latest.yml' }] } as never);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('path: https://other.example/app.exe')));
        expect((await GET(new Request('https://nucleas.app/desktop/download'))).status).toBe(503);
    });
});
