import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { workAssets } from '@/lib/work/resources';
export async function GET(request: NextRequest) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    try {
        const [asset] = await workAssets(viewer, request.nextUrl.searchParams.get('companyId') ?? '', [request.nextUrl.searchParams.get('id') ?? '']);
        const source = asset.fileUrl ?? asset.url ?? '';
        const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(source);
        if (match) {
            const mime = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/plain)$/.test(match[1]) ? match[1] : 'application/octet-stream';
            return new NextResponse(Buffer.from(match[2], 'base64'), { headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
        }
        if (/^https?:\/\//i.test(source)) return NextResponse.redirect(source);
        if (asset.textContent) return new NextResponse(asset.textContent, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } });
        return NextResponse.json({ error: 'No downloadable file is available.' }, { status: 404 });
    } catch { return NextResponse.json({ error: 'Reference file not found.' }, { status: 404 }); }
}
