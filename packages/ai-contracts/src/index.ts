import { z } from 'zod';
export * from './execution';

export const PROTOCOL_VERSION = 1 as const;
export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i);
const criteriaSchema = z.array(z.string().trim().min(1).max(1000)).min(1).max(20);

export const objectiveInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  outcome: z.string().trim().min(1).max(6000),
  constraints: z.string().trim().max(6000).default(''),
  acceptanceCriteria: criteriaSchema,
}).strict();

export const planTaskSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(6000).default(''),
  acceptanceCriteria: criteriaSchema,
  dependsOn: z.array(z.string().max(50)).max(20).default([]),
}).strict();

export const planDraftSchema = z.object({
  summary: z.string().trim().min(1).max(6000),
  tasks: z.array(planTaskSchema).min(1).max(20),
}).strict().superRefine(({ tasks }, ctx) => {
  const keys = new Set(tasks.map(task => task.key));
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (keys.size !== tasks.length) fail('Task keys must be unique.');
  const graph = new Map(tasks.map(task => [task.key, task.dependsOn]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return false;
    if (visited.has(key)) return true;
    visiting.add(key);
    for (const dependency of graph.get(key) ?? []) {
      if (!keys.has(dependency) || !visit(dependency)) return false;
    }
    visiting.delete(key);
    visited.add(key);
    return true;
  };
  for (const task of tasks) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) fail('Duplicate dependency.');
    if (!visit(task.key)) { fail('Dependencies must exist and form an acyclic graph.'); break; }
  }
});

export type ObjectiveInput = z.infer<typeof objectiveInputSchema>;
export type PlanDraft = z.infer<typeof planDraftSchema>;
export const runStateSchema = z.enum([
  'queued', 'running', 'waiting_for_approval', 'review_required', 'reviewing',
  'revision_required', 'awaiting_acceptance', 'completed', 'blocked', 'failed',
  'cancellation_requested', 'cancelled',
]);
export type RunState = z.infer<typeof runStateSchema>;
/** Outer bounds only; each call is sized to its model's context window (see contextBudgetChars). */
export const MAX_MESSAGE_CHARS = 1_200_000;
export const MAX_REQUEST_CHARS = 1_500_000;

export const modelRequestSchema = z.object({
  role: z.enum(['architect', 'worker', 'reviewer']),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(MAX_MESSAGE_CHARS),
  }).strict()).min(1).max(400),
  maxOutputTokens: z.number().int().min(1).max(32768),
  /** Constrain the reply to JSON: a schema (guided decoding where the host supports it) or any object. */
  responseFormat: z.union([
    z.object({ type: z.literal('json_schema'), name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), schema: z.record(z.string(), z.unknown()) }).strict(),
    z.object({ type: z.literal('json_object') }).strict(),
  ]).optional(),
}).strict().superRefine((value, ctx) => {
  // Callers size prompts to each model's context window; this is only an outer safety bound.
  if (value.messages.reduce((size, message) => size + message.content.length, 0) > MAX_REQUEST_CHARS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Context exceeds the request limit.' });
  }
});
export type ModelRequest = z.infer<typeof modelRequestSchema>;
export type ModelResult = {
  content: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  finishReason: string | null;
};

export const toolCallSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.literal('function'),
    function: z
      .object({
        name: z.string().min(1).max(64),
        arguments: z.string().max(16000),
      })
      .strict(),
  })
  .strict();

export const toolDefinitionSchema = z
  .object({
    type: z.literal('function'),
    function: z
      .object({
        name: z.string().min(1).max(64),
        description: z.string().max(1000),
        parameters: z.record(z.unknown()),
      })
      .strict(),
  })
  .strict();

/** Messages for tool-capable chat completions (OpenAI-compatible). */
export const toolCapableMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string().max(MAX_MESSAGE_CHARS).nullable().optional(),
    tool_calls: z.array(toolCallSchema).max(8).optional(),
    tool_call_id: z.string().min(1).max(128).optional(),
  })
  .strict();

export const modelToolRequestSchema = z
  .object({
    role: z.enum(['architect', 'worker', 'reviewer']),
    messages: z.array(toolCapableMessageSchema).min(1).max(400),
    maxOutputTokens: z.number().int().min(1).max(32768),
    tools: z.array(toolDefinitionSchema).min(1).max(32),
  })
  .strict();

export type ModelToolRequest = z.infer<typeof modelToolRequestSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

export type ModelToolResult = ModelResult & {
  toolCalls: ToolCall[];
};

// Text-only remote jobs remain inference-only; tool loops run in-process on Nucleas.
export const remoteJobSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  jobId: objectIdSchema,
  runId: objectIdSchema,
  organizationId: z.string().min(1).max(100),
  projectId: objectIdSchema,
  leaseToken: z.string().min(32).max(200),
  leaseExpiresAt: z.string().datetime(),
  kind: z.literal('inference'),
  request: modelRequestSchema,
}).strict();
