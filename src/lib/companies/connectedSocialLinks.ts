import { Types } from 'mongoose';
import { IntegrationConnection } from '@/lib/models/Integration';
import { readConnectionCredential } from '@/lib/integrations/connections';
import { FACEBOOK_GRAPH } from '@/lib/integrations/facebook/facebookOAuth';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface SocialLink { network: string; url: string }

export const blueskyProfileUrl = (accountLabel: string | undefined): string | null => {
  const handle = accountLabel?.replace(/^@/, '').trim();
  return handle && /^[A-Za-z0-9._:-]{3,253}$/.test(handle) ? `https://bsky.app/profile/${handle}` : null;
};

/** The Page's public link, read once through its own token. */
export async function facebookPageLink(token: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const res = await fetchImpl(`${FACEBOOK_GRAPH}/me?fields=link`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(8_000), redirect: 'error' });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { link?: string } | null;
  try {
    const url = new URL(body?.link ?? '');
    return /^(?:www\.|m\.)?facebook\.com$/i.test(url.hostname) && url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Pure: listed links first; a connected account fills in any network that has no listed link. */
export function mergeSocialLinks(listed: SocialLink[], connected: SocialLink[]): SocialLink[] {
  const have = new Set(listed.map((l) => l.network));
  return [...listed, ...connected.filter((l) => !have.has(l.network))];
}

/**
 * Social links implied by the company's connected accounts (Bluesky from the handle, Facebook from the Page),
 * so a connected account shows up as a button even when nobody typed its link into the company profile.
 * A Facebook Page link is looked up once and remembered on the connection.
 */
export async function connectedSocialLinks(organizationId: Types.ObjectId, companyId: string, fetchImpl: FetchLike = fetch): Promise<SocialLink[]> {
  const rows = await IntegrationConnection.find({ organizationId, companyId: new Types.ObjectId(companyId), provider: { $in: ['bluesky', 'facebook'] }, status: 'connected' })
    .select('provider accountLabel accountUrl')
    .lean<{ _id: Types.ObjectId; provider: string; accountLabel?: string; accountUrl?: string }[]>();
  const links: SocialLink[] = [];
  for (const row of rows) {
    if (row.provider === 'bluesky') {
      const url = blueskyProfileUrl(row.accountLabel);
      if (url) links.push({ network: 'bluesky', url });
    } else if (row.accountUrl) {
      links.push({ network: 'facebook', url: row.accountUrl });
    } else {
      try {
        const token = await readConnectionCredential(organizationId, row._id);
        const url = token ? await facebookPageLink(token, fetchImpl) : null;
        if (url) {
          await IntegrationConnection.updateOne({ _id: row._id }, { $set: { accountUrl: url } });
          links.push({ network: 'facebook', url });
        }
      } catch {
        // The button simply stays off until the Page can be read.
      }
    }
  }
  return links;
}
