import { NextRequest, NextResponse } from 'next/server';
import { buildNucleasOsManifest } from '@/lib/os/nucleasOsManifest';

function resolveOrigin(request: NextRequest): string {
    const host = request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
    if (host) {
        return `${proto}://${host}`;
    }

    const fromRequest = request.nextUrl.origin;
    if (fromRequest && fromRequest !== 'null') {
        return fromRequest;
    }

    const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (envUrl) {
        try {
            const url = new URL(envUrl);
            if (url.host.startsWith('os.')) {
                return url.origin;
            }
        } catch {
            // ignore invalid env URL
        }
    }

    return 'https://nucleas.app';
}

export function GET(request: NextRequest) {
    const manifest = buildNucleasOsManifest(resolveOrigin(request));
    return NextResponse.json(manifest, {
        headers: {
            'Content-Type': 'application/manifest+json',
            'Cache-Control': 'public, max-age=0, must-revalidate',
        },
    });
}
