import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { updatePost } from '@/lib/watches/posts';
import { SOCIAL_PLATFORM_IDS, type SocialPlatformId } from '@/lib/watches/socialPlatforms';

export const dynamic = 'force-dynamic';

/** Edit one platform's copy or archive a post. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { platform?: unknown; copy?: unknown; status?: unknown } | null;
  const platform = SOCIAL_PLATFORM_IDS.find((p) => p === body?.platform) as SocialPlatformId | undefined;
  const result = await updatePost(viewer, id, {
    platform,
    copy: typeof body?.copy === 'string' ? body.copy.slice(0, 5000) : undefined,
    status: body?.status === 'archived' ? 'archived' : body?.status === 'draft' ? 'draft' : undefined,
  });
  return result.ok ? NextResponse.json({ post: result.data }) : NextResponse.json({ error: result.error }, { status: result.status });
}
