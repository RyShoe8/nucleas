import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import Project from '@/lib/models/Project';
import Client, { type CompanyRelationship } from '@/lib/models/Client';

const RELATIONSHIP_NAME: Record<CompanyRelationship, string> = { client: 'Client', owned: 'Our business', internal: 'Operating company' };
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { listCompanyConnections } from '@/lib/integrations/connections';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { normalizeProductionDomain, sameSite } from '@/lib/companies/productionDomain';
import { normalizeSubreddit } from '@/lib/companies/subreddit';
import { recordActivity } from '@/lib/companies/activityLog';
import { refetchSiteHistory } from '@/lib/metrics/siteHistory';
import { CompanyAssistantTurn } from '@/lib/models/CompanyAssistantTurn';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { connectedSocialLinks, mergeSocialLinks } from '@/lib/companies/connectedSocialLinks';

/** Company overview: resolved profile, its projects and its integrations. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    const { id } = await params;

    const profile = await getCompanyProfile(viewer, id);
    if (!profile) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    const [projects, connections, citationSources, voice, connectedLinks] = await Promise.all([
      Project.aggregate<{ _id: Types.ObjectId; name: string; status: string; projectType: string; openTasks: number; totalTasks: number }>([
        { $match: { clientId: new Types.ObjectId(id) } },
        {
          $project: {
            name: 1,
            status: 1,
            projectType: 1,
            totalTasks: { $size: { $ifNull: ['$tasks', []] } },
            openTasks: {
              $size: {
                $filter: { input: { $ifNull: ['$tasks', []] }, as: 't', cond: { $ne: ['$$t.status', 'completed'] } },
              },
            },
          },
        },
        { $sort: { name: 1 } },
      ]),
      listCompanyConnections(viewer, id),
      CompanyAssistantTurn.aggregate<{ _id: string; firstSeen: Date }>([
        { $match: { organizationId: viewer.organizationId, companyIds: new Types.ObjectId(id), role: 'assistant', 'contextSources.0': { $exists: true } } },
        { $unwind: '$contextSources' },
        { $match: { contextSources: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$contextSources', firstSeen: { $min: '$createdAt' } } },
        { $sort: { firstSeen: 1 } },
      ]),
      BrandVoice.findOne({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(id) }).select('status persona').lean<{ status?: string; persona?: string }>(),
      connectedSocialLinks(viewer.organizationId, id).catch(() => []),
    ]);

    const citationSeries = Array.from({ length: 28 }, (_, index) => {
      const day = new Date();
      day.setUTCHours(23, 59, 59, 999);
      day.setUTCDate(day.getUTCDate() - (27 - index));
      return {
        date: day.toISOString().slice(0, 10),
        value: citationSources.filter((source) => new Date(source.firstSeen).getTime() <= day.getTime()).length,
      };
    });

    return NextResponse.json({
      canManage: isCompanyManager(viewer),
      company: { ...profile, socialLinks: mergeSocialLinks(profile.socialLinks ?? [], connectedLinks) },
      // Approved means a persona exists and was approved; anything else (none, draft) is not used by content tools.
      voiceStatus: voice?.status === 'approved' && voice.persona?.trim() ? 'approved' : voice?.persona?.trim() ? 'draft' : 'none',
      projects: projects.map((p) => ({
        id: String(p._id),
        name: p.name,
        status: p.status,
        isHub: String(p._id) === profile.hubProjectId,
        openTasks: p.openTasks,
        totalTasks: p.totalTasks,
      })),
      connections: connections ?? [],
      stats: { aiCitations: citationSources.length, aiCitationSeries: citationSeries },
    });
  } catch (error) {
    console.error('[os/companies/:id] failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Update company-level profile fields that are not sourced from the hub project. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only Managers and Administrators can update company settings.' }, { status: 403 });

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const has = (key: string) => Boolean(body) && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, key);
    if (!has('domain') && !has('subreddit') && !has('websites') && !has('relationship')) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }
    const fields = body as { domain?: unknown; subreddit?: unknown };
    const domain = has('domain') ? normalizeProductionDomain(fields.domain) : null;
    if (domain && !domain.ok) return NextResponse.json({ error: domain.error }, { status: 400 });
    const subreddit = has('subreddit') ? normalizeSubreddit(fields.subreddit) : null;
    // Other websites: each a plain domain, at most 20, without repeats.
    let websites: string[] | null = null;
    if (has('websites')) {
      const raw = (body as { websites?: unknown }).websites;
      if (!Array.isArray(raw) || raw.length > 20) return NextResponse.json({ error: 'Websites must be a list of up to 20 domains.' }, { status: 400 });
      const cleaned: string[] = [];
      for (const entry of raw) {
        const site = normalizeProductionDomain(entry);
        if (!site.ok) return NextResponse.json({ error: site.error }, { status: 400 });
        if (site.domain && !cleaned.includes(site.domain)) cleaned.push(site.domain);
      }
      websites = cleaned;
    }
    if (subreddit && !subreddit.ok) return NextResponse.json({ error: subreddit.error }, { status: 400 });
    // Client, our business, or the operating company: decides which list it sits in and where its profile comes from.
    let relationship: CompanyRelationship | null = null;
    if (has('relationship')) {
      const raw = (body as { relationship?: unknown }).relationship;
      if (raw !== 'client' && raw !== 'owned' && raw !== 'internal') return NextResponse.json({ error: 'Choose client, owned or internal.' }, { status: 400 });
      relationship = raw;
    }

    const company = await Client.findOne({ _id: id, organizationId: viewer.organizationId });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    const result: { domain?: string | null; subreddit?: string | null; websites?: string[]; relationship?: CompanyRelationship } = {};
    const activities: { title: string; detail?: string }[] = [];

    if (domain?.ok) {
      const previous = company.domain ?? null;
      company.domain = domain.domain ?? undefined;
      result.domain = domain.domain;
      if (previous !== domain.domain) {
        activities.push({ title: domain.domain ? 'Production domain set' : 'Production domain cleared', detail: domain.domain ?? previous ?? undefined });
      }
    }
    if (websites) {
      const primary = company.domain ?? null;
      const next = websites.filter((site) => !sameSite(site, primary));
      const previous = (company.get('websites') as string[] | undefined) ?? [];
      company.set('websites', next.length ? next : undefined);
      result.websites = [...(primary ? [primary] : []), ...next];
      if (previous.join(',') !== next.join(',')) activities.push({ title: 'Websites updated', detail: result.websites.join(', ') || 'none' });
    }
    if (subreddit?.ok) {
      const previous = company.subreddit ?? null;
      company.subreddit = subreddit.subreddit ?? undefined;
      result.subreddit = subreddit.subreddit;
      if (previous !== subreddit.subreddit) {
        activities.push({ title: subreddit.subreddit ? 'Subreddit set' : 'Subreddit cleared', detail: subreddit.subreddit ? `r/${subreddit.subreddit}` : previous ? `r/${previous}` : undefined });
      }
    }
    if (relationship) {
      // Older companies have no stored value and count as clients.
      const previous = ((company.get('relationship') as CompanyRelationship | undefined) ?? 'client');
      company.set('relationship', relationship);
      result.relationship = relationship;
      if (previous !== relationship) activities.push({ title: 'Company type changed', detail: `${RELATIONSHIP_NAME[previous]} → ${RELATIONSHIP_NAME[relationship]}` });
    }
    await company.save();
    // Per-site numbers need the new list of websites applied to past days too.
    if (activities.some((a) => a.title === 'Websites updated' || a.title.startsWith('Production domain'))) await refetchSiteHistory(viewer.organizationId, id);
    for (const activity of activities) {
      await recordActivity({ organizationId: viewer.organizationId, companyId: id, kind: 'company', ...activity, actorUserId: viewer.userId });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[os/companies/:id] update failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
