import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { gzipSync } from 'node:zlib';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

vi.mock('server-only', () => ({}));

const github = vi.hoisted(() => ({ head: 'a'.repeat(40), archives: new Map<string, Uint8Array>(), downloads: 0, commitFetches: 0 }));
vi.mock('@/lib/ai/ideCommitPush', () => ({
  getIdeRepositoryAccess: async () => ({
    ok: true,
    owner: 'RyShoe8',
    repo: 'playbound',
    defaultBranch: 'main',
    installationId: '1',
    octokit: {
      repos: {
        getBranch: async () => ({ data: { commit: { sha: github.head } } }),
        listCommits: async ({ path }: { path?: string }) => ({
          data: (path ? ['d2'] : ['d2', 'd1']).map((id) => ({ sha: id.repeat(20) })),
        }),
        getCommit: async ({ ref }: { ref: string }) => {
          github.commitFetches += 1;
          const removed = ref.startsWith('d2');
          return {
            data: {
              sha: ref,
              commit: { message: removed ? 'Remove OpenHV edition from OpenRA' : 'Add OpenHV as its own game', author: { name: 'Ryan', date: removed ? '2026-09-27T10:00:00Z' : '2026-09-26T10:00:00Z' } },
              files: [{ filename: 'src/games/openra.ts', status: 'modified', additions: 0, deletions: 1, patch: "@@ -3 +3 @@\n-  editions: ['Red Alert', 'OpenHV'],\n+  editions: ['Red Alert']," }],
            },
          };
        },
        downloadTarballArchive: async ({ ref }: { ref: string }) => {
          github.downloads += 1;
          return { data: github.archives.get(ref)!.buffer };
        },
      },
    },
  }),
}));

import { readTarGz } from './tar';
import { getRepoSnapshot, listSnapshotDir, RepoSnapshot, RepoSnapshotFile, searchSnapshot } from './snapshot';
import { commitWithDiff, recentCommits, RepoCommit } from './history';

