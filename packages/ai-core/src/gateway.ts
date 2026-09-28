import {
  modelRequestSchema,
  modelToolRequestSchema,
  toolCallSchema,
  type ModelRequest,
  type ModelResult,
  type ModelToolRequest,
  type ModelToolResult,
  type ToolCall,
} from '@nucleas/ai-contracts';
import { z } from 'zod';

export type GatewayErrorDetails = {
  kind: string;
  httpStatus?: number;
  finishReason?: string | null;
  contentChars?: number;
  hasToolCalls?: boolean;
  hasReasoning?: boolean;
  /** The provider's own short error message (secrets stripped), e.g. "Insufficient credits". */
  providerMessage?: string;
};

export class GatewayError extends Error {
  readonly details?: GatewayErrorDetails;

  constructor(
    public readonly code:
      | 'configuration'
      | 'credentials'
      | 'rate_limit'
      | 'unavailable'
      | 'invalid_response'
      | 'cancelled',
    details?: GatewayErrorDetails
  ) {
    super(`Model gateway: ${code}`);
    this.details = details;
  }
}

export type GatewayConfiguration = {
  endpoint: string;
  bearerToken: string;
  model: string;
  protocol: 'openai-chat';
  timeoutMs?: number;
};

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().max(128000).nullable().optional(),
          reasoning_content: z.string().max(128000).nullable().optional(),
          tool_calls: z.array(z.unknown()).optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      })
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const imageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().max(8_000_000).optional(),
        url: z.string().url().max(4000).optional(),
      })
    )
    .min(1)
    .max(4),
});

export function validateGatewayConfiguration(config: GatewayConfiguration): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw new GatewayError('configuration');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !config.bearerToken.trim() ||
    /[\r\n]/.test(config.bearerToken) ||
    !config.model.trim() ||
    config.protocol !== 'openai-chat' ||
    (config.timeoutMs !== undefined &&
      (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 120000))
  ) {
    throw new GatewayError('configuration');
  }
  return endpoint;
}

/** Strip provider prefixes (e.g. openai/o4-mini → o4-mini). */
function modelIdBase(model: string): string {
  const slash = model.lastIndexOf('/');
  return (slash >= 0 ? model.slice(slash + 1) : model).trim().toLowerCase();
}

/**
 * o-series and GPT-5/6 reject `max_tokens` on Chat Completions; they require
 * `max_completion_tokens` (which also covers reasoning tokens).
 */
export function usesMaxCompletionTokens(model: string): boolean {
  const id = modelIdBase(model);
  return /^o[1-9]/.test(id) || /^gpt-[56]/.test(id);
}

/** Token-limit fields for an OpenAI-compatible chat completions body. */
export function completionLimitBody(
  model: string,
  maxOutputTokens: number
): { max_completion_tokens: number } | { max_tokens: number } {
  return usesMaxCompletionTokens(model)
    ? { max_completion_tokens: maxOutputTokens }
    : { max_tokens: maxOutputTokens };
}

/**
 * GPT-5/6 series defaults to reasoning; OpenAI /v1/chat/completions requires
 * `reasoning_effort: 'none'` when function tools are provided.
 */
export function toolCallReasoningBody(
  model: string
): { reasoning_effort: 'none' } | Record<string, never> {
  const id = modelIdBase(model);
  return /^gpt-[56]/.test(id) ? { reasoning_effort: 'none' } : {};
}

/** Derive OpenAI-compatible images generations URL from a chat-completions endpoint. */
export function imagesUrlFromChatEndpoint(endpoint: string): URL {
  const url = validateGatewayConfiguration({
    endpoint,
    bearerToken: 'x',
    model: 'x',
    protocol: 'openai-chat',
  });
  let path = url.pathname.replace(/\/+$/, '') || '';
  if (path.endsWith('/chat/completions')) {
    path = `${path.slice(0, -'/chat/completions'.length)}/images/generations`;
  } else if (path.endsWith('/completions')) {
    path = `${path.slice(0, -'/completions'.length)}/images/generations`;
  } else if (path.endsWith('/v1')) {
    path = `${path}/images/generations`;
  } else if (!path || path === '/') {
    path = '/v1/images/generations';
  } else {
    path = `${path}/images/generations`;
  }
  url.pathname = path;
  return url;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new GatewayError('invalid_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new GatewayError('invalid_response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GatewayError('invalid_response');
  }
}

