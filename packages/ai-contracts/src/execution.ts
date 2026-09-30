import { z } from 'zod';

const githubName = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);
const gitRef = z.string().min(1).max(200).regex(/^[A-Za-z0-9._/-]+$/);

export const executionWorkerRequestSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: z.string().uuid(),
  repository: z.object({
    owner: githubName,
    repo: githubName,
    ref: gitRef,
    accessToken: z.string().min(1).max(4096),
  }).strict(),
  task: z.string().trim().min(1).max(12_000),
  model: z.string().trim().min(1).max(200).optional(),
  /**
   * The model to build with, chosen by the Nucleas AI engine: an OpenAI-compatible chat-completions
   * endpoint, its credential and the model id. Omitted = the worker's own configured model.
   */
  inference: z.object({
    endpoint: z.string().url().max(2048).refine((u) => u.startsWith('https://'), 'Inference endpoint must use HTTPS.'),
    bearerToken: z.string().min(1).max(4096),
    model: z.string().trim().min(1).max(200),
  }).strict().optional(),
  maxRounds: z.number().int().min(1).max(40).default(24),
  commandTimeoutMs: z.number().int().min(1_000).max(300_000).default(120_000),
}).strict();

export const executionEvidenceSchema = z.object({
  command: z.array(z.string().max(500)).min(1).max(33),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  output: z.string().max(16_000),
  /** Set on checks the worker ran itself after the build (typecheck, lint), as opposed to commands the model chose. */
  kind: z.literal('definition_of_done').optional(),
}).strict();

export const executionWorkerResponseSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: z.string().uuid(),
  routing: z.object({
    requestedModel: z.string().trim().min(1).max(200),
    providerReportedModels: z.array(z.string().trim().min(1).max(200)).max(40),
  }).strict(),
  status: z.enum(['completed', 'blocked', 'failed']),
  summary: z.string().trim().min(1).max(4000),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  patch: z.string().max(1_048_576),
  changedFiles: z.array(z.string().min(1).max(500)).max(200),
  evidence: z.array(executionEvidenceSchema).max(30),
  limitations: z.array(z.string().min(1).max(1000)).max(20),
  /** Tokens the build used, summed over every model call (when the provider reports usage). */
  usage: z.object({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) }).strict().optional(),
}).strict();

/** What a worker advertises on /health; "inference" = it accepts request.inference; "definition_of_done" = it runs typecheck/lint itself and tags that evidence. */
export const EXECUTION_WORKER_FEATURES = ['inference', 'definition_of_done'] as const;

export type ExecutionWorkerRequest = z.infer<typeof executionWorkerRequestSchema>;
export type ExecutionWorkerResponse = z.infer<typeof executionWorkerResponseSchema>;
