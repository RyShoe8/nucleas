import 'server-only';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { executionWorkerResponseSchema } from '@nucleas/ai-contracts';
import { assertSafePublicHttpsUrl } from '@/lib/ai/tools/ssrf';
import { createInstallationAccessToken } from '@/lib/ai/githubAppClient';
import { AiProjectRepository } from '@/lib/models/AiProjectRepository';
import { AiIdeExecutionArtifact } from '@/lib/models/AiIdeExecutionArtifact';
import { readPlatformSettings } from '@/lib/ai/control/settings';

let indexes: Promise<unknown> | undefined;

export function executionWorkerConfigured(): boolean {
  return Boolean(process.env.NUCLEAS_EXECUTION_WORKER_URL?.trim() && process.env.NUCLEAS_EXECUTION_WORKER_TOKEN?.trim());
}

let featureCache: { at: number; features: string[] } | null = null;

/** Features the build service advertises on /health (cached for a minute). Older services advertise none. */
export async function executionWorkerFeatures(): Promise<string[]> {
  if (!executionWorkerConfigured()) return [];
  if (featureCache && Date.now() - featureCache.at < 60_000) return featureCache.features;
  try {
    const url = assertSafePublicHttpsUrl(`${process.env.NUCLEAS_EXECUTION_WORKER_URL!.replace(/\/+$/, '')}/health`);
    const res = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const body = (await res.json().catch(() => ({}))) as { features?: unknown };
    const features = Array.isArray(body.features) ? body.features.filter((f): f is string => typeof f === 'string') : [];
    featureCache = { at: Date.now(), features };
    return features;
  } catch {
    return [];
  }
}

export async function executeInRemoteSandbox(input: {
  organizationId: string; projectId: Types.ObjectId; userId: string; task: string; signal?: AbortSignal;
  /** The model to build with (from the AI engine). Sent only when the build service supports it. */
  inference?: { endpoint: string; bearerToken: string; model: string };
}) {
  if (!executionWorkerConfigured()) return null;
  const repository = await AiProjectRepository.findOne({ organizationId: input.organizationId, projectId: input.projectId })
    .select('owner repo defaultBranch installationId').maxTimeMS(3000).lean();
  if (!repository?.installationId) throw new Error('Connect the GitHub App to this project before running sandbox execution.');
  const accessToken = await createInstallationAccessToken(repository.installationId);
  const { value: aiSettings } = await readPlatformSettings();
  const inference = input.inference && (await executionWorkerFeatures()).includes('inference') ? input.inference : undefined;
  const endpoint = assertSafePublicHttpsUrl(`${process.env.NUCLEAS_EXECUTION_WORKER_URL!.replace(/\/+$/, '')}/v1/execute`);
  const requestId = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Execution worker deadline exceeded.')), 240_000);
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${process.env.NUCLEAS_EXECUTION_WORKER_TOKEN!.trim()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, requestId, repository: { owner: repository.owner, repo: repository.repo, ref: repository.defaultBranch, accessToken }, task: input.task.slice(0, 12_000), ...(inference ? { inference } : { model: aiSettings.codingModel }), maxRounds: 24, commandTimeoutMs: 120_000 }),
    });
    if (!response.ok) throw new Error(`Execution worker returned HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 1_500_000) throw new Error('Execution worker response exceeds the limit.');
    const responseBytes = await response.arrayBuffer();
    if (responseBytes.byteLength > 1_500_000) throw new Error('Execution worker response exceeds the limit.');
    const result = executionWorkerResponseSchema.parse(JSON.parse(Buffer.from(responseBytes).toString('utf8')));
    if (result.requestId !== requestId) throw new Error('Execution worker response did not match this request.');
    indexes ??= AiIdeExecutionArtifact.createIndexes().catch((error) => { indexes = undefined; throw error; });
    await indexes;
    const [artifact] = await AiIdeExecutionArtifact.create([{
      organizationId: input.organizationId, projectId: input.projectId, createdByUserId: new Types.ObjectId(input.userId),
      requestId, status: result.status, summary: result.summary, baseCommit: result.baseCommit,
      requestedModel: result.routing.requestedModel, providerReportedModels: result.routing.providerReportedModels,
      patch: Buffer.from(result.patch, 'utf8'), changedFiles: result.changedFiles, evidence: result.evidence,
      limitations: result.limitations, expiresAt: new Date(Date.now() + 30 * 86400000),
    }]);
    return { ...result, artifactId: String(artifact._id), usedEngineModel: Boolean(inference) };
  } finally {
    clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
  }
}
