import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@vercel/blob', () => ({ list: vi.fn() }));
import { list } from '@vercel/blob';
import { GET } from './route';
const request = new Request('https://nucleas.app/desktop/releases/windows/latest.yml');
beforeEach(() => vi.clearAllMocks());
describe('desktop release feed', () => {
    it('serves only the exact allowlisted asset and disables redirect caching', async () => {
        vi.mocked(list).mockResolvedValue({ blobs: [{ pathname: 'desktop/releases/windows/latest.yml', url: 'https://store.public.blob.vercel-storage.com/latest.yml' }] } as never);
        const result = await GET(request, { params: Promise.resolve({ asset: 'latest.yml' }) });
        expect(result.status).toBe(307);
        expect(result.headers.get('cache-control')).toBe('no-store');
    });
    it('rejects arbitrary files and traversal without listing storage', async () => {
        for (const asset of ['../secrets', 'account.json', 'latest.yml/other', 'Nucleas-Setup-bad.exe']) {
            expect((await GET(request, { params: Promise.resolve({ asset }) })).status).toBe(404);
        }
        expect(list).not.toHaveBeenCalled();
    });
    it('does not return a different asset with the same prefix', async () => {
        vi.mocked(list).mockResolvedValue({ blobs: [{ pathname: 'desktop/releases/windows/Nucleas-Setup-0.1.0.exe.blockmap', url: 'https://example.com/map' }] } as never);
        expect((await GET(request, { params: Promise.resolve({ asset: 'Nucleas-Setup-0.1.0.exe' }) })).status).toBe(404);
    });
    it('handles unavailable storage without disclosing provider errors', async () => {
        vi.mocked(list).mockRejectedValue(new Error('private provider details'));
        const result = await GET(request, { params: Promise.resolve({ asset: 'latest.yml' }) });
        expect(result.status).toBe(503);
        expect(await result.text()).not.toContain('private provider');
    });
});
