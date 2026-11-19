import { NextRequest, NextResponse } from 'next/server';
import { addConnection, listAddableProviders } from '@/lib/integrations/connections';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { Types } from 'mongoose';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { siteKey } from '@/lib/companies/productionDomain';
import { IntegrationConnection } from '@/lib/models/Integration';
import { refetchSiteHistory } from '@/lib/metrics/siteHistory';

/** Integrations that can still be added to this company. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const providers = await listAddableProviders(viewer, id);
  if (!providers) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  return NextResponse.json({ providers });
}

/** Add an integration to this company as not-yet-connected. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { provider?: unknown } | null;
  const result = await addConnection(viewer, id, typeof body?.provider === 'string' ? body.provider : '');
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/**
 * Which of the company's websites an account belongs to: { provider, sites }. For sources that cannot tell
 * sites apart (payments, email); an empty list means the whole company. An email list may serve several.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only Managers and Administrators can change this.' }, { status: 403 });
  const { id } = await params;
  const profile = await getCompanyProfile(viewer, id);
  if (!profile) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { provider?: unknown; sites?: unknown } | null;
  if (typeof body?.provider !== 'string' || !Array.isArray(body.sites)) return NextResponse.json({ error: 'Send a provider and a list of websites.' }, { status: 400 });
  const sites = [...new Set(body.sites.map((site) => siteKey(typeof site === 'string' ? site : '')).filter(Boolean))];
  const unknown = sites.filter((site) => !profile.websites.includes(site));
  if (unknown.length) return NextResponse.json({ error: `Not one of this company's websites: ${unknown.join(', ')}` }, { status: 400 });
  const updated = await IntegrationConnection.updateOne(
    { organizationId: viewer.organizationId, companyId: new Types.ObjectId(id), provider: body.provider },
    sites.length ? { $set: { sites } } : { $unset: { sites: '' } },
  );
  if (!updated.matchedCount) return NextResponse.json({ error: 'That account is not connected to this company.' }, { status: 404 });
  if (updated.modifiedCount) await refetchSiteHistory(viewer.organizationId, id);
  return NextResponse.json({ ok: true, sites });
}
