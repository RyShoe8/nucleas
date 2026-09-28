import 'server-only';
import type { GatewayConfiguration } from '@nucleas/ai-core/gateway';
import { GatewayError, invokeModel, invokeModelWithTools } from '@nucleas/ai-core/gateway';
import type { ToolCall, ToolDefinition } from '@nucleas/ai-contracts';
import { Types } from 'mongoose';
import { AiRunEvent } from '@/lib/models/AiControl';
import { executeIdeTool, type ToolArtifact } from '@/lib/ai/tools/executeTool';
import { ideChatToolDefinitions, type IdeToolProfile } from '@/lib/ai/tools/definitions';
import { dedupeEvidenceReceipts, type RepositoryEvidenceReceipt } from '@/lib/ai/evidenceReceipts';

const DEFAULT_MAX_ROUNDS = 6;
/** Without a model-specific budget, the historical prompt size. */
const DEFAULT_CONTEXT_CHARS = 48_000;
/** One tool result (e.g. a whole file) kept up to this size. */
const MAX_TOOL_RESULT_CHARS = 60_000;
/** Circuit breaker only — deep digs continue until the model stops calling tools or this fires. */
const DEEP_REPO_MAX_ROUNDS = 32;

export type ToolLoopResult = {
  content: string;
  toolCallsMade: string[];
  artifacts: ToolArtifact[];
  evidenceReceipts?: RepositoryEvidenceReceipt[];
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

type LoopMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

/**
 * Additional tools supplied by the caller (e.g. company capabilities). They are authorized and
 * scoped by the caller; the loop only offers them to the model and routes calls to execute().
 */
export interface ExtraToolSet {
  definitions: ToolDefinition[];
  execute: (name: string, argumentsJson: string, context: { runId: Types.ObjectId }) => Promise<string>;
}

export async function runIdeToolLoop(input: {
  extraTools?: ExtraToolSet;
  gateway: GatewayConfiguration;
  messages: LoopMessage[];
  maxOutputTokens: number;
  includeImageTool: boolean;
  includeRepoTools?: boolean;
  toolProfile?: IdeToolProfile;
  /** Cap concurrent tool-loop iterations (batching), not total analysis ambition. */
  maxRounds?: number;
  /** Prompt characters this model can take (its context window, minus room for the answer). */
  contextChars?: number;
  /** Called before each tool runs (for live progress). */
  onToolCall?: (name: string, argumentsJson: string) => void;
  organizationId: string;
  projectId: Types.ObjectId;
  userId: string;
  runId: Types.ObjectId;
  signal?: AbortSignal;
}): Promise<ToolLoopResult> {
  const extraNames = new Set((input.extraTools?.definitions ?? []).map((t) => t.function.name));
  const tools: ToolDefinition[] = [
    ...ideChatToolDefinitions({
      includeImage: input.includeImageTool,
      includeRepo: input.includeRepoTools !== false,
      profile: input.toolProfile ?? 'full',
    }).filter((t) => !extraNames.has(t.function.name)),
    ...(input.extraTools?.definitions ?? []),
  ];
  if (!tools.length) {
    throw new GatewayError('invalid_response', { kind: 'no_tools' });
  }
  const allowedToolNames = new Set(tools.map((tool) => tool.function.name));
  const maxRounds = Math.min(
    Math.max(input.maxRounds ?? DEFAULT_MAX_ROUNDS, 1),
    DEEP_REPO_MAX_ROUNDS
  );
  // Tell the model its budget so it stops exploring in time to answer.
  const budgetNote = `You can use tools for at most ${maxRounds} rounds. Gather only what you need, then give your final answer.`;
  const messages: LoopMessage[] = input.messages.map((m) =>
    m.role === 'system' ? { ...m, content: `${m.content ?? ''}\n\n${budgetNote}` } : m
  );
  const initialSystemMessage =
    messages.find((m) => m.role === 'system') ?? {
      role: 'system' as const,
      content: `You are an AI assistant. ${budgetNote}`,
    };
  const initialTaskMessage =
    [...input.messages].reverse().find((m) => m.role === 'user') ??
    input.messages[input.messages.length - 1];
  const artifacts: ToolArtifact[] = [];
  const evidenceReceipts: RepositoryEvidenceReceipt[] = [];
  const toolCallsMade: string[] = [];
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let latencyMs = 0;
  let sequence = 100;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      if (input.signal?.aborted) throw new GatewayError('cancelled');
      if (maxRounds >= 6 && round === maxRounds - 3) {
        messages.push({ role: 'user', content: 'Only 3 tool rounds remain. Finish gathering evidence and write your final answer.' });
      }

      // Keep everything the model has seen until its context window is nearly full; then clear
      // the oldest tool results first (they can be fetched again from the local repository copy).
      fitToContext(messages, input.contextChars ?? DEFAULT_CONTEXT_CHARS);

      const result = await invokeModelWithTools(
        input.gateway,
        {
          role: 'architect',
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content ?? null,
            ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
            ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
          })),
          maxOutputTokens: input.maxOutputTokens,
          tools,
        },
        { signal: input.signal }
      );
      latencyMs += result.latencyMs;
      if (result.inputTokens != null) inputTokens = (inputTokens ?? 0) + result.inputTokens;
      if (result.outputTokens != null) outputTokens = (outputTokens ?? 0) + result.outputTokens;

      if (!result.toolCalls.length) {
        return {
          content: result.content.trim().slice(0, 16000),
          toolCallsMade,
          artifacts,
          evidenceReceipts: dedupeEvidenceReceipts(evidenceReceipts),
          inputTokens,
          outputTokens,
          latencyMs,
        };
      }

      messages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        toolCallsMade.push(call.function.name);
        input.onToolCall?.(call.function.name, call.function.arguments);
        sequence += 1;

        // F07: Verify server-side tool profile authorization before dispatch
        if (!allowedToolNames.has(call.function.name)) {
          await AiRunEvent.create({
            organizationId: input.organizationId,
            projectId: input.projectId,
            runId: input.runId,
            sequence,
            type: 'tool.rejected',
            summary: `Tool ${call.function.name} unauthorized for profile`.slice(0, 2000),
          }).catch(() => undefined);

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: `Tool "${call.function.name}" is not permitted for the active tool profile.`,
            }),
          });
          continue;
        }

        await AiRunEvent.create({
          organizationId: input.organizationId,
          projectId: input.projectId,
          runId: input.runId,
          sequence,
          type: 'tool.requested',
          summary: `Tool ${call.function.name}`.slice(0, 2000),
        }).catch(() => undefined);

        let toolContent: string;
        if (extraNames.has(call.function.name) && input.extraTools) {
          try {
            toolContent = await input.extraTools.execute(call.function.name, call.function.arguments, { runId: input.runId });
            sequence += 1;
            await AiRunEvent.create({
              organizationId: input.organizationId,
              projectId: input.projectId,
              runId: input.runId,
              sequence,
              type: 'tool.completed',
              summary: `Tool ${call.function.name} completed`.slice(0, 2000),
            }).catch(() => undefined);
          } catch (error) {
            toolContent = JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 500) : 'Tool failed.' });
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent.slice(0, MAX_TOOL_RESULT_CHARS) });
          continue;
        }
        try {
          const executed = await executeIdeTool({
            name: call.function.name,
            argumentsJson: call.function.arguments,
            gateway: input.gateway,
            organizationId: input.organizationId,
            projectId: input.projectId,
            userId: input.userId,
            allowedTools: allowedToolNames,
            signal: input.signal,
          });
          artifacts.push(...executed.artifacts);
          evidenceReceipts.push(...(executed.evidenceReceipts ?? []));
          toolContent = executed.content;
          sequence += 1;
          await AiRunEvent.create({
            organizationId: input.organizationId,
            projectId: input.projectId,
            runId: input.runId,
            sequence,
            type: 'tool.completed',
            summary: `Tool ${call.function.name} completed`.slice(0, 2000),
          }).catch(() => undefined);
        } catch (error) {
          toolContent = JSON.stringify({
            error: error instanceof Error ? error.message.slice(0, 500) : 'Tool failed.',
          });
          sequence += 1;
          await AiRunEvent.create({
            organizationId: input.organizationId,
            projectId: input.projectId,
            runId: input.runId,
            sequence,
            type: 'tool.failed',
            summary: `Tool ${call.function.name} failed`.slice(0, 2000),
          }).catch(() => undefined);
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolContent.slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }
    }

    // Out of tool rounds: one last call without tools writes the answer from what was gathered,
    // instead of discarding the whole investigation.
    const final = await invokeModel(
      input.gateway,
      { role: 'architect', messages: finalAnswerMessages(initialSystemMessage.content ?? '', initialTaskMessage?.content ?? '', messages, input.contextChars ?? DEFAULT_CONTEXT_CHARS), maxOutputTokens: input.maxOutputTokens },
      { signal: input.signal }
    );
    latencyMs += final.latencyMs;
    if (final.inputTokens != null) inputTokens = (inputTokens ?? 0) + final.inputTokens;
    if (final.outputTokens != null) outputTokens = (outputTokens ?? 0) + final.outputTokens;
    return { content: final.content.trim().slice(0, 16000), toolCallsMade, artifacts, evidenceReceipts: dedupeEvidenceReceipts(evidenceReceipts), inputTokens, outputTokens, latencyMs };
  } catch (err) {
    if (err && typeof err === 'object') {
      (err as { usage?: { inputTokens: number | null; outputTokens: number | null; latencyMs: number } }).usage = {
        inputTokens,
        outputTokens,
        latencyMs,
      };
    }
    throw err;
  }
}