/** Writes a gzipped tar the way GitHub does: a top folder, a PAX global header, PAX long paths. */
function tarGz(files: Record<string, string | Uint8Array>, top = 'RyShoe8-playbound-abc123'): Uint8Array {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, type: string) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const pad = (data: Buffer) => Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
  const global = Buffer.from('52 comment=abc123abc123abc123abc123abc123abc123ab\n');
  blocks.push(header('pax_global_header', global.length, 'g'), pad(global));
  blocks.push(header(`${top}/`, 0, '5'));
  for (const [path, value] of Object.entries(files)) {
    const data = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
    const full = `${top}/${path}`;
    if (full.length > 100) {
      const record = `path=${full}\n`;
      const len = String(record.length + 3 + String(record.length).length).length + record.length + 1;
      const pax = Buffer.from(`${len} ${record}`);
      blocks.push(header('PaxHeader', pax.length, 'x'), pad(pax));
    }
    blocks.push(header(full.slice(0, 100), data.length, '0'), pad(data));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

const LONG = `src/app/admin/connect/game-servers/${'nested/'.repeat(12)}editions.ts`;
const FILES = {
  'README.md': '# PlayBound\n',
  'src/games/openra.ts': "export const openra = {\n  name: 'OpenRA',\n  editions: ['Red Alert', 'Tiberian Dawn', 'OpenHV'],\n};\n",
  'src/games/openhv.ts': "export const openhv = { name: 'OpenHV' };\n",
  [LONG]: "import { openra } from '../openra';\n// OpenHV listed here too\n",
  'public/logo.png': new Uint8Array([137, 80, 78, 71, 0, 0, 0, 13]),
};

let replica: MongoMemoryReplSet;
const org = 'org';
const projectId = new Types.ObjectId();

beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
  await mongoose.connect(replica.getUri('nucleas_snapshot_test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});

beforeEach(async () => {
  await Promise.all([RepoSnapshot.deleteMany({}), RepoSnapshotFile.deleteMany({})]);
  github.downloads = 0;
  github.head = 'a'.repeat(40);
  github.archives.set(github.head, tarGz(FILES));
});

describe('reading GitHub archives', () => {
  it('strips the top folder, follows PAX long paths and skips the global header', () => {
    const files = readTarGz(tarGz(FILES));
    expect(files.map((f) => f.path).sort()).toEqual(Object.keys(FILES).sort());
    expect(Buffer.from(files.find((f) => f.path === 'src/games/openhv.ts')!.bytes).toString()).toContain("name: 'OpenHV'");
  });
});

describe('local repository copy', () => {
  it('stores every text file once per commit, skips binaries, and serves search, listing and reads', async () => {
    const first = await getRepoSnapshot(org, projectId);
    if (!first.ok) throw new Error(first.reason);
    expect(first.snapshot.files.size).toBe(4);
    expect(first.snapshot.skipped).toEqual(['public/logo.png']);
    expect(await RepoSnapshotFile.countDocuments()).toBe(4);

    const found = searchSnapshot(first.snapshot, { query: 'openhv' });
    if ('error' in found) throw new Error(found.error);
    expect(found.filesMatched.sort()).toEqual([LONG, 'src/games/openhv.ts', 'src/games/openra.ts'].sort());
    const inOpenRa = found.matches.find((m) => m.path === 'src/games/openra.ts')!;
    expect(inOpenRa).toMatchObject({ line: 3, before: ["export const openra = {", "  name: 'OpenRA',"], after: ['};'] });

    const scoped = searchSnapshot(first.snapshot, { query: "name: '(OpenRA|OpenHV)'", regex: true, glob: 'src/games/*.ts', caseSensitive: true });
    if ('error' in scoped) throw new Error(scoped.error);
    expect(scoped.totalMatches).toBe(2);
    expect(searchSnapshot(first.snapshot, { query: '([', regex: true })).toEqual({ error: 'Invalid regular expression.' });

    expect(listSnapshotDir(first.snapshot, '')).toEqual([
      { path: 'public', type: 'dir' },
      { path: 'src', type: 'dir' },
      { path: 'README.md', type: 'file' },
    ]);

    // Same commit: no second download.
    const again = await getRepoSnapshot(org, projectId);
    expect(again.ok).toBe(true);
    expect(github.downloads).toBe(1);
  });

  it('rebuilds when the branch moves and keeps only the two newest copies', async () => {
    await getRepoSnapshot(org, projectId);
    const start = Date.now();
    let step = 0;
    for (const sha of ['b'.repeat(40), 'c'.repeat(40)]) {
      step += 1;
      github.head = sha;
      github.archives.set(sha, tarGz({ ...FILES, 'CHANGELOG.md': `commit ${sha.slice(0, 1)}` }));
      // The head check is cached for a minute; let it expire.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(start + step * 120_000);
      const result = await getRepoSnapshot(org, projectId);
      vi.useRealTimers();
      if (!result.ok) throw new Error(result.reason);
      expect(result.snapshot.commit).toBe(sha);
      expect(result.snapshot.files.get('CHANGELOG.md')).toBe(`commit ${sha.slice(0, 1)}`);
    }
    expect(github.downloads).toBe(3);
    expect((await RepoSnapshot.find().lean()).map((s) => s.commit).sort()).toEqual(['b'.repeat(40), 'c'.repeat(40)]);
  });
});

describe('recent changes', () => {
  it('lists recent commits with their files, filters by path, and keeps each commit after the first fetch', async () => {
    await RepoCommit.deleteMany({});
    github.commitFetches = 0;
    const history = await recentCommits(org, projectId, { count: 20 });
    if (!history.ok) throw new Error(history.reason);
    expect(history.commits.map((c) => c.message)).toEqual(['Remove OpenHV edition from OpenRA', 'Add OpenHV as its own game']);
    expect(history.commits[0].files[0]).toEqual({ path: 'src/games/openra.ts', status: 'modified', additions: 0, deletions: 1 });

    const scoped = await recentCommits(org, projectId, { path: 'src/games/openra.ts' });
    expect(scoped.ok && scoped.commits.length).toBe(1);

    const diff = await commitWithDiff(org, projectId, 'd2'.repeat(20));
    expect(diff.ok && diff.commit.files[0].patch).toContain("-  editions: ['Red Alert', 'OpenHV'],");
    // Two commits fetched once each; everything after came from our database.
    expect(github.commitFetches).toBe(2);
    expect(await commitWithDiff(org, projectId, 'not a sha')).toMatchObject({ ok: false });
  });
});
