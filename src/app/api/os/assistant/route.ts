import { NextRequest, NextResponse } from 'next/server';
import { askAssistant, listAssistantTurns } from '@/lib/ai/company/companyAssistant';
import { isCostLevel } from '@/lib/ai/engine/select';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { enforceRateLimit, rateLimitKey } from '@/lib/security/rateLimit';
import { parseAttachmentRefs } from '@/lib/ai/attachments/uploads';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const HEARTBEAT_MS = 15_000;
const LAST_RESORT_MS = 285_000;

/** The viewer's private Nucleas assistant thread. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  return NextResponse.json({ turns: await listAssistantTurns(viewer) });
}

/**
 * The message shown when the assistant fails unexpectedly: generic for everyone, with what actually
 * failed added for administrators so it can be fixed without digging through server logs.
 */
function failureMessage(error: unknown, viewer: { role?: string }): string {
  const generic = 'The assistant could not answer. Try again.';
  if (viewer.role !== 'Administrator') return generic;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `${generic} (Administrator detail: ${detail.replace(/\s+/g, ' ').slice(0, 300)})`;
}

/** Ask Nucleas about any company the viewer can access. Optional focus; budgets and approvals apply. */
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit({ key: rateLimitKey(request, 'os-assistant'), limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; focusCompanyId?: unknown; mode?: unknown; level?: unknown; modelProfileId?: unknown; model?: unknown; attachments?: unknown };
  const attachments = parseAttachmentRefs(body.attachments, viewer.userId);
  if (!Array.isArray(attachments)) return NextResponse.json({ error: attachments.error }, { status: 400 });
  const input = {
    text: typeof body.text === 'string' ? body.text : '',
    focusCompanyId: typeof body.focusCompanyId === 'string' ? body.focusCompanyId : undefined,
    mode: (body.mode === 'direct' ? 'direct' : 'orchestrated') as 'direct' | 'orchestrated',
    level: isCostLevel(body.level) ? body.level : undefined,
    modelProfileId: typeof body.modelProfileId === 'string' ? body.modelProfileId : '',
    model: typeof body.model === 'string' ? body.model : '',
    attachments,
    signal: request.signal,
  };

  // Streaming: progress lines while it works, then the reply (NDJSON, one event per line).
  if ((request.headers.get('accept') ?? '').includes('application/x-ndjson')) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // The browser went away; keep working so the answer is still saved.
          }
        };
        let last = '';
        let finished = false;
        // Keep bytes flowing so idle proxies do not cut the connection during a long model call.
        const heartbeat = setInterval(() => send({ type: 'ping' }), HEARTBEAT_MS);
        // The hosting platform kills the function silently at maxDuration; say so before that happens.
        const lastResort = setTimeout(() => {
          if (finished) return;
          finished = true;
          send({ type: 'error', status: 504, error: 'This took longer than Nucleas is allowed to run, so it was stopped before finishing. Try again, or use a faster cost level.' });
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        }, LAST_RESORT_MS);
        try {
          const result = await askAssistant(viewer, {
            ...input,
            onProgress: (text) => {
              if (text && text !== last) send({ type: 'progress', text: (last = text).slice(0, 300), at: new Date().toISOString() });
            },
          });
          if (!finished) {
            if (!result.ok) send({ type: 'error', status: result.status, error: result.error });
            else send({ type: 'reply', ...result.reply });
          }
        } catch (error) {
          console.error('[os/assistant] failed', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
          if (!finished) send({ type: 'error', status: 500, error: failureMessage(error, viewer) });
        } finally {
          finished = true;
          clearInterval(heartbeat);
          clearTimeout(lastResort);
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  }

  try {
    const result = await askAssistant(viewer, input);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.reply);
  } catch (error) {
    console.error('[os/assistant] failed', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
    return NextResponse.json({ error: failureMessage(error, viewer) }, { status: 500 });
  }
}
