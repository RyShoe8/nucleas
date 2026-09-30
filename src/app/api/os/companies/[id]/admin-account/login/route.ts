import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { loginCancel, loginFinish, loginFrame, loginInput, loginStart } from '@/lib/companies/adminAccount';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

/**
 * The login window: a real browser runs on the server and is shown here as screenshots.
 * { action: 'start', baseUrl } → { handle }; then 'frame' | 'input' | 'finish' | 'cancel' with { handle }.
 * Only managers, and only the person who started the window, can use it.
 */
export async function POST(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const id = (await params).id;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; baseUrl?: unknown; handle?: unknown; input?: unknown };
  const fail = (result: { error: string; status: number }) => NextResponse.json({ error: result.error }, { status: result.status });

  if (body.action === 'start') {
    if (typeof body.baseUrl !== 'string') return NextResponse.json({ error: 'baseUrl is required.' }, { status: 400 });
    const started = await loginStart(viewer, id, body.baseUrl);
    return started.ok ? NextResponse.json({ handle: started.handle, width: started.width, height: started.height, baseUrl: started.baseUrl }) : fail(started);
  }
  if (typeof body.handle !== 'string') return NextResponse.json({ error: 'handle is required.' }, { status: 400 });
  if (body.action === 'frame') {
    const frame = await loginFrame(viewer, id, body.handle);
    return frame.ok ? NextResponse.json({ image: frame.image, url: frame.url, title: frame.title }, { headers: { 'Cache-Control': 'no-store' } }) : fail(frame);
  }
  if (body.action === 'input') {
    const result = await loginInput(viewer, id, body.handle, body.input);
    return result.ok ? NextResponse.json({ ok: true }) : fail(result);
  }
  if (body.action === 'finish') {
    const result = await loginFinish(viewer, id, body.handle);
    return result.ok ? NextResponse.json({ ok: true }) : fail(result);
  }
  if (body.action === 'cancel') {
    await loginCancel(viewer, id, body.handle);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
