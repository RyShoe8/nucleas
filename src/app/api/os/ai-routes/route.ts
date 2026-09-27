import { NextRequest, NextResponse } from 'next/server';
import User from '@/lib/models/User';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { assignRoute, clearRoute, resolveAllRoutes } from '@/lib/ai/routing/resolveRoute';

export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const user = await User.findById(viewer.userId).select('isAdmin').lean<{ isAdmin?: boolean }>();
  if (viewer.role !== 'Administrator' && !user?.isAdmin) {
    return NextResponse.json({ error: 'Only administrators can change AI routing.' }, { status: 403 });
  }
  return viewer;
}

/** Every route with its resolved model and where that choice comes from. */
export async function GET(request: NextRequest) {
  const viewer = await requireAdmin(request);
  if (viewer instanceof NextResponse) return viewer;
  return NextResponse.json({ routes: await resolveAllRoutes(String(viewer.organizationId)) }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Assign a model (and optional consented paid fallback) to a route. */
export async function PUT(request: NextRequest) {
  const viewer = await requireAdmin(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const result = await assignRoute(
    String(viewer.organizationId),
    str(body.route),
    {
      profileId: str(body.profileId),
      model: str(body.model),
      fallbackProfileId: str(body.fallbackProfileId) || null,
      fallbackModel: str(body.fallbackModel) || null,
      allowPaidFallback: body.allowPaidFallback === true,
    },
    viewer.userId
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Remove an assignment so the route inherits again. */
export async function DELETE(request: NextRequest) {
  const viewer = await requireAdmin(request);
  if (viewer instanceof NextResponse) return viewer;
  const route = request.nextUrl.searchParams.get('route') ?? '';
  await clearRoute(String(viewer.organizationId), route);
  return NextResponse.json({ ok: true });
}
