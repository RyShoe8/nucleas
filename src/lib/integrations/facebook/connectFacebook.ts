import { Types } from 'mongoose';
import { IntegrationConnection } from '@/lib/models/Integration';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';
import { connectWithApiKey } from '@/lib/integrations/connections';
import { exchangeFacebookPages, pickFacebookPage } from '@/lib/integrations/facebook/facebookPages';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Finishes Facebook sign-in for one company: picks its Page and stores the Page token like a pasted one (verified first). */
export async function completeFacebookConnection(
  viewer: CompanyViewer,
  input: { code: string; redirectUri: string; companyId: string },
  fetchImpl: FetchLike = fetch
): Promise<{ ok: true; pageName: string } | { ok: false; error: string }> {
  if (!isCompanyManager(viewer)) return { ok: false, error: 'Only managers can connect integrations.' };
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!appId || !appSecret) return { ok: false, error: 'Facebook sign-in is not configured.' };

  const profile = await getCompanyProfile(viewer, input.companyId);
  if (!profile) return { ok: false, error: 'Company not found.' };
  const connection = await IntegrationConnection.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(input.companyId), provider: 'facebook' })
    .select('_id')
    .lean<{ _id: Types.ObjectId }>();
  if (!connection) return { ok: false, error: 'Add Facebook Pages to this company first.' };

  const exchanged = await exchangeFacebookPages({ code: input.code, redirectUri: input.redirectUri, appId, appSecret }, fetchImpl);
  if (!exchanged.ok) return exchanged;
  const picked = pickFacebookPage(exchanged.pages, profile.name);
  if (!picked.ok) return picked;

  const result = await connectWithApiKey(viewer, String(connection._id), picked.page.token);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, pageName: picked.page.name };
}
