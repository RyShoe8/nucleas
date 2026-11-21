import type { ParsedIntent } from '@/lib/voice/IntentParser';
import type { WorkspaceIntentContextPayload } from '@/lib/voice/workspaceIntentContext';
import { parseIntentWithContext } from '@/lib/voice/parseIntentApi';

export type FetchVoiceIntentResult =
  | { ok: true; intent: ParsedIntent | null; source: 'llm' | 'rules' | 'none'; llmRaw?: unknown }
  | { ok: false; status: number; error: string };

export async function fetchLlmVoiceIntent(
  transcript: string,
  workspaceContext?: WorkspaceIntentContextPayload | null
): Promise<FetchVoiceIntentResult> {
  const llm = await parseIntentWithContext(transcript, workspaceContext);
  if (!llm.ok) {
    return { ok: false, status: llm.status, error: llm.error };
  }
  return { ok: true, intent: llm.intent, source: llm.source, llmRaw: llm.llmRaw };
}
