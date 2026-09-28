import { Types } from 'mongoose';
import { listIdeTree, readIdeFile } from '@/lib/ai/ideCommitPush';
import { extractChatHeuristicText } from '@/lib/ai/tools/serverBrowseAssist';
import { getRepoSnapshot, type LoadedSnapshot } from '@/lib/ai/repo/snapshot';
import { repositoryEvidenceReceipt, type RepositoryEvidenceReceipt } from '@/lib/ai/evidenceReceipts';

const PATH_HINT =
  /\b(rule|rules|task.?rule|taskRule|AiProjectTaskRule|IdeTaskRules|planMode|ideChat|prompt|\.cursor|nucleas|architecture|companyChat|teamChat)\b/i;

const RULES_QUERY =
  /\b(rules?\s+system|task\s+rules?|how\s+(?:do|does)\s+(?:our|the)\s+rules|rule\s+schema|loadTaskRules)\b/i;

const IDE_CONTEXT_QUERY =
  /\b(context\s+in\s+(?:our|the)\s+IDE|how\s+do\s+we\s+handle|IDE\s+chat|chat\s+history|ide\s+context|persist(?:ence)?|restore\s+session)\b/i;

/** Known rules/architecture files — read first when the query is about rules. */
const RULES_PRIORITY_PATHS = [
  'src/lib/ide/taskRuleSchema.ts',
  'src/lib/ide/loadTaskRules.ts',
  'src/lib/ide/modes.ts',
  'src/lib/models/AiProjectTaskRule.ts',
  'src/components/ide/IdeTaskRulesPanel.tsx',
  'src/app/api/projects/[id]/ai/ide/chat/route.ts',
  'src/lib/ai/teamChat.ts',
  'src/lib/ai/ideDirectChat.ts',
];

const IDE_CONTEXT_PATHS = [
  'src/lib/ide/chatHistory.ts',
  'src/lib/ai/ideDirectChat.ts',
  'src/lib/ide/ideChatStream.ts',
  'src/lib/ide/loadTaskRules.ts',
  'src/app/api/projects/[id]/ai/ide/chat/route.ts',
  'src/lib/ai/teamChat.ts',
  'src/lib/ai/tools/runToolLoop.ts',
  'src/lib/ai/tools/executeTool.ts',
  'src/lib/ide/chatSelectionStorage.ts',
  'src/components/ide/IdeChatPane.tsx',
];

const PRIORITY_PATH_SET = new Set([...RULES_PRIORITY_PATHS, ...IDE_CONTEXT_PATHS]);

/**
 * Seed dirs listed in parallel. Root '' is fetched separately first (bind check).
 * Wider coverage so scoring can pick across IDE / AI / API / UI / cursor rules.
 */
const SEED_DIRS = [
  '',
  'src',
  'src/lib',
  'src/lib/ide',
  'src/lib/ai',
  'src/lib/ai/tools',
  'src/lib/models',
  'src/components',
  'src/components/ide',
  'src/app/api/projects',
  '.cursor',
  '.cursor/rules',
];

/** Per-request seed dig size (server load). Further reading happens via Worker tool loop + completion gate. */
const BATCH_SIZE = 20;
const PER_FILE_CHARS = 2500;
const PRIORITY_FILE_CHARS = 12_000;
const TREE_CHARS_WITH_READS = 2000;
const TREE_CHARS_TREE_ONLY = 8000;
const FILES_CHARS = 40_000;
const CONTEXT_CHARS = 48_000;
const QUERY_STOP_WORDS = new Set([
  'about', 'after', 'also', 'been', 'before', 'could', 'does', 'from', 'have', 'into', 'listed',
  'listing', 'make', 'need', 'only', 'page', 'remove', 'should', 'that', 'their', 'there', 'these',
  'thing', 'this', 'under', 'want', 'what', 'when', 'where', 'which', 'with', 'would',
]);

export type RepoAssistResult = {
  ok: boolean;
  note: string;
  okReads: number;
  toolsUsed: string[];
  contextBlock: string;
  /** Compact excerpts for Reviewer (file bodies only, no tree). */
  evidenceBlock: string;
  evidenceReceipts: RepositoryEvidenceReceipt[];
};

