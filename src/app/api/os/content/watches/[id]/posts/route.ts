import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listPosts } from '@/lib/watches/posts';

export const dynamic = 'force-dynamic';

/** A watch's social post drafts (?status=archived for the archive). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const status = request.nextUrl.searchParams.get('status') === 'archived' ? 'archived' : 'draft';
  const result = await listPosts(viewer, id, status);
  return result.ok ? NextResponse.json({ posts: result.data }, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: result.error }, { status: result.status });
}