/**
 * The tool-free closing request: the original instructions and task plus the most recent tool
 * results, sized to the model's context budget.
 */
export function finalAnswerMessages(system: string, task: string, transcript: LoopMessage[], budgetChars = DEFAULT_CONTEXT_CHARS): { role: 'system' | 'user'; content: string }[] {
  const evidence: string[] = [];
  let used = 0;
  const evidenceBudget = Math.max(12_000, Math.floor(budgetChars * 0.8) - Math.min(system.length, 10_000) - Math.min(task.length, 8000));
  for (const m of [...transcript].reverse()) {
    if (m.role !== 'tool' || !m.content) continue;
    const piece = m.content.slice(0, MAX_TOOL_RESULT_CHARS);
    if (used + piece.length > evidenceBudget) break;
    evidence.unshift(piece);
    used += piece.length;
  }
  return [
    { role: 'system', content: system.slice(0, 10_000) },
    {
      role: 'user',
      content: [
        task.slice(0, 8000),
        '',
        '# Evidence you gathered with tools (most recent)',
        evidence.join('\n---\n') || '(none)',
        '',
        'Your tool budget is used up. Do not ask for more tools. Write your final answer now from this evidence, and say what you could not verify.',
      ].join('\n'),
    },
  ];
}

function contentChars(messages: LoopMessage[]): number {
  return messages.reduce((n, m) => n + (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
}

/**
 * Brings the conversation under the model's budget without losing its structure: the oldest tool
 * results are replaced by a note naming the call (so the model can repeat it), keeping the task,
 * the model's own reasoning and the most recent results intact. Mutates messages in place.
 */
export function fitToContext(messages: LoopMessage[], budgetChars: number): void {
  const target = Math.floor(budgetChars * 0.85);
  if (contentChars(messages) <= target) return;
  const callNames = new Map<string, string>();
  for (const m of messages) for (const c of m.tool_calls ?? []) callNames.set(c.id, `${c.function.name}(${c.function.arguments.slice(0, 200)})`);
  // Never clear the last few messages: the model is working with them right now.
  const protectedFrom = Math.max(0, messages.length - 6);
  for (let i = 0; i < protectedFrom && contentChars(messages) > target; i += 1) {
    const m = messages[i];
    if (m.role !== 'tool' || !m.content || m.content.length < 400) continue;
    const call = m.tool_call_id ? callNames.get(m.tool_call_id) : undefined;
    messages[i] = {
      ...m,
      content: `[Result of ${call ?? 'an earlier tool call'} cleared to fit the context window. Call it again if you still need it; repository reads come from the local copy instantly.]`,
    };
  }
  // Still over (very long reasoning or a small window): trim the longest remaining non-task messages.
  for (let guard = 0; contentChars(messages) > target && guard < 50; guard += 1) {
    let longest = -1;
    for (let i = 2; i < protectedFrom; i += 1) if (longest === -1 || (messages[i].content?.length ?? 0) > (messages[longest].content?.length ?? 0)) longest = i;
    if (longest === -1 || (messages[longest].content?.length ?? 0) < 1000) break;
    const m = messages[longest];
    messages[longest] = { ...m, content: `${m.content!.slice(0, Math.floor(m.content!.length / 2))}
[…shortened to fit the context window]` };
  }
}
