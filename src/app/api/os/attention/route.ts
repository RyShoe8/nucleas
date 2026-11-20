import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { attentionFor } from '@/lib/attention/service';
import { AttentionPreference } from '@/lib/models/AttentionPreference';
import { DIGEST_MINUTES } from '@/lib/attention/types';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
  const [items, preference] = await Promise.all([attentionFor(viewer), AttentionPreference.findOne({ organizationId: viewer.organizationId, userId: viewer.userId }).lean()]);
  return NextResponse.json({ userId: viewer.userId, items, intervalMinutes: preference?.intervalMinutes ?? 0 }, { headers });
}
export async function PUT(request: NextRequest) {
  const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
  const body = await request.json().catch(() => null);
  if (!DIGEST_MINUTES.includes(body?.intervalMinutes)) return NextResponse.json({ error: 'Choose one of the available email intervals.' }, { status: 400 });
  const minutes = body.intervalMinutes as number;
  await AttentionPreference.updateOne({ organizationId: viewer.organizationId, userId: viewer.userId }, { $set: { intervalMinutes: minutes, nextDigestAt: minutes ? new Date(Date.now() + minutes * 60_000) : null } }, { upsert: true, runValidators: true });
  return NextResponse.json({ ok: true, intervalMinutes: minutes }, { headers });
}
