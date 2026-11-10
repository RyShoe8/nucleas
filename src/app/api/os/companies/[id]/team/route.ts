import { after, NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { TEAM, TEAM_ROLES, teamRoleFor } from '@/lib/companies/teamRoles';
import { CompanyTeam } from '@/lib/models/CompanyTeam';
import { Job } from '@/lib/models/Job';
import { listBuilds, proposeCodeChange } from '@/lib/building/builds';
import { readEngineSettings } from '@/lib/ai/engine/select';
import { createJob, listJobs, runDesign } from '@/lib/jobs/jobs';

export const maxDuration = 800;
const edit = z.discriminatedUnion('action', [
  z.object({ action: z.literal('profile'), role: z.enum(TEAM_ROLES), remit: z.string().trim().min(10).max(2000), lessons: z.string().trim().max(4000) }),
  z.object({ action: z.literal('assign'), role: z.enum(TEAM_ROLES), jobId: z.string().regex(/^[a-f\d]{24}$/i) }),
  z.object({ action: z.literal('delegate'), role: z.enum(TEAM_ROLES), request: z.string().trim().min(10).max(6000) }),
]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  if (!await getCompanyProfile(viewer, id)) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const [profiles, jobs, builds] = await Promise.all([
    CompanyTeam.find({ organizationId: viewer.organizationId, companyId: new Types.ObjectId(id) }).select('role remit lessons updatedAt').lean(),
    listJobs(viewer, { companyId: id }),
    listBuilds(viewer),
  ]);
  return NextResponse.json({ canManage: isCompanyManager(viewer), members: TEAM_ROLES.map(role => {
    const saved = profiles.find(p => p.role === role);
    return { role, ...TEAM[role], remit: saved?.remit ?? TEAM[role].remit, lessons: saved?.lessons ?? '', updatedAt: saved?.updatedAt?.toISOString() ?? null };
  }), builds: builds.filter(build => build.companyId === id), jobs: jobs.map(job => ({ ...job, teamRole: teamRoleFor(job) })) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Manager access required.' }, { status: 403 });
  const { id } = await params;
  if (!await getCompanyProfile(viewer, id)) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const parsed = edit.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (!TEAM[body.role].active) return NextResponse.json({ error: 'Tester is reserved and inactive.' }, { status: 409 });
  const scope = { organizationId: viewer.organizationId, companyId: new Types.ObjectId(id) };
  if (body.action === 'profile') {
    await CompanyTeam.updateOne({ ...scope, role: body.role }, { $set: { remit: body.remit, lessons: body.lessons, updatedBy: new Types.ObjectId(viewer.userId) } }, { upsert: true, runValidators: true });
  } else if (body.action === 'assign') {
    const result = await Job.updateOne({ ...scope, _id: new Types.ObjectId(body.jobId) }, { $set: { teamRole: body.role }, $push: { events: { at: new Date(), userId: new Types.ObjectId(viewer.userId), action: 'team_assigned', note: `Assigned to ${TEAM[body.role].name}; applies to future runs.` } } });
    if (!result.matchedCount) return NextResponse.json({ error: 'Responsibility not found in this company.' }, { status: 404 });
  } else if (body.role === 'engineering' || body.role === 'design') {
    const settings = await readEngineSettings(String(viewer.organizationId));
    const result = await proposeCodeChange(viewer, { companyId: id, request: body.request, level: settings.defaultCostLevel, teamRole: body.role });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
    return NextResponse.json({ ok: true, build: result.build });
  } else {
    const result = await createJob(viewer, { companyId: id, request: body.request, teamRole: body.role, background: true });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    after(() => runDesign(viewer, result.job.id));
    return NextResponse.json({ ok: true, job: result.job });
  }
  return NextResponse.json({ ok: true });
}
