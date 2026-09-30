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
import { toolCallsFromText } from '@nucleas/ai-contracts';

export { toolCallsFromText };

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
  /**
   * How this model takes tools. native: the provider's tools parameter. prompted: Nucleas describes
   * the tools in the prompt and reads <tool_call> blocks back, for hosts whose chat template drops
   * tools (measured by the free model checks).
   */
  toolMode?: 'native' | 'prompted';
  /**
   * Ask the host for a server-sent-events stream and assemble it locally. Bytes keep arriving, so a
   * reverse proxy's read timeout (nginx's default is 60s) doesn't cut off a slow reasoning model, and
   * `timeoutMs` becomes an idle timeout (no bytes for that long) with a hard cap of STREAM_MAX_MS.
   */
  stream?: boolean;
};

/** Hard cap on one streamed call, however steadily it produces bytes. */
export const STREAM_MAX_MS = 200_000;

type ToolMessage = ModelToolRequest['messages'][number];

/**
 * Messages for prompted tool mode: the tool list goes into the system prompt, earlier tool calls
 * become <tool_call> text and tool results become user turns, and consecutive same-role turns are
 * merged (some chat templates require user/assistant to alternate).
 */
export function promptedToolMessages(messages: ToolMessage[], tools: ModelToolRequest['tools']): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const guide = [
    'You can call tools. To call one, reply with only this block (one block per call):',
    '<tool_call>',
    '{"name": "tool_name", "arguments": {"argument": "value"}}',
    '</tool_call>',
    'Tool results come back in <tool_response> blocks. Use them, call more tools if needed, and when you have what you need answer normally with no <tool_call> block. Never invent tool results.',
    '',
    'Tools:',
    ...tools.map((t) => `- ${t.function.name}: ${t.function.description}\n  arguments (JSON Schema): ${JSON.stringify(t.function.parameters)}`),
  ].join('\n');
  const names = new Map<string, string>();
  const converted: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      for (const call of m.tool_calls ?? []) names.set(call.id, call.function.name);
      const calls = (m.tool_calls ?? []).map((c) => `<tool_call>\n${JSON.stringify({ name: c.function.name, arguments: safeJson(c.function.arguments) })}\n</tool_call>`);
      converted.push({ role: 'assistant', content: [m.content ?? '', ...calls].filter(Boolean).join('\n') });
    } else if (m.role === 'tool') {
      const name = (m.tool_call_id && names.get(m.tool_call_id)) || 'tool';
      converted.push({ role: 'user', content: `<tool_response name="${name}">\n${m.content ?? ''}\n</tool_response>` });
    } else {
      converted.push({ role: m.role, content: m.content ?? '' });
    }
  }
  const systemIndex = converted.findIndex((m) => m.role === 'system');
  if (systemIndex >= 0) converted[systemIndex] = { role: 'system', content: `${converted[systemIndex].content}\n\n${guide}` };
  else converted.unshift({ role: 'system', content: guide });
  const merged: typeof converted = [];
  for (const m of converted) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role && m.role !== 'system') last.content = `${last.content}\n\n${m.content}`;
    else merged.push({ ...m });
  }
  return merged;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return text;
  }
}

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

/** Raw event bytes we will read from one stream. Each token is a ~250-byte JSON event, so this is far above the text limit. */
const STREAM_MAX_RAW_BYTES = 16 * 1024 * 1024;

/**
 * Reads an OpenAI-compatible chat-completions event stream and returns the same object a non-streaming
 * call would have, so the normal response parsing applies unchanged. `maxTextChars` bounds the assembled
 * answer (content + reasoning + tool arguments), not the event framing around it.
 */
