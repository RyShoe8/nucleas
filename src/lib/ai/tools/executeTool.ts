import type { GatewayConfiguration } from '@nucleas/ai-core/gateway';
import { GatewayError, generateImage } from '@nucleas/ai-core/gateway';
import { Types } from 'mongoose';
import Asset from '@/lib/models/Asset';
import { browserNavigate } from '@/lib/ai/tools/browserClient';
import { chooseBrowseTool, isBrowserWorkerConfigured } from '@/lib/ai/tools/browseRouter';
import { webFetch } from '@/lib/ai/tools/webFetch';
import { imageHitsToArtifacts } from '@/lib/ai/tools/imageSearchArtifacts';
import { imageSearch, webSearch } from '@/lib/ai/tools/webSearch';
import { listIdeTree, readIdeFile } from '@/lib/ai/ideCommitPush';
import { getRepoSnapshot, listSnapshotDir, searchSnapshot } from '@/lib/ai/repo/snapshot';
import type { LoadedSnapshot, SearchResult } from '@/lib/ai/repo/snapshot';
import { commitWithDiff, recentCommits } from '@/lib/ai/repo/history';
import { repositoryEvidenceReceipt, type RepositoryEvidenceReceipt } from '@/lib/ai/evidenceReceipts';

export type ToolArtifact = {
  kind: 'image';
  assetId: string;
  name: string;
  url: string;
};

export type ToolExecutionResult = {
  content: string;
  artifacts: ToolArtifact[];
  evidenceReceipts?: RepositoryEvidenceReceipt[];
};

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Attach bounded source excerpts to search hits. Small/local models often identify the right path
 * but fail to make the follow-up repo_read call; search evidence keeps planning grounded without
 * trusting a second model decision. The model can still call repo_read for another range.
 */
export function buildRepoSearchEvidence(snapshot: LoadedSnapshot, found: SearchResult) {
  const firstMatchByPath = new Map<string, SearchResult['matches'][number]>();
  for (const match of found.matches) {
    if (!firstMatchByPath.has(match.path)) firstMatchByPath.set(match.path, match);
    if (firstMatchByPath.size >= 4) break;
  }
  return [...firstMatchByPath.values()].flatMap((match) => {
    const content = snapshot.files.get(match.path);
    if (content === undefined) return [];
    const lines = content.split('\n');
    const startLine = Math.max(1, match.line - 35);
    const endLine = Math.min(lines.length, match.line + 55);
    const excerpt = lines.slice(startLine - 1, endLine)
      .map((line, index) => `${startLine + index}: ${line}`)
      .join('\n')
      .slice(0, 8000);
    return [{ path: match.path, startLine, endLine, excerpt }];
  });
}

