import { beforeEach, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { casinoIntake } from './intake';
const mocks = vi.hoisted(() => ({ observe: vi.fn(), fetch: vi.fn(), worker: vi.fn() }));
vi.mock('@/lib/companies/adminAccount', () => ({ adminSessionFor: async () => ({ baseUrl: 'https://example.com', cookies: [{ name: 'session', value: 'private', domain: 'example.com', path: '/' }] }) }));
vi.mock('@/lib/ai/tools/browserClient', () => ({ browserObserve: mocks.observe, browserWorkerCall: mocks.worker }));
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
it('posts directly when the site accepts it, without touching the browser', async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json(inventory)).mockResolvedValueOnce(Response.json({ casino_id: 7 }));
  expect(await (await casinoIntake(...scope())).addDraft({ request_id: 'approved' })).toEqual({ casino_id: 7 });
  expect(mocks.worker).not.toHaveBeenCalled();
  expect(mocks.fetch.mock.calls[1][0]).toBe('https://example.com/admin/intake/casinos/drafts');
  expect(mocks.fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ 'x-csrf-token': 'private-csrf' }) });
});
it('writes through the signed-in browser when a cloud request is refused', async () => {
  mocks.fetch.mockResolvedValueOnce(new Response('Blocked', { status: 403 })).mockResolvedValueOnce(new Response('Blocked', { status: 403 }));
  mocks.observe.mockResolvedValue({ loggedIn: true, url: 'https://example.com/admin/intake/casinos', text: JSON.stringify(inventory) });
  mocks.worker.mockResolvedValue({ status: 200, text: JSON.stringify({ casino_id: 7, admin_url: 'https://example.com/admin/casinos/7/edit' }) });
  expect(await (await casinoIntake(...scope())).addDraft({ request_id: 'approved' })).toMatchObject({ casino_id: 7 });
  expect(mocks.worker).toHaveBeenCalledWith('/admin/intake', expect.objectContaining({ baseUrl: 'https://example.com', url: 'https://example.com/admin/intake/casinos', path: '/admin/intake/casinos/drafts', body: { request_id: 'approved' } }), expect.anything());
});
it.each([
  [404, 'does not have /admin/intake/casinos/drafts yet'],
  [401, 'no longer signed in'],
  [419, 'no longer signed in'],
  [403, 'not allowed to add sites'],
  [500, 'HTTP 500'],
])('says what a %i through the browser means', async (status, message) => {
  mocks.fetch.mockResolvedValueOnce(Response.json(inventory)).mockResolvedValueOnce(new Response('Blocked', { status: 403 }));
  mocks.worker.mockResolvedValue({ status, text: '<html>page</html>' });
  await expect((await casinoIntake(...scope())).addDraft({ request_id: 'approved' })).rejects.toThrow(message);
});
it('passes on a refusal from the site itself, without retrying through the browser', async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json(inventory)).mockResolvedValueOnce(Response.json({ message: 'Casino already exists in the admin catalog.' }, { status: 409 }));
  await expect((await casinoIntake(...scope())).addDraft({ request_id: 'approved' })).rejects.toThrow('already exists');
  expect(mocks.worker).not.toHaveBeenCalled();
});
