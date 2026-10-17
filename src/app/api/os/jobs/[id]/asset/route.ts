import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getJob } from '@/lib/jobs/jobs';
import { fetchPublic } from '@/lib/publishing/fetchPublic';

export const dynamic = 'force-dynamic';

/**
 * Downloads an image attached to one of this job's ready-to-post cards, so a person can upload it to a
 * platform by hand. Only addresses already on the job's cards are served: this is not an open proxy.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const job = await getJob(viewer, (await params).id);
  const url = request.nextUrl.searchParams.get('url') ?? '';
  const known = job?.publishing && [...job.publishing.ready, ...job.publishing.recent].some((d) => d.assets.some((a) => a.kind === 'image' && a.url === url));
  if (!known) return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  try {
    const image = await fetchPublic(url, { accept: 'image/*', maxBytes: 25_000_000 });
    if (!image.contentType.startsWith('image/') || image.contentType.includes('svg')) return NextResponse.json({ error: 'That is not an image.' }, { status: 415 });
    const name = (new URL(image.url).pathname.split('/').pop() || 'image').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100);
    return new NextResponse(image.bytes as BodyInit, {
      headers: { 'content-type': image.contentType, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The image could not be downloaded.' }, { status: 502 });
  }
}
