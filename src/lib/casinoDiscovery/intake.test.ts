import { beforeEach, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { casinoIntake } from './intake';
const mocks = vi.hoisted(() => ({ observe: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/companies/adminAccount', () => ({ adminSessionFor: async () => ({ baseUrl: 'https://example.com', cookies: [{ name: 'session', value: 'private', domain: 'example.com', path: '/' }] }) }));
vi.mock('@/lib/ai/tools/browserClient', () => ({ browserObserve: mocks.observe }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', mocks.fetch); });
const scope = () => [new Types.ObjectId(), new Types.ObjectId()] as const;
const inventory = { casinos: [{ name: 'Existing', slug: 'existing', status: 'inactive', website_url: 'https://existing.example' }], csrf_token: 'private-csrf', imports: [] };

it('reads directly when the structured endpoint works', async () => {
  mocks.fetch.mockResolvedValue(Response.json(inventory));
  expect(await (await casinoIntake(...scope())).inventory()).toEqual(inventory);
  expect(mocks.observe).not.toHaveBeenCalled();
});
it('uses the authenticated read-only browser when direct cloud access is forbidden', async () => {
  mocks.fetch.mockResolvedValue(new Response('Blocked', { status: 403 }));
  mocks.observe.mockResolvedValue({ loggedIn: true, url: 'https://example.com/admin/intake/casinos', text: JSON.stringify(inventory) });
  expect(await (await casinoIntake(...scope())).inventory()).toEqual(inventory);
  expect(mocks.observe).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/admin/intake/casinos', maxChars: 40000 }));
  expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
});
it('never treats a challenge or truncated inventory as an empty catalog', async () => {
  mocks.fetch.mockResolvedValue(new Response('Blocked', { status: 403 }));
  mocks.observe.mockResolvedValue({ loggedIn: true, url: 'https://example.com/admin/intake/casinos', text: '<html>Please verify</html>' });
  await expect((await casinoIntake(...scope())).inventory()).rejects.toThrow('complete JSON');
  mocks.observe.mockResolvedValue({ loggedIn: true, url: 'https://example.com/admin/intake/casinos', text: '{"casinos":[{' });
  await expect((await casinoIntake(...scope())).inventory()).rejects.toThrow('complete JSON');
});
it('keeps adding behind explicit authenticated POST and reports denial accurately', async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json(inventory)).mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
  await expect((await casinoIntake(...scope())).add({ request_id: 'approved' })).rejects.toThrow('does not establish that the browser login expired');
  expect(mocks.observe).not.toHaveBeenCalled();
  expect(mocks.fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ 'x-csrf-token': 'private-csrf' }) });
});
