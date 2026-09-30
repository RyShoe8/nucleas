/**
 * Replay evaluation on a repository's own history: how often does the dig show the files a past change
 * actually touched, using only the commit message as the request?
 *
 *   npx tsx scripts/eval-replay.ts [repoPath] [--limit=60] [--k=8] [--mask-paths] [--verbose]
 *
 * Works on any git checkout (any language or framework). Compares the old keyword ranking with the current
 * dig (keyword ranking plus tracing). Caveats: files are read as they are at HEAD, not as they were at the
 * commit, and commit messages often name the files they change; --mask-paths removes those names for a
 * harder test.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { selectDigFiles } from '../src/lib/ai/repo/digFiles';
import { keywordBaseline, maskPaths, mineCases, scoreRetrieval, summarize, type CommitRecord } from '../src/lib/ai/eval/replay';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const repo = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const limit = flag('limit', 60);
const k = flag('k', 8);
const mask = args.includes('--mask-paths');
const verbose = args.includes('--verbose');

const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const files = new Map<string, string>();
for (const rel of git('ls-files').split('\n').filter(Boolean)) {
  try {
    const full = path.join(repo, rel);
    if (statSync(full).size > 400_000) continue;
    const buf = readFileSync(full);
    if (!buf.subarray(0, 8000).includes(0)) files.set(rel, buf.toString('utf8'));
  } catch { /* deleted or unreadable */ }
}

// One record per commit: RS sha US subject US body US, then the changed file names, one per line.
const commits: CommitRecord[] = git('log', '--no-merges', '-n', String(limit * 4), '--name-only', '--pretty=format:%x1e%H%x1f%s%x1f%b%x1f')
  .split('\x1e').filter((chunk) => chunk.trim()).map((chunk) => {
    const [sha, subject, body, fileText = ''] = chunk.split('\x1f');
    return { sha: sha.trim(), subject: subject ?? '', body: body ?? '', files: fileText.split('\n').map((f) => f.trim()).filter(Boolean) };
  });

const cases = mineCases(commits, new Set(files.keys())).slice(0, limit);
if (!cases.length) { console.log('No usable commits found (need focused commits whose changed source files still exist).'); process.exit(0); }

const baseline = [] as ReturnType<typeof scoreRetrieval>[];
const current = [] as ReturnType<typeof scoreRetrieval>[];
for (const c of cases) {
  const request = mask ? maskPaths(c.request) : c.request;
  const before = scoreRetrieval(keywordBaseline(files, request, k), c.truth, k);
  const after = scoreRetrieval(selectDigFiles(files, request, request, k).paths, c.truth, k);
  baseline.push(before);
  current.push(after);
  if (verbose && before.hit !== after.hit) console.log(`${after.hit ? 'gained ' : 'LOST   '} ${c.id} ${c.request.slice(0, 90)}  (truth: ${c.truth.slice(0, 3).join(', ')})`);
}

const row = (name: string, s: ReturnType<typeof summarize>) =>
  `${name.padEnd(22)} hit@${k} ${(s.hitRate * 100).toFixed(0).padStart(3)}%   mean recall ${(s.meanRecall * 100).toFixed(0).padStart(3)}%   mean rank of first answer ${s.meanFirstRank.toFixed(1)}`;
console.log(`${repo}: ${cases.length} past changes replayed${mask ? ' (file names masked)' : ''}, ${files.size} files\n`);
console.log(row('keyword ranking', summarize(baseline)));
console.log(row('current dig (traced)', summarize(current)));