export async function readStreamedCompletion(response: Response, maxTextChars: number, onActivity: () => void = () => {}): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new GatewayError('invalid_response');
  const decoder = new TextDecoder();
  let pending = '';
  let size = 0;
  let model: string | undefined;
  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let usage: unknown;
  const calls: { id?: string; name: string; args: string }[] = [];

  const handle = (payload: string): boolean => {
    if (payload === '[DONE]') return true;
    let event: {
      model?: string; usage?: unknown; error?: unknown;
      choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
    };
    try { event = JSON.parse(payload); } catch { return false; }
    if (event.error) throw new GatewayError('unavailable', { kind: 'stream_error' });
    if (typeof event.model === 'string') model = event.model;
    if (event.usage) usage = event.usage;
    for (const choice of event.choices?.slice(0, 1) ?? []) {
      const delta = choice.delta;
      if (delta?.content) content += delta.content;
      const thought = delta?.reasoning_content ?? delta?.reasoning;
      if (thought) reasoning += thought;
      if (content.length + reasoning.length > maxTextChars) throw new GatewayError('invalid_response', { kind: 'too_large' });
      for (const part of delta?.tool_calls ?? []) {
        const index = part.index ?? 0;
        const call = (calls[index] ??= { name: '', args: '' });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name += part.function.name;
        if (part.function?.arguments) call.args += part.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    return false;
  };

  try {
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      size += value.byteLength;
      if (size > STREAM_MAX_RAW_BYTES) {
        await reader.cancel();
        throw new GatewayError('invalid_response', { kind: 'too_large' });
      }
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while (!finished && (newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        if (line.startsWith('data:')) finished = handle(line.slice(5).trim());
      }
    }
    if (!finished && pending.startsWith('data:')) handle(pending.slice(5).trim());
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return {
    ...(model ? { model } : {}),
    choices: [{
      message: {
        content: content || null,
        reasoning_content: reasoning || null,
        ...(calls.length ? { tool_calls: calls.filter(Boolean).map((c) => ({ ...(c.id ? { id: c.id } : {}), type: 'function', function: { name: c.name, arguments: c.args } })) } : {}),
      },
      finish_reason: finishReason,
    }],
    ...(usage ? { usage } : {}),
  };
}

/** Provider tool_calls; extra fields (index, etc.) are dropped and object arguments are re-serialized. */
function parseToolCalls(raw: unknown[] | undefined): ToolCall[] {
  if (!raw?.length) return [];
  const calls: ToolCall[] = [];
  raw.slice(0, 8).forEach((item, i) => {
    const call = item as { id?: unknown; function?: { name?: unknown; arguments?: unknown } } | null;
    const args = call?.function?.arguments;
    const parsed = toolCallSchema.safeParse({
      id: typeof call?.id === 'string' && call.id ? call.id : `call_${i}`,
      type: 'function',
      function: { name: call?.function?.name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) },
    });
    if (parsed.success) calls.push(parsed.data);
  });
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

/** OpenAI-compatible response_format (vLLM turns json_schema into guided decoding). */
export function responseFormatBody(format: ModelRequest['responseFormat']): Record<string, unknown> {
  if (!format) return {};
  if (format.type === 'json_object') return { response_format: { type: 'json_object' } };
  return { response_format: { type: 'json_schema', json_schema: { name: format.name, schema: format.schema, strict: true } } };
}

/**
 * Cancels the request after `idleMs` without activity (streaming) or a fixed `idleMs` (otherwise).
 * Streams also get a hard cap so a model that trickles forever still ends.
 */
function callTimer(config: GatewayConfiguration, cancel: () => void): { touch: () => void; clear: () => void } {
  const idleMs = config.timeoutMs ?? 60000;
  let idle = setTimeout(cancel, idleMs);
  const hard = config.stream ? setTimeout(cancel, STREAM_MAX_MS) : undefined;
  return {
    touch: () => { if (config.stream) { clearTimeout(idle); idle = setTimeout(cancel, idleMs); } },
    clear: () => { clearTimeout(idle); if (hard) clearTimeout(hard); },
  };
}

/** Body fields for the response mode; streaming also asks for token usage in the final event. */
function streamBody(config: GatewayConfiguration): Record<string, unknown> {
  return config.stream ? { stream: true, stream_options: { include_usage: true } } : { stream: false };
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
  const timer = callTimer(config, cancel);
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
        ...responseFormatBody(input.responseFormat),
        ...streamBody(config),
      }),
    });
    if (!response.ok) {
      throw await httpGatewayError(response, config.bearerToken);
    }
    const parsed = responseSchema.parse(config.stream ? await readStreamedCompletion(response, 512000, timer.touch) : await readBoundedJson(response, 512000));
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
    throw new GatewayError('unavailable', { kind: controller.signal.aborted ? 'timeout' : 'transport' });
  } finally {
    timer.clear();
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
  const timer = callTimer(config, cancel);
  const started = Date.now();
  try {
    const response = await (options.fetcher ?? fetch)(endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bearerToken}` },
      body: JSON.stringify(
        config.toolMode === 'prompted'
          ? {
              model: config.model,
              messages: promptedToolMessages(input.messages, input.tools),
              ...completionLimitBody(config.model, input.maxOutputTokens),
              ...streamBody(config),
            }
          : {
              model: config.model,
              messages: input.messages,
              ...completionLimitBody(config.model, input.maxOutputTokens),
              ...toolCallReasoningBody(config.model),
              tools: input.tools,
              ...streamBody(config),
            }
      ),
    });
    if (!response.ok) {
      throw await httpGatewayError(response, config.bearerToken);
    }
    const parsed = responseSchema.parse(config.stream ? await readStreamedCompletion(response, 512000, timer.touch) : await readBoundedJson(response, 512000));
    const choice = parsed.choices[0]!;
    let toolCalls = parseToolCalls(choice.message.tool_calls);
    let visible = visibleAssistantText(choice.message);
    // Hosts without a tool-call parser return the model's call as text; read it back for offered tools only.
    if (!toolCalls.length && visible.text) {
      const fromText = toolCallsFromText(visible.text, input.tools.map((t) => t.function.name));
      if (fromText.calls.length) {
        toolCalls = fromText.calls;
        visible = { ...visible, text: fromText.rest };
      }
    }
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
    throw new GatewayError('unavailable', { kind: controller.signal.aborted ? 'timeout' : 'transport' });
  } finally {
    timer.clear();
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
