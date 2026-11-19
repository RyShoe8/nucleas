import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';

export async function POST(req: NextRequest) {
    try {
        const session = await requireAuth(req);
        if (session instanceof NextResponse) {
            return session;
        }

        const { url } = await req.json();

        if (!url || typeof url !== 'string') {
            return new NextResponse('Missing or invalid URL', { status: 400 });
        }

        // Validate URL
        let targetUrl: URL;
        try {
            targetUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
        } catch {
            return new NextResponse('Invalid URL format', { status: 400 });
        }
        if (!['http:', 'https:'].includes(targetUrl.protocol)) {
            return new NextResponse('Only web pages can be captured', { status: 400 });
        }

        // Call Microlink API to capture a full-page screenshot
        const microlinkApiUrl = `https://api.microlink.io/?url=${encodeURIComponent(
            targetUrl.toString()
        )}&screenshot=true&meta=false&fullPage=true`;

        const mlRes = await fetch(microlinkApiUrl, { signal: AbortSignal.timeout(60_000) });
        
        if (!mlRes.ok) {
            console.error('Microlink error status:', mlRes.status);
            return new NextResponse('Failed to capture screenshot from URL', { status: 500 });
        }

        const data = await mlRes.json();

        if (data.status !== 'success' || !data.data?.screenshot?.url) {
            console.error('Microlink returned unexpected data', { status: data?.status });
            return new NextResponse('Failed to generate screenshot image', { status: 500 });
        }

        // Only download the image from Microlink itself over HTTPS, never another address it might return.
        let imageUrl: URL;
        try {
            imageUrl = new URL(String(data.data.screenshot.url));
        } catch {
            return new NextResponse('Failed to retrieve captured image', { status: 502 });
        }
        if (imageUrl.protocol !== 'https:' || !(imageUrl.hostname === 'microlink.io' || imageUrl.hostname.endsWith('.microlink.io'))) {
            return new NextResponse('Failed to retrieve captured image', { status: 502 });
        }
        const imageRes = await fetch(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
        
        if (!imageRes.ok) {
            console.error('Failed to download image from microlink url:', imageRes.status);
            return new NextResponse('Failed to retrieve captured image', { status: 500 });
        }

        const contentType = imageRes.headers.get('content-type') || 'image/png';
        if (!contentType.startsWith('image/')) {
            return new NextResponse('Failed to retrieve captured image', { status: 502 });
        }
        const arrayBuffer = await imageRes.arrayBuffer();
        if (arrayBuffer.byteLength > 25 * 1024 * 1024) {
            return new NextResponse('Captured image is too large', { status: 502 });
        }

        return new NextResponse(arrayBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
            },
        });

    } catch (error) {
        console.error('Error capturing URL screenshot:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
