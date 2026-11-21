import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import Asset from '@/lib/models/Asset';
import Recording from '@/lib/models/Recording';
export async function GET(request: NextRequest) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    // The owner's own captures only. Do not broaden this to all organization assets.
    const [images, videos] = await Promise.all([
        Asset.find({ userId: viewer.userId, type: 'screenshot' }).select('name fileUrl createdAt').sort({ createdAt: -1 }).limit(25).lean(),
        Recording.find({ userId: viewer.userId, organizationId: viewer.organizationId, status: 'complete' }).select('title videoUrl createdAt').sort({ createdAt: -1 }).limit(25).lean(),
    ]);
    const captures = [...images.filter(a => a.fileUrl).map(a => ({ id: String(a._id), name: a.name, url: `/api/assets/${a._id}/content`, createdAt: a.createdAt, kind: 'Screenshot' })), ...videos.map(a => ({ id: String(a._id), name: a.title, url: a.videoUrl, createdAt: a.createdAt, kind: 'Recording' }))]
        .filter(c => typeof c.url === 'string' && /^(https:\/\/|\/uploads\/|\/api\/assets\/)/.test(c.url)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 30);
    return NextResponse.json({ captures }, { headers: { 'Cache-Control': 'no-store' } });
}
