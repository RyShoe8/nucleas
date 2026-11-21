import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { workAssets } from '@/lib/work/resources';
export async function GET(request: NextRequest) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    try {
        const ids = request.nextUrl.searchParams.get('ids');
        const assets = await workAssets(viewer, request.nextUrl.searchParams.get('companyId') ?? '', ids ? ids.split(',') : null);
        return NextResponse.json({ assets: assets.map(a => ({ id: String(a._id), name: a.name, type: a.type })) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
