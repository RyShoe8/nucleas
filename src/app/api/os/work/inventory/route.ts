import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { readWorkInventory } from '@/lib/work/inventory';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
    try { return NextResponse.json(await readWorkInventory(viewer, companyId), { headers: { 'Cache-Control': 'no-store' } }); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 409 }); }
}
