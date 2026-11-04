import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Stable download URL that follows the same published manifest as the native updater. */
export async function GET(request: Request) {
    try {
        const pathname = 'desktop/releases/windows/latest.yml';
        const { blobs } = await list({ prefix: pathname, limit: 5 });
        const manifest = blobs.find(blob => blob.pathname === pathname);
        if (!manifest) return new NextResponse('The Windows installer is not published yet. Please try again after the desktop release finishes.', { status: 404 });
        const response = await fetch(manifest.url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('Manifest unavailable');
        const text = await response.text();
        const asset = /^path:\s*['"]?(Nucleas-Setup-\d+\.\d+\.\d+\.exe)['"]?\s*$/m.exec(text)?.[1];
        if (!asset) throw new Error('Invalid installer manifest');
        return NextResponse.redirect(new URL(`/desktop/releases/windows/${asset}`, request.url), { status: 307, headers: { 'Cache-Control': 'no-store' } });
    } catch {
        return new NextResponse('The Windows installer is temporarily unavailable. Please try again shortly.', { status: 503 });
    }
}