function parseToolCalls(raw: unknown[] | undefined): ToolCall[] {
  if (!raw?.length) return [];
  const calls: ToolCall[] = [];
  for (const item of raw.slice(0, 8)) {
    const parsed = toolCallSchema.safeParse(item);
    if (parsed.success) calls.push(parsed.data);
  }
  return calls;
}

function parseOrInvalidResponse<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    throw new GatewayError('invalid_response', { kind: 'schema' });
  }
}

/** Strip common thinking wrappers; keep remaining visible text. */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** Prefer message content; fall back to reasoning_content for Qwen-style hosts. */
export function visibleAssistantText(message: {
  content?: string | null;
  reasoning_content?: string | null;
}): { text: string; hasReasoning: boolean } {
  const rawContent = message.content?.trim() ?? '';
  const rawReasoning = message.reasoning_content?.trim() ?? '';
  if (rawContent) {
    const stripped = stripThinkTags(rawContent);
    return { text: stripped || rawContent, hasReasoning: Boolean(rawReasoning) };
  }
  if (rawReasoning) {
    const stripped = stripThinkTags(rawReasoning);
    return { text: stripped || rawReasoning, hasReasoning: true };
  }
  return { text: '', hasReasoning: false };
}

/** Anything that looks like a key or token, so a provider message never echoes one back. */
const SECRETISH = /(sk|pk|rk|or|gsk|key|tok)[-_][A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,}/g;

export function sanitizeProviderMessage(raw: string, secrets: string[] = []): string | undefined {
  let text = raw.trim();
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown };
    const candidate = typeof body.error === 'object' && body.error ? body.error.message : body.error ?? body.message ?? body.detail;
    if (typeof candidate === 'string') text = candidate;
  } catch {
    // Not JSON: use the text as is.
  }
  for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join('[redacted]');
  const clean = text.replace(/<[^>]*>/g, ' ').replace(SECRETISH, '[redacted]').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 200) : undefined;
}

async function httpGatewayError(response: Response, bearerToken: string): Promise<GatewayError> {
  const status = response.status;
  const providerMessage = sanitizeProviderMessage(await response.text().then((t) => t.slice(0, 4000)).catch(() => ''), [bearerToken]);
  const details = { kind: 'http', httpStatus: status, ...(providerMessage ? { providerMessage } : {}) };
  if (status === 401 || status === 403) return new GatewayError('credentials', details);
  if (status === 429) return new GatewayError('rate_limit', details);
  return new GatewayError('unavailable', details);
}

