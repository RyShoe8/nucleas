import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { checkTestAccount, clearTestAccount, getTestAccount, setTestAccount } from '@/lib/companies/testAccount';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;
type Context = { params: Promise<{ id: string }> };

/** The company's test account (never its password): where it signs in, as whom, and whether it last worked. */
export async function GET(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const view = await getTestAccount(viewer, (await params).id);
  if (!view) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
}

/** Save the account: { baseUrl, username, password? }. Leave the password out to keep the saved one. */
export async function PUT(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { baseUrl?: unknown; username?: unknown; password?: unknown };
  if (typeof body.baseUrl !== 'string' || typeof body.username !== 'string') {
    return NextResponse.json({ error: 'baseUrl and username are required.' }, { status: 400 });
  }
  const result = await setTestAccount(viewer, (await params).id, {
    baseUrl: body.baseUrl,
    username: body.username,
    ...(typeof body.password === 'string' ? { password: body.password } : {}),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

/** Try the login: signs in and opens the admin area, recording the outcome. */
export async function POST(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const result = await checkTestAccount(viewer, (await params).id);
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const result = await clearTestAccount(viewer, (await params).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
