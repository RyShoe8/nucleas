import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
/** Public installers and updater metadata, not the private application repository. */
export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
    const { asset } = await params;
    if (!/^(?:latest\.yml|Nucleas-Setup-\d+\.\d+\.\d+\.exe(?:\.blockmap)?)$/.test(asset)) return new NextResponse('Not found', { status: 404 });
    try {
        const pathname = `desktop/releases/windows/${asset}`;
        const result = await list({ prefix: pathname, limit: 5 });
        const blob = result.blobs.find(item => item.pathname === pathname);
        if (!blob) return new NextResponse('No desktop release published yet.', { status: 404 });
        return NextResponse.redirect(blob.url, { status: 307, headers: { 'Cache-Control': 'no-store' } });
    } catch { return new NextResponse('Desktop updates are temporarily unavailable.', { status: 503 }); }
}
