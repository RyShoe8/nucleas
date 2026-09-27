import { NextRequest, NextResponse } from 'next/server';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import {
  buildGoogleIntegrationAuthUrl,
  createGoogleIntegrationState,
  googleIntegrationRedirectUri,
} from '@/lib/integrations/google/googleOAuth';

/** Starts Google sign-in for Analytics + Search Console. Managers only. */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only managers can connect integrations.' }, { status: 403 });

  const companyId = request.nextUrl.searchParams.get('companyId') ?? '';
  if (!(await getCompanyProfile(viewer, companyId))) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = googleIntegrationRedirectUri(request.url);
  if (!clientId || !redirectUri) return NextResponse.json({ error: 'Google sign-in is not available on this host.' }, { status: 500 });

  const state = await createGoogleIntegrationState(viewer.userId, companyId);
  return NextResponse.redirect(buildGoogleIntegrationAuthUrl({ clientId, redirectUri, state }));
}