export async function executeIdeTool(input: {
  name: string;
  argumentsJson: string;
  gateway: GatewayConfiguration;
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  allowedTools?: Set<string>;
  signal?: AbortSignal;
}): Promise<ToolExecutionResult> {
  if (input.allowedTools && !input.allowedTools.has(input.name)) {
    return {
      content: JSON.stringify({
        ok: false,
        error: `Tool "${input.name}" is not permitted for the active tool profile.`,
      }),
      artifacts: [],
    };
  }

  const args = parseArgs(input.argumentsJson);
  const artifacts: ToolArtifact[] = [];

  if (input.name === 'repo_history') {
    const result = await recentCommits(input.organizationId, input.projectId, {
      count: typeof args.count === 'number' ? args.count : undefined,
      path: typeof args.path === 'string' && args.path.trim() ? args.path.trim() : undefined,
    });
    return { content: JSON.stringify(result.ok ? { ok: true, branch: result.branch, commits: result.commits } : { ok: false, error: result.reason }), artifacts };
  }

  if (input.name === 'repo_commit') {
    const result = await commitWithDiff(input.organizationId, input.projectId, typeof args.sha === 'string' ? args.sha.trim() : '');
    return { content: JSON.stringify(result.ok ? { ok: true, commit: result.commit } : { ok: false, error: result.reason }), artifacts };
  }

  if (input.name === 'repo_search') {
    const snap = await getRepoSnapshot(input.organizationId, input.projectId);
    if (!snap.ok) return { content: JSON.stringify({ ok: false, error: snap.reason }), artifacts };
    const found = searchSnapshot(snap.snapshot, {
      query: typeof args.query === 'string' ? args.query : '',
      regex: args.regex === true,
      caseSensitive: args.caseSensitive === true,
      path: typeof args.path === 'string' ? args.path : undefined,
      glob: typeof args.glob === 'string' ? args.glob : undefined,
      maxResults: typeof args.maxResults === 'number' ? args.maxResults : undefined,
      contextLines: typeof args.contextLines === 'number' ? args.contextLines : undefined,
    });
    if ('error' in found) return { content: JSON.stringify({ ok: false, error: found.error }), artifacts };
    const fileEvidence = buildRepoSearchEvidence(snap.snapshot, found);
    return { content: JSON.stringify({
      ok: true,
      commit: snap.snapshot.commit.slice(0, 12),
      ...found,
      fileEvidence,
    }), artifacts, evidenceReceipts: fileEvidence.map((item) => repositoryEvidenceReceipt({
      tool: 'repo_search', path: item.path, revision: snap.snapshot.commit,
      startLine: item.startLine, endLine: item.endLine, content: item.excerpt,
    })) };
  }

  if (input.name === 'repo_tree') {
    const path = typeof args.path === 'string' ? args.path : '';
    // The local copy first (the whole repository at the current commit); GitHub if it is unavailable.
    const snap = await getRepoSnapshot(input.organizationId, input.projectId);
    if (snap.ok) {
      const entries = listSnapshotDir(snap.snapshot, path);
      return { content: JSON.stringify({ ok: true, path, entries: entries.slice(0, 500), truncated: entries.length > 500 }), artifacts };
    }
    const result = await listIdeTree(input.organizationId, input.projectId, path);
    if (!result.ok) {
      return { content: JSON.stringify({ ok: false, error: result.reason }), artifacts };
    }
    const entries = (result.entries ?? []).slice(0, 200).map((e) => ({
      path: e.path.slice(0, 500),
      type: e.type,
    }));
    return {
      content: JSON.stringify({
        ok: true,
        path,
        entries,
        truncated: (result.entries ?? []).length > 200,
      }),
      artifacts,
    };
  }

  if (input.name === 'repo_read') {
    const path = typeof args.path === 'string' ? args.path : '';
    if (!path.trim()) throw new Error('repo_read requires a path.');
    const normalizedPath = path.trim().replace(/^\/+/, '');
    const snap = await getRepoSnapshot(input.organizationId, input.projectId);
    const local = snap.ok ? snap.snapshot.files.get(normalizedPath) : undefined;
    if (snap.ok && local === undefined && snap.snapshot.skipped.includes(normalizedPath)) {
      return { content: JSON.stringify({ ok: false, error: 'That file is binary or larger than 1 MB, so it is not readable as text.' }), artifacts };
    }
    const result =
      local !== undefined && snap.ok
        ? { ok: true as const, path: normalizedPath, branch: snap.snapshot.branch, sha: snap.snapshot.commit.slice(0, 12), content: local }
        : snap.ok
          ? { ok: false as const, reason: `No file at "${normalizedPath}". Use repo_search or repo_tree to find the right path.` }
          : await readIdeFile(input.organizationId, input.projectId, path);
    if (!result.ok) {
      return { content: JSON.stringify({ ok: false, error: result.reason }), artifacts };
    }
    const fullContent = result.content;
    const lines = fullContent.split('\n');
    const totalLines = lines.length;
    const totalChars = fullContent.length;

    const maxChars = Math.min(Math.max(Number(args.maxChars) || 20000, 500), 60000);
    const startLineArg =
      typeof args.startLine === 'number' && args.startLine > 0
        ? Math.floor(args.startLine)
        : undefined;
    const lineCountArg =
      typeof args.lineCount === 'number' && args.lineCount > 0
        ? Math.floor(args.lineCount)
        : undefined;
    const offsetArg =
      typeof args.offset === 'number' && args.offset >= 0
        ? Math.floor(args.offset)
        : undefined;

    let extracted: string;
    let effectiveStartLine = 1;
    let effectiveEndLine = totalLines;
    let isTruncated = false;

    if (startLineArg !== undefined) {
      effectiveStartLine = Math.min(startLineArg, totalLines);
      const count =
        lineCountArg ?? Math.max(1, Math.min(200, totalLines - effectiveStartLine + 1));
      const slicedLines = lines.slice(
        effectiveStartLine - 1,
        effectiveStartLine - 1 + count
      );
      effectiveEndLine = effectiveStartLine + slicedLines.length - 1;
      let text = slicedLines.join('\n');
      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
        isTruncated = true;
      }
      extracted = text;
      isTruncated = isTruncated || effectiveEndLine < totalLines;
    } else if (offsetArg !== undefined) {
      const offset = Math.min(offsetArg, totalChars);
      extracted = fullContent.slice(offset, offset + maxChars);
      effectiveStartLine = fullContent.slice(0, offset).split('\n').length;
      isTruncated = offset + extracted.length < totalChars;
    } else {
      if (fullContent.length > maxChars) {
        extracted = fullContent.slice(0, maxChars);
        isTruncated = true;
      } else {
        extracted = fullContent;
      }
    }
    if (startLineArg === undefined) {
      effectiveEndLine = effectiveStartLine + extracted.split('\n').length - 1;
    }

    const evidenceReceipt = repositoryEvidenceReceipt({
      tool: 'repo_read', path: result.path, revision: result.sha || result.branch,
      startLine: effectiveStartLine, endLine: effectiveEndLine, content: extracted,
    });
    return {
      content: JSON.stringify({
        ok: true,
        path: result.path,
        branch: result.branch,
        sha: result.sha,
        content: extracted,
        totalLines,
        totalChars,
        startLine: startLineArg,
        endLine: effectiveEndLine,
        truncated: isTruncated,
      }),
      artifacts,
      evidenceReceipts: [evidenceReceipt],
    };
  }

  if (input.name === 'web_search') {
    const query = typeof args.query === 'string' ? args.query : '';
    const depthRaw = typeof args.depth === 'string' ? args.depth.trim() : 'standard';
    const depth =
      depthRaw === 'lite' ? 'lite' : depthRaw === 'deep' ? 'deep' : 'standard';
    const result = await webSearch(query, {
      signal: input.signal,
      depth,
      organizationId: input.organizationId,
    });
    const fromPages = imageHitsToArtifacts(result.pageImages ?? []);
    const hits = (result.hits ?? []).slice(0, 10).map((hit) => ({
      title: hit.title?.slice(0, 200),
      url: hit.url?.slice(0, 500),
      snippet: hit.snippet?.slice(0, 1000),
    }));
    return {
      content: JSON.stringify({
        ok: true,
        query: result.query,
        hits,
      }),
      artifacts: fromPages,
    };
  }

  if (input.name === 'image_search') {
    const query = typeof args.query === 'string' ? args.query : '';
    const result = await imageSearch(query, {
      signal: input.signal,
      organizationId: input.organizationId,
    });
    const hits = (result.hits ?? []).slice(0, 10).map((h) => ({
      title: h.title?.slice(0, 200),
      imageUrl: h.imageUrl?.slice(0, 1000),
      contextUrl: h.contextUrl?.slice(0, 1000),
    }));
    return {
      content: JSON.stringify({
        ok: true,
        query: result.query,
        hits,
      }),
      artifacts: imageHitsToArtifacts(result.hits),
    };
  }

  if (input.name === 'web_fetch') {
    const url = typeof args.url === 'string' ? args.url : '';
    const result = await webFetch(url, { signal: input.signal });
    const routing = chooseBrowseTool({
      intent: 'browse',
      url: result.url,
      priorFetchThin: result.thin,
      priorEscalateHint: result.escalateHint,
      browserWorkerAvailable: isBrowserWorkerConfigured(),
    });
    return {
      content: JSON.stringify({
        ...result,
        suggestedNextTool: routing.tool,
        suggestReason: routing.reason,
      }).slice(0, 12000),
      artifacts,
    };
  }

  if (input.name === 'browser_navigate') {
    const url = typeof args.url === 'string' ? args.url : '';
    const result = await browserNavigate(url, { signal: input.signal });
    return { content: JSON.stringify(result).slice(0, 12000), artifacts };
  }

  if (input.name === 'image_generate') {
    const prompt = typeof args.prompt === 'string' ? args.prompt : '';
    if (!prompt.trim()) throw new Error('image_generate requires a prompt.');
    try {
      const image = await generateImage(input.gateway, { prompt, signal: input.signal });
      const name = `AI image ${new Date().toISOString().slice(0, 19)}`;
      let url: string;
      if (image.b64) {
        url = `data:image/png;base64,${image.b64.slice(0, 6_000_000)}`;
      } else if (image.url) {
        url = image.url;
      } else {
        throw new Error('Image host returned no usable payload.');
      }
      const asset = await Asset.create({
        name,
        type: 'screenshot',
        url,
        description: prompt.slice(0, 500),
        tags: ['ai-generated'],
        linkedProjectId: input.projectId,
        userId: new Types.ObjectId(input.userId),
      });
      artifacts.push({
        kind: 'image',
        assetId: String(asset._id),
        name,
        url: `/api/assets/${String(asset._id)}/content`,
      });
      return {
        content: JSON.stringify({
          ok: true,
          assetId: String(asset._id),
          prompt: prompt.slice(0, 500),
          note: 'Image generated and stored as a project asset. Describe it; do not invent extra images.',
        }),
        artifacts,
      };
    } catch (error) {
      if (error instanceof GatewayError) {
        return {
          content: JSON.stringify({
            ok: false,
            error: `Image generation failed (${error.code}). This host may not support /images/generations.`,
          }),
          artifacts,
        };
      }
      throw error;
    }
  }

  return {
    content: JSON.stringify({ error: `Unknown tool: ${input.name}` }),
    artifacts,
  };
}
