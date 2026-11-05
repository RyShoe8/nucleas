import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { DesktopConnection } from '@/lib/integrations/desktopConnection';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    const flow = request.nextUrl.searchParams.get('flow') ?? '';
    if (!/^[a-f0-9]{32}$/.test(flow)) return NextResponse.json({ error: 'Invalid flow' }, { status: 400 });
    const result = await DesktopConnection.findOne({ flow, userId: viewer.userId, expiresAt: { $gt: new Date() } });
    return NextResponse.json(result ? { complete: true, companyId: result.companyId, error: result.error, message: result.message } : { complete: false }, { headers: { 'Cache-Control': 'no-store' } });
}
