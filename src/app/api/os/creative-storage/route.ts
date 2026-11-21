import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { openCreativeStorage, CREATIVE_BUCKET, CREATIVE_PREFIX, CREATIVE_ENDPOINT, CREATIVE_MAX_BYTES } from '@/lib/storage/roglyCreative';
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
  const client = await openCreativeStorage(viewer.organizationId);
  let configured = false, error = '';
  if (!client) error = 'The existing PlayBound connection is unavailable for this organization.';
  else try { configured = Boolean((await client.request('status')).configured); if (!configured) error = 'Game storage is not available on PlayBound.'; }
  catch { error = 'The creative-storage bridge is not available yet. Deploy the PlayBound bridge and Nucleas changes together.'; }
  finally { client?.destroy(); }
  return NextResponse.json({ configured, error, endpoint: CREATIVE_ENDPOINT, bucket: CREATIVE_BUCKET, prefix: CREATIVE_PREFIX, maxBytes: CREATIVE_MAX_BYTES },{headers:{'Cache-Control':'private, no-store'}});
}
