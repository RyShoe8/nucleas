import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
  listTree: vi.fn(),
  readFile: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('@/lib/ai/ideCommitPush', () => ({
  listIdeTree: mocks.listTree,
  readIdeFile: mocks.readFile,
}));
vi.mock('@/lib/ai/repo/snapshot', () => ({
  getRepoSnapshot: (...args: unknown[]) => mocks.snapshot(...args),
}));

import { gatherRepoAssistContext } from '@/lib/ai/tools/serverRepoAssist';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot.mockResolvedValue({ ok: false, reason: 'No local snapshot.' });
});

describe('gatherRepoAssistContext', () => {
  it('finds and reads relevant files in an arbitrary nested repository layout', async () => {
    mocks.snapshot.mockResolvedValue({
      ok: true,
      snapshot: {
        owner: 'playbound', repo: 'platform', branch: 'main', commit: 'a'.repeat(40), skipped: [],
        files: new Map([
          ['platform/src/app/admin/connect/game-servers/page.tsx', 'const groups = recipes.map(renderGame); // OpenHV display'],
          ['platform/src/lib/gameHost/recipes.js', "export const OpenRA = { editions: ['OpenHV'] };\nexport const OpenHV = {};"],
          ['docs/notes.md', 'unrelated documentation'],
        ]),
      },
    });

    const result = await gatherRepoAssistContext({
      organizationId: 'org', projectId: new Types.ObjectId(),
      userText: 'On /admin/connect/game-servers OpenHV is also under OpenRA. Remove that nested listing.',
    });

    expect(result.ok).toBe(true);
    expect(result.okReads).toBe(2);
    expect(result.toolsUsed).toEqual(['repo_search', 'repo_read']);
    expect(result.evidenceBlock).toContain('platform/src/app/admin/connect/game-servers/page.tsx');
    expect(result.evidenceBlock).toContain('platform/src/lib/gameHost/recipes.js');
    expect(result.evidenceReceipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'repository', path: 'platform/src/lib/gameHost/recipes.js', revision: 'a'.repeat(40), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]));
    expect(mocks.listTree).not.toHaveBeenCalled();
  });

  it('returns unbound note when root tree fails', async () => {
    mocks.listTree.mockResolvedValue({ ok: false, reason: 'Bind a GitHub repository.' });
    const result = await gatherRepoAssistContext({
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userText: 'what does our rules system actually do?',
    });
    expect(result.ok).toBe(false);
    expect(result.contextBlock).toMatch(/bind a GitHub/i);
    expect(result.toolsUsed).toContain('repo_tree');
  });

  it('reads priority rules files first for rules-system questions (up to 20)', async () => {
    mocks.listTree.mockImplementation(async (_org: string, _proj: unknown, path = '') => {
      if (path === '') {
        return {
          ok: true,
          branch: 'main',
          entries: [
            { name: 'src', path: 'src', type: 'dir', sha: '1' },
            { name: 'README.md', path: 'README.md', type: 'file', sha: '2' },
          ],
        };
      }
      if (path === 'src/lib/ide') {
        return {
          ok: true,
          branch: 'main',
          entries: [
            { name: 'planModePrompt.ts', path: 'src/lib/ide/planModePrompt.ts', type: 'file', sha: '3' },
            { name: 'loadTaskRules.ts', path: 'src/lib/ide/loadTaskRules.ts', type: 'file', sha: '4' },
            { name: 'taskRuleSchema.ts', path: 'src/lib/ide/taskRuleSchema.ts', type: 'file', sha: '5' },
            { name: 'modes.ts', path: 'src/lib/ide/modes.ts', type: 'file', sha: '6' },
            { name: 'ideChatStream.ts', path: 'src/lib/ide/ideChatStream.ts', type: 'file', sha: '7' },
          ],
        };
      }
      if (path === 'src/lib/ai') {
        return {
          ok: true,
          branch: 'main',
          entries: [
            { name: 'teamChat.ts', path: 'src/lib/ai/teamChat.ts', type: 'file', sha: '8' },
            { name: 'companyChat.ts', path: 'src/lib/ai/companyChat.ts', type: 'file', sha: '9' },
          ],
        };
      }
      return { ok: true, branch: 'main', entries: [] };
    });
    mocks.readFile.mockImplementation(async (_org: string, _proj: unknown, path: string) => ({
      ok: true,
      path,
      branch: 'main',
      content: `// contents of ${path}`,
      sha: 'x',
    }));

    const result = await gatherRepoAssistContext({
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userText: 'how does our rules system work?',
    });
    expect(result.ok).toBe(true);
    expect(result.toolsUsed).toEqual(expect.arrayContaining(['repo_tree', 'repo_read']));
    expect(result.contextBlock).toMatch(/loadTaskRules/);
    expect(result.contextBlock).toMatch(/taskRuleSchema/);
    // File bodies must appear before the tree appendix.
    const fileIdx = result.contextBlock.indexOf('File src/lib/ide/loadTaskRules.ts');
    const treeIdx = result.contextBlock.indexOf('Tree appendix');
    expect(fileIdx).toBeGreaterThan(-1);
    expect(treeIdx).toBeGreaterThan(fileIdx);
    expect(result.evidenceBlock).toMatch(/loadTaskRules/);
    expect(mocks.readFile.mock.calls.length).toBeLessThanOrEqual(20);
    expect(mocks.readFile.mock.calls.length).toBeGreaterThanOrEqual(2);
    const readPaths = mocks.readFile.mock.calls.map((c: unknown[]) => c[2] as string);
    expect(readPaths[0]).toBe('src/lib/ide/taskRuleSchema.ts');
    expect(readPaths).toContain('src/lib/ide/loadTaskRules.ts');
    // root + widened nested seeds
    expect(mocks.listTree.mock.calls.length).toBeGreaterThan(4);
    expect(mocks.listTree.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it('uses src/lib/ai/ideDirectChat.ts for IDE context digs (not ide/ideDirectChat)', async () => {
    mocks.listTree.mockResolvedValue({ ok: true, branch: 'main', entries: [] });
    mocks.readFile.mockImplementation(async (_org: string, _proj: unknown, path: string) => {
      if (path.includes('ide/ideDirectChat')) {
        return { ok: false, reason: 'Unable to read the file from GitHub.' };
      }
      return {
        ok: true,
        path,
        branch: 'main',
        content: `// contents of ${path}`,
        sha: 'x',
      };
    });

    const result = await gatherRepoAssistContext({
      organizationId: 'org',
      projectId: new Types.ObjectId(),
      userText: 'how do we store context in our IDE?',
    });

    const readPaths = mocks.readFile.mock.calls.map((c: unknown[]) => c[2] as string);
    expect(readPaths).toContain('src/lib/ai/ideDirectChat.ts');
    expect(readPaths).not.toContain('src/lib/ide/ideDirectChat.ts');
    expect(readPaths).toContain('src/app/api/projects/[id]/ai/ide/chat/route.ts');
    expect(readPaths).toContain('src/lib/ide/chatHistory.ts');
    expect(result.okReads).toBeGreaterThanOrEqual(4);
    expect(result.contextBlock).toMatch(/ideDirectChat/);
    expect(result.contextBlock).toMatch(/seed/i);
  });
});