function scorePath(path: string, query: string): number {
  let score = 0;
  if (PATH_HINT.test(path)) score += 4;
  const q = query.toLowerCase();
  for (const token of q.split(/\W+/).filter((t) => t.length > 3).slice(0, 12)) {
    if (path.toLowerCase().includes(token)) score += 2;
  }
  if (/\.(ts|tsx|md|mdc)$/i.test(path)) score += 1;
  return score;
}

function pickReadPaths(
  query: string,
  candidateFiles: { path: string; score: number }[],
  limit: number
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (path: string) => {
    if (seen.has(path) || ordered.length >= limit) return;
    seen.add(path);
    ordered.push(path);
  };

  if (RULES_QUERY.test(query) || PATH_HINT.test(query)) {
    for (const path of RULES_PRIORITY_PATHS) push(path);
  }
  if (IDE_CONTEXT_QUERY.test(query)) {
    for (const path of IDE_CONTEXT_PATHS) push(path);
  }

  const scored = [...candidateFiles].sort(
    (a, b) => b.score - a.score || a.path.localeCompare(b.path)
  );
  for (const item of scored) push(item.path);

  return ordered;
}

function fileCharBudget(path: string, ceiling = PRIORITY_FILE_CHARS): number {
  return Math.min(PRIORITY_PATH_SET.has(path) ? PRIORITY_FILE_CHARS : PER_FILE_CHARS, ceiling);
}

function queryTokens(query: string): string[] {
  return [...new Set((query.match(/[A-Za-z0-9_-]{4,}/g) ?? []).map(token => token.toLowerCase()))]
    .filter(token => !QUERY_STOP_WORDS.has(token))
    .slice(0, 16);
}

/** Whole-repository candidate selection that makes no assumptions about src/platform/app layout. */
export function snapshotCandidates(snapshot: LoadedSnapshot, query: string, limit = BATCH_SIZE): string[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const scored: { path: string; score: number }[] = [];
  for (const [path, content] of snapshot.files) {
    const pathLower = path.toLowerCase();
    const contentLower = content.toLowerCase();
    let score = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|json|ya?ml)$/i.test(path) ? 2 : 0;
    let hits = 0;
    for (const token of tokens) {
      if (pathLower.includes(token)) { score += 12; hits += 1; }
      if (contentLower.includes(token)) { score += 4; hits += 1; }
    }
    if (hits) scored.push({ path, score: score + hits * hits });
  }
  return scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit).map(row => row.path);
}

/** Center an excerpt on the densest cluster of query terms, not merely the first incidental hit. */
function relevantExcerptStart(content: string, query: string, excerptChars: number): number {
  const lower = content.toLowerCase();
  const positions: number[] = [];
  for (const token of queryTokens(query)) {
    let from = 0;
    for (let count = 0; count < 12; count += 1) {
      const position = lower.indexOf(token, from);
      if (position < 0) break;
      positions.push(position);
      from = position + token.length;
    }
  }
  if (!positions.length) return 0;
  const radius = Math.max(400, Math.floor(excerptChars / 2));
  const center = positions.reduce((best, candidate) => {
    const density = positions.filter((position) => Math.abs(position - candidate) <= radius).length;
    const bestDensity = positions.filter((position) => Math.abs(position - best) <= radius).length;
    return density > bestDensity ? candidate : best;
  }, positions[0]!);
  return Math.max(0, center - Math.floor(excerptChars / 2));
}

function snapshotExcerpt(snapshot: LoadedSnapshot, path: string, query: string, maxChars: number): { block: string; receipt: RepositoryEvidenceReceipt } | null {
  const content = snapshot.files.get(path);
  if (content === undefined) return null;
  const excerptChars = fileCharBudget(path, maxChars);
  const start = relevantExcerptStart(content, query, excerptChars);
  const excerpt = content.slice(start, start + excerptChars);
  const startLine = content.slice(0, start).split('\n').length;
  const endLine = startLine + excerpt.split('\n').length - 1;
  return {
    block: `File ${path} (branch ${snapshot.branch}, commit ${snapshot.commit.slice(0, 12)}; lines ${startLine}-${endLine}):\n${start > 0 ? '[…]\n' : ''}${excerpt}${start + excerpt.length < content.length ? '\n[…]' : ''}`,
    receipt: repositoryEvidenceReceipt({ tool: 'repo_search', path, revision: snapshot.commit, startLine, endLine, content: excerpt }),
  };
}