/** Called only by a server-side, budget-authorized dispatcher; never directly by a browser route. */
export async function invokeModel(
  config: GatewayConfiguration,
  request: ModelRequest,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}
): Promise<ModelResult> {
  const endpoint = validateGatewayConfiguration(config);
  const input = parseOrInvalidResponse(() => modelRequestSchema.parse(request));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) throw new GatewayError('cancelled');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, config.timeoutMs ?? 60000);
  const started = Date.now();
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bearerToken}` },
      body: JSON.stringify({
        model: config.model,
        messages: input.messages,
        ...completionLimitBody(config.model, input.maxOutputTokens),
        stream: false,
      }),
    });
    if (!response.ok) {
      throw await httpGatewayError(response, config.bearerToken);
    }
    const parsed = responseSchema.parse(await readBoundedJson(response, 512000));
    const choice = parsed.choices[0]!;
    const visible = visibleAssistantText(choice.message);
    // Plain chat: accept truncated replies when there is visible text. Ignore unexpected
    // tool_calls when content exists (local hosts often emit them without a tools request).
    if (!visible.text) {
      throw new GatewayError('invalid_response', {
        kind: 'empty_content',
        finishReason: choice.finish_reason ?? null,
        contentChars: 0,
        hasToolCalls: Boolean(choice.message.tool_calls?.length),
        hasReasoning: visible.hasReasoning,
      });
    }
    return {
      content: visible.text,
      model: config.model,
      inputTokens: parsed.usage?.prompt_tokens ?? null,
      outputTokens: parsed.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
      finishReason: choice.finish_reason ?? null,
    };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (options.signal?.aborted) throw new GatewayError('cancelled', { kind: 'cancelled' });
    throw new GatewayError('unavailable', { kind: 'transport' });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}

/**
 * Tool-capable chat completions. Returns assistant text and/or tool_calls.
 * Callers must execute tools server-side; never trust model-claimed side effects alone.
 */
export async function invokeModelWithTools(
  config: GatewayConfiguration,
  request: ModelToolRequest,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}
): Promise<ModelToolResult> {
  const endpoint = validateGatewayConfiguration(config);
  const input = parseOrInvalidResponse(() => modelToolRequestSchema.parse(request));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) throw new GatewayError('cancelled', { kind: 'cancelled' });
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, config.timeoutMs ?? 60000);
  const started = Date.now();
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bearerToken}` },
      body: JSON.stringify({
        model: config.model,
        messages: input.messages,
        ...completionLimitBody(config.model, input.maxOutputTokens),
        ...toolCallReasoningBody(config.model),
        tools: input.tools,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw await httpGatewayError(response, config.bearerToken);
    }
    const parsed = responseSchema.parse(await readBoundedJson(response, 512000));
    const choice = parsed.choices[0]!;
    const toolCalls = parseToolCalls(choice.message.tool_calls);
    const visible = visibleAssistantText(choice.message);
    if (!toolCalls.length && !visible.text) {
      throw new GatewayError('invalid_response', {
        kind: 'empty_content',
        finishReason: choice.finish_reason ?? null,
        contentChars: 0,
        hasToolCalls: false,
        hasReasoning: visible.hasReasoning,
      });
    }
    // Accept truncated text-only replies (plain path already does); only empty+no-tools fails above.
    return {
      content: visible.text,
      toolCalls,
      model: config.model,
      inputTokens: parsed.usage?.prompt_tokens ?? null,
      outputTokens: parsed.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
      finishReason: choice.finish_reason ?? null,
    };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (options.signal?.aborted) throw new GatewayError('cancelled', { kind: 'cancelled' });
    throw new GatewayError('unavailable', { kind: 'transport' });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export type ImageGenerationResult = {
  mimeType: string;
  /** Raw base64 without data: prefix, when returned by the host. */
  b64: string | null;
  /** HTTPS image URL when the host returns a URL instead of b64. */
  url: string | null;
};

/** OpenAI-compatible image generation via company or local images endpoint. */
export async function generateImage(
  config: GatewayConfiguration,
  input: { prompt: string; size?: '1024x1024' | '512x512' | '256x256'; signal?: AbortSignal; fetcher?: typeof fetch }
): Promise<ImageGenerationResult> {
  validateGatewayConfiguration(config);
  const prompt = input.prompt.trim().slice(0, 4000);
  if (!prompt) throw new GatewayError('configuration');
  const endpoint = imagesUrlFromChatEndpoint(config.endpoint);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (input.signal?.aborted) throw new GatewayError('cancelled');
  input.signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, config.timeoutMs ?? 90000);
  try {
    const response = await (input.fetcher ?? fetch)(endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bearerToken}` },
      body: JSON.stringify({
        model: config.model,
        prompt,
        n: 1,
        size: input.size ?? '1024x1024',
        response_format: 'b64_json',
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new GatewayError('credentials');
      if (response.status === 429) throw new GatewayError('rate_limit');
      throw new GatewayError('unavailable');
    }
    const parsed = imageResponseSchema.parse(await readBoundedJson(response, 8_000_000));
    const first = parsed.data[0]!;
    if (first.b64_json?.trim()) {
      return { mimeType: 'image/png', b64: first.b64_json.trim(), url: null };
    }
    if (first.url?.startsWith('https:')) {
      return { mimeType: 'image/png', b64: null, url: first.url };
    }
    throw new GatewayError('invalid_response');
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (input.signal?.aborted) throw new GatewayError('cancelled');
    throw new GatewayError('unavailable');
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', cancel);
  }
}
