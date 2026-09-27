import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import Project from '@/lib/models/Project';
import { getCompanyProfile } from '@/lib/companies/companyProfile';
import { listCompanyConnections } from '@/lib/integrations/connections';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';

/** Company overview: resolved profile, its projects and its integrations. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireCompanyViewer(request);
    if (viewer instanceof NextResponse) return viewer;
    const { id } = await params;

    const profile = await getCompanyProfile(viewer, id);
    if (!profile) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    const [projects, connections] = await Promise.all([
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
    ]);

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error('[os/companies/:id] failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