async function readPathsBatch(
  organizationId: string,
  projectId: Types.ObjectId,
  paths: string[],
  maxCharsPerFile = PRIORITY_FILE_CHARS
): Promise<{
  fileBlocks: string[];
  readErrors: string[];
  okReads: number;
  toolsUsed: string[];
  evidenceReceipts: RepositoryEvidenceReceipt[];
}> {
  const toolsUsed: string[] = [];
  const reads = await Promise.all(
    paths.map(async (path) => {
      const file = await readIdeFile(organizationId, projectId, path);
      return { path, file };
    })
  );
  toolsUsed.push(...paths.map(() => 'repo_read'));

  const fileBlocks: string[] = [];
  const readErrors: string[] = [];
  const evidenceReceipts: RepositoryEvidenceReceipt[] = [];
  let okReads = 0;
  for (const { path, file } of reads) {
    if (!file.ok) {
      readErrors.push(`${path}: ${file.reason}`);
      continue;
    }
    okReads += 1;
    const excerpt = file.content.slice(0, fileCharBudget(path, maxCharsPerFile));
    fileBlocks.push(`File ${file.path} (branch ${file.branch}):\n${excerpt}`);
    evidenceReceipts.push(repositoryEvidenceReceipt({
      tool: 'repo_read', path: file.path, revision: file.sha || file.branch,
      startLine: 1, endLine: excerpt.split('\n').length, content: excerpt,
    }));
  }
  return { fileBlocks, readErrors, okReads, toolsUsed, evidenceReceipts };
}

