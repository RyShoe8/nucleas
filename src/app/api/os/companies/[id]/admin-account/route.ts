import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { checkAdminAccount, clearAdminAccount, getAdminAccount, saveSessionPaste } from '@/lib/companies/adminAccount';

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

/** Save a session pasted from a logged-in browser: { baseUrl, session } (a Playwright storageState or a cookie export). */
export async function PUT(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { baseUrl?: unknown; session?: unknown };
  if (typeof body.baseUrl !== 'string' || body.session === undefined) return NextResponse.json({ error: 'baseUrl and session are required.' }, { status: 400 });
  let session = body.session;
  if (typeof session === 'string') {
    try {
      session = JSON.parse(session);
    } catch {
      return NextResponse.json({ error: 'That is not valid JSON. Paste the cookie export exactly as the browser produced it.' }, { status: 400 });
    }
  }
  const result = await saveSessionPaste(viewer, (await params).id, { baseUrl: body.baseUrl, session });
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
