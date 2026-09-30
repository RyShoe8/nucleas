import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { checkAdminAccount, clearAdminAccount, createCaptureCode, getAdminAccount, saveSessionPaste } from '@/lib/companies/adminAccount';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;
type Context = { params: Promise<{ id: string }> };

/** The company's admin account session (never the cookies): which site, when captured, when it expires, whether it last worked. */
export async function GET(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const view = await getAdminAccount(viewer, (await params).id);
  if (!view) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Connect a session. { baseUrl } alone returns a one-time code for the capture script (the person logs in on
 * their own machine); { baseUrl, session } saves a session pasted from a logged-in browser.
 */
export async function PUT(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { baseUrl?: unknown; session?: unknown };
  if (typeof body.baseUrl !== 'string') return NextResponse.json({ error: 'baseUrl is required.' }, { status: 400 });
  const id = (await params).id;
  if (body.session === undefined) {
    const made = await createCaptureCode(viewer, id, body.baseUrl);
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status });
    return NextResponse.json({ code: made.code, baseUrl: made.baseUrl, expiresAt: made.expiresAt });
  }
  let session = body.session;
  if (typeof session === 'string') {
    try {
      session = JSON.parse(session);
    } catch {
      return NextResponse.json({ error: 'That is not valid JSON. Paste the cookie export exactly as the browser or script produced it.' }, { status: 400 });
    }
  }
  const result = await saveSessionPaste(viewer, id, { baseUrl: body.baseUrl, session });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

/** Check the session: opens the admin area with it and records whether it is still signed in. */
export async function POST(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const result = await checkAdminAccount(viewer, (await params).id);
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const result = await clearAdminAccount(viewer, (await params).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
