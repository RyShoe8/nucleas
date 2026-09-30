import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/repo/snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/repo/snapshot')>()),
  getRepoSnapshot: (...args: unknown[]) => mocks.snapshot(...args),
}));

import { executeIdeTool } from '@/lib/ai/tools/executeTool';

const files = new Map<string, string>([
  ['package.json', '{"dependencies":{"next":"14"}}'],
  ['app/admin/users/page.tsx', "import Table from '@/components/Table';\nexport default function P() { return null }"],
  ['components/Table.tsx', "import { rows } from '@/lib/rows';\nexport default function T() {}"],
  ['lib/rows.ts', 'export const rows = [];'],
]);

const gateway = { endpoint: 'https://x.test/v1/chat/completions', bearerToken: 'k', model: 'm', protocol: 'openai-chat' as const };
const run = async (args: Record<string, unknown>) => {
  const result = await executeIdeTool({ name: 'repo_references', argumentsJson: JSON.stringify(args), gateway, organizationId: 'org', projectId: new Types.ObjectId(), userId: 'u' });
  return JSON.parse(result.content) as Record<string, unknown>;
};

describe('repo_references tool', () => {
  beforeEach(() => {
    mocks.snapshot.mockResolvedValue({ ok: true, snapshot: { commit: 'a'.repeat(40), files } });
  });

  it('used_by (default): from a data file up to the pages that show it', async () => {
    const out = await run({ path: 'lib/rows.ts' });
    expect(out).toMatchObject({ ok: true, routes: ['/admin/users'] });
    expect((out.references as { path: string }[]).map((r) => r.path)).toEqual(['components/Table.tsx', 'app/admin/users/page.tsx']);
  });

  it('uses: from a page file, or from a URL path, down to everything it depends on', async () => {
    const byFile = await run({ path: 'app/admin/users/page.tsx', direction: 'uses' });
    expect(byFile).toMatchObject({ ok: true, start: 'app/admin/users/page.tsx', uses: ['components/Table.tsx', 'lib/rows.ts'] });
    const byUrl = await run({ path: '/admin/users', direction: 'uses' });
    expect(byUrl).toMatchObject({ ok: true, start: 'app/admin/users/page.tsx', route: '/admin/users', uses: ['components/Table.tsx', 'lib/rows.ts'] });
  });

  it('says so when there is nothing at the path or URL', async () => {
    expect(await run({ path: '/nowhere/at-all', direction: 'uses' })).toMatchObject({ ok: false, error: expect.stringContaining('No file or page') });
    expect(await run({ path: 'missing.ts' })).toMatchObject({ ok: false, error: expect.stringContaining('No file at') });
  });
});
