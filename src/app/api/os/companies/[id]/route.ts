import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import Project from '@/lib/models/Project';
import Client from '@/lib/models/Client';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { listCompanyConnections } from '@/lib/integrations/connections';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { normalizeProductionDomain } from '@/lib/companies/productionDomain';
import { recordActivity } from '@/lib/companies/activityLog';
import { CompanyAssistantTurn } from '@/lib/models/CompanyAssistantTurn';

/** Company overview: resolved profile, its projects and its integrations. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    const { id } = await params;

    const profile = await getCompanyProfile(viewer, id);
    if (!profile) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    const [projects, connections, citationSources] = await Promise.all([
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
      company: profile,
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
    if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'domain')) {
      return NextResponse.json({ error: 'Production domain is required.' }, { status: 400 });
    }
    const parsed = normalizeProductionDomain((body as { domain?: unknown }).domain);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const company = await Client.findOne({ _id: id, organizationId: viewer.organizationId });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    const previous = company.domain ?? null;
    company.domain = parsed.domain ?? undefined;
    await company.save();

    if (previous !== parsed.domain) {
      await recordActivity({
        organizationId: viewer.organizationId,
        companyId: id,
        kind: 'company',
        title: parsed.domain ? 'Production domain set' : 'Production domain cleared',
        detail: parsed.domain ?? previous ?? undefined,
        actorUserId: viewer.userId,
      });
    }
    return NextResponse.json({ domain: parsed.domain });
  } catch (error) {
    console.error('[os/companies/:id] update failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
