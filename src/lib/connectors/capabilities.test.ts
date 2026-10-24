import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { websiteCapabilities } from './capabilities';
import { websiteConnectorConfigSchema } from './contracts';
import type { CapabilityRunContext } from '@/lib/capabilities/types';
const mocks = vi.hoisted(() => ({ list: vi.fn(async () => ({ version: 1, items: [], warnings: [] })), publish: vi.fn(), read: vi.fn() }));
vi.mock('./adapters', () => ({ websiteAdapter: () => mocks }));
const config = websiteConnectorConfigSchema.parse({ version: 1, adapter: 'website-v1', origin: 'https://one.acme.com', enabled: true, permissions: ['content.items.list'], collection: 'news' });
const context = { organizationId: new Types.ObjectId(), companyId: new Types.ObjectId(), access: { provider: 'website', connectionId: new Types.ObjectId(), credential: 'server-only-secret', configuration: config }, now: new Date(), fetch, reportUnits: () => {} } satisfies CapabilityRunContext;
describe('website capability definitions', () => {
    it('uses required publication approval by default and advertises bounded large reads', () => {
        const definitions = websiteCapabilities(config);
        expect(definitions.find(item => item.id === 'content.posts.publish')).toMatchObject({ approval: 'required', idempotent: true, risk: 'communication' });
        expect(definitions.find(item => item.id === 'content.items.list')).toMatchObject({ maxOutputBytes: 2000000 });
    });
    it('does not execute an adapter against a different selected configuration', async () => {
        const definition = websiteCapabilities(config).find(item => item.id === 'content.items.list')!;
        const input = { since: '2026-10-01T00:00:00Z', until: '2026-10-23T00:00:00Z' };
        await expect(definition.run({ ...context, access: { ...context.access, configuration: { ...config, origin: 'https://two.acme.com' } } }, input)).rejects.toMatchObject({ code: 'needs_setup' });
        expect(mocks.list).not.toHaveBeenCalled();
        expect((await definition.run(context, input)).output).toMatchObject({ items: [] });
        expect(mocks.list).toHaveBeenCalledOnce();
    });
});