/** Nucleas-side repo dig for hosts that struggle with tool calling. */
export async function gatherRepoAssistContext(input: {
  organizationId: string;
  projectId: Types.ObjectId;
  userText: string;
  /** Model-aware server-side cap; evidence is reduced before it enters an inference request. */
  maxContextChars?: number;
  maxFiles?: number;
}): Promise<RepoAssistResult> {
  const query = extractChatHeuristicText(input.userText);
  const maxContextChars = Math.max(4_000, Math.min(input.maxContextChars ?? CONTEXT_CHARS, CONTEXT_CHARS));
  const maxFiles = Math.max(2, Math.min(input.maxFiles ?? BATCH_SIZE, BATCH_SIZE));
  const maxCharsPerFile = Math.max(1_200, Math.floor((maxContextChars - 1_000) / maxFiles));
  const toolsUsed: string[] = [];
  const candidateFiles: { path: string; score: number }[] = [];
  const treeLines: string[] = [];

  // Prefer the current local snapshot: it covers every nested folder and supplies actual source
  // excerpts before any model runs. Fall back to the GitHub tree path for older/unbuilt projects.
  const local = await getRepoSnapshot(input.organizationId, input.projectId).catch(() => null);
  if (local?.ok) {
    toolsUsed.push('repo_search');
    const paths = snapshotCandidates(local.snapshot, query, maxFiles);
    const excerpts = paths.map(path => snapshotExcerpt(local.snapshot, path, query, maxCharsPerFile)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const fileBlocks = excerpts.map(item => item.block);
    if (fileBlocks.length) {
      toolsUsed.push('repo_read');
      const evidenceBlock = fileBlocks.join('\n\n').slice(0, maxContextChars);
      return {
        ok: true,
        note: `Read ${fileBlocks.length} whole-repository match(es) from commit ${local.snapshot.commit.slice(0, 12)}.`,
        okReads: fileBlocks.length,
        toolsUsed,
        evidenceBlock,
        evidenceReceipts: excerpts.map(item => item.receipt),
        contextBlock: [
          'Repository dig results (deterministic whole-repository search; use these excerpts before calling more tools):',
          `Query focus: ${query}`,
          fileBlocks.join('\n\n').slice(0, Math.min(FILES_CHARS, maxContextChars)),
          'If anything is still missing, use repo_search/repo_read for another range. Do not stop at path lists.',
        ].join('\n\n').slice(0, maxContextChars),
      };
    }
  }

  const rootTree = await listIdeTree(input.organizationId, input.projectId, '');
  toolsUsed.push('repo_tree');
  if (!rootTree.ok) {
    return {
      ok: false,
      note: rootTree.reason,
      okReads: 0,
      toolsUsed: [...new Set(toolsUsed)],
      contextBlock: [
        'Repository dig (Nucleas):',
        `Note: ${rootTree.reason}`,
        'No repo tree available. Tell the user to bind a GitHub repository or connect the GitHub App for this project.',
      ].join('\n'),
      evidenceBlock: '',
      evidenceReceipts: [],
    };
  }

  const nestedDirs = SEED_DIRS.filter((dir) => dir !== '');
  const nestedTrees = await Promise.all(
    nestedDirs.map(async (dir) => ({
      dir,
      tree: await listIdeTree(input.organizationId, input.projectId, dir),
    }))
  );
  toolsUsed.push(...nestedDirs.map(() => 'repo_tree'));

  const allTrees: { dir: string; tree: Awaited<ReturnType<typeof listIdeTree>> }[] = [
    { dir: '', tree: rootTree },
    ...nestedTrees,
  ];

  for (const { dir, tree } of allTrees) {
    if (!tree.ok) continue;
    treeLines.push(`Tree path="${dir || '/'}" branch=${tree.branch}:`);
    for (const entry of tree.entries.slice(0, 120)) {
      treeLines.push(`  ${entry.type}\t${entry.path}`);
      if (entry.type === 'file') {
        const score = scorePath(entry.path, query);
        if (score > 0) candidateFiles.push({ path: entry.path, score });
      }
    }
  }

  const uniquePaths = pickReadPaths(query, candidateFiles, maxFiles);
  const first = await readPathsBatch(input.organizationId, input.projectId, uniquePaths, maxCharsPerFile);
  toolsUsed.push(...first.toolsUsed);

  const fileBlocks = first.fileBlocks;
  const readErrors = first.readErrors;
  const okReads = first.okReads;

  const emptyReadGuidance =
    readErrors.length > 0
      ? `File reads failed (${readErrors.slice(0, 3).join('; ')}). Report that exact error to the user. Do not invent file contents or claim repository tools are generally unavailable. Additional files may still be readable via repo_read.`
      : 'No high-confidence rule/architecture files were read from the tree. List what is missing and suggest binding the GitHub repo or reconnecting the GitHub App if reads are blocked. Do not invent file contents.';

  const errorHeader =
    readErrors.length > 0
      ? `Read errors:\n${readErrors
          .slice(0, 12)
          .map((line) => `- ${line}`)
          .join('\n')}`
      : '';

  const filesSection =
    okReads > 0
      ? [
          fileBlocks.join('\n\n').slice(0, Math.min(FILES_CHARS, maxContextChars)),
          'This dig is a seed. If anything is still missing, keep using repo_search/repo_read until the question is fully answered with quoted evidence.',
        ].join('\n\n')
      : emptyReadGuidance;

  const treeBudget = okReads > 0 ? TREE_CHARS_WITH_READS : TREE_CHARS_TREE_ONLY;
  const treeAppendix = treeLines.join('\n').slice(0, treeBudget);

  // Evidence first (file bodies), tree last — so truncation never drops code.
  const contextBlock = [
    'Repository dig results (use these; do not invent file contents beyond them):',
    `Query focus: ${query}`,
    errorHeader,
    filesSection,
    okReads > 0 ? `Tree appendix (filenames only):\n${treeAppendix}` : treeAppendix,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxContextChars);

  const evidenceBlock = [
    errorHeader,
    okReads > 0 ? fileBlocks.join('\n\n').slice(0, maxContextChars) : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxContextChars);

  return {
    ok: true,
    note: okReads > 0 ? `Read ${okReads} file(s).` : 'Tree only; no scored files.',
    okReads,
    toolsUsed: [...new Set(toolsUsed)],
    contextBlock,
    evidenceBlock,
    evidenceReceipts: first.evidenceReceipts,
  };
}

export function formatRepoAssistContext(result: RepoAssistResult): string {
  return result.contextBlock;
}
