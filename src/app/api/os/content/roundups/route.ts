import { after, NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { actionSchema, generateRoundup, listRoundups, mutateRoundup, RoundupError } from '@/lib/roundups/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
function failure(error: unknown) {
  console.error('[release-roundup] request failed', error instanceof Error ? error.message : 'Unknown request failure');
  return NextResponse.json({ error: error instanceof RoundupError ? error.message : 'Roundup request failed. Retry or check server configuration.' }, { status: error instanceof RoundupError ? error.status : 500 });
}
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  try { return NextResponse.json(await listRoundups(viewer, request.nextUrl.searchParams.get('companyId') ?? ''), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid roundup action.' }, { status: 400 });
  try {
    const result = await mutateRoundup(viewer, parsed.data);
    if ('run' in result && result.run) {
      const id = result.run;
      after(async () => { await generateRoundup(viewer, parsed.data.companyId, id); });
    }
    const response = 'settings' in result ? { settings: result.settings } : { draft: result.draft };
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
