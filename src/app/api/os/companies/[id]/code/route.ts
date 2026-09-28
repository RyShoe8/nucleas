import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { clearProjectRepository, getCompanyCode, setProjectRepository } from '@/lib/building/companyCode';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

/** The company's projects and the GitHub repository each builds from. */
export async function GET(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const code = await getCompanyCode(viewer, (await params).id);
  if (!code) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json(code, { headers: { 'Cache-Control': 'no-store' } });
}

/** Connect a project to a repository the GitHub App can reach: { projectId, fullName: "owner/repo" }. */
export async function PUT(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { projectId?: unknown; fullName?: unknown };
  if (typeof body.projectId !== 'string' || typeof body.fullName !== 'string') {
    return NextResponse.json({ error: 'projectId and fullName are required.' }, { status: 400 });
  }
  const result = await setProjectRepository(viewer, (await params).id, { projectId: body.projectId, fullName: body.fullName });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}

/** Disconnect a project's repository: ?projectId=… */
export async function DELETE(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const projectId = request.nextUrl.searchParams.get('projectId') ?? '';
  const result = await clearProjectRepository(viewer, (await params).id, projectId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
