import type { ParsedIntent } from '@/lib/voice/IntentParser';
import type { WorkspaceIntentContextPayload } from '@/lib/voice/workspaceIntentContext';
import { rescueCreateTaskIntent, voiceLlmIntentToParsedIntent } from '@/lib/voice/llmIntentAdapter';
import { enrichIntentWithContext } from '@/lib/voice/enrichIntentWithContext';
import { parseOsVoiceIntent } from './osVoiceIntent';

export type ParseIntentWithContextResult =
  | { ok: true; intent: ParsedIntent | null; source: 'llm' | 'rules'; llmRaw?: unknown }
  | { ok: false; status: number; error: string };

function contextForApi(ctx: WorkspaceIntentContextPayload | undefined): Record<string, unknown> | undefined {
  if (!ctx) return undefined;
  const { projects: _omit, ...rest } = ctx;
  void _omit;
  return rest as unknown as Record<string, unknown>;
}

export async function parseIntentWithContext(
  input: string,
  workspaceContext?: WorkspaceIntentContextPayload | null
): Promise<ParseIntentWithContextResult> {
  if (workspaceContext?.view.lens === 'os') return { ok: true, intent: parseOsVoiceIntent(input, workspaceContext), source: 'rules' };
  try {
    const apiContext = contextForApi(workspaceContext ?? undefined);

    const res = await fetch('/api/parse-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input,
        ...(apiContext && Object.keys(apiContext).length > 0 ? { context: apiContext } : {}),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 503) {
      return { ok: false, status: 503, error: (data as { error?: string }).error || 'LLM not configured' };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (data as { error?: string }).error || 'parse-intent failed',
      };
    }

    const intentObj = (data as { intent?: unknown }).intent;
    let parsed = voiceLlmIntentToParsedIntent(intentObj, input);
    if (!parsed) {
      parsed = rescueCreateTaskIntent(intentObj, input);
    }
    parsed = enrichIntentWithContext(parsed, workspaceContext ?? undefined);

    return { ok: true, intent: parsed, source: 'llm', llmRaw: intentObj };
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
}
