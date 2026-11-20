import { after, NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { TEAM, TEAM_ROLES, teamRoleFor } from '@/lib/companies/teamRoles';
import { CompanyTeam } from '@/lib/models/CompanyTeam';
import { Job } from '@/lib/models/Job';
import { BuildRequest } from '@/lib/models/BuildRequest';
import { listBuilds, startCodeChange } from '@/lib/building/builds';
import { readEngineSettings } from '@/lib/ai/engine/select';
import { createJob, listJobs, runDesign } from '@/lib/jobs/jobs';
import { readBoard } from '@/lib/companies/teamBoard';
import { PLAYBOOKS } from '@/lib/companies/teamPlaybooks';
import { availableReviewers, companyAssignments, ensureTeamAssignment, ensureEmployeeIdentity } from '@/lib/companies/teamAssignments';
import { OfficeSceneModel } from '@/lib/models/OfficeScene';

export const maxDuration = 800;
const edit = z.discriminatedUnion('action', [
  z.object({ action: z.literal('staff'), role: z.enum(TEAM_ROLES), active: z.boolean(), displayName: z.string().trim().min(1).max(60), specialty: z.string().trim().max(120), reviewerEmployeeId: z.string().regex(/^[a-f\d]{24}$/i).nullable() }),
  z.object({ action: z.literal('profile'), role: z.enum(TEAM_ROLES), remit: z.string().trim().min(10).max(2000), lessons: z.string().trim().max(4000) }),
  z.object({ action: z.literal('assign'), role: z.enum(TEAM_ROLES), jobId: z.string().regex(/^[a-f\d]{24}$/i) }),
  z.object({ action: z.literal('delegate'), role: z.enum(TEAM_ROLES).optional(), request: z.string().trim().min(10).max(6000) }),
]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { id } = await params;
  const company = await getCompanyProfile(viewer, id);
  if (!company) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const [profiles, jobs, builds, board, reviewers] = await Promise.all([
    companyAssignments(viewer.organizationId, [id]),
    listJobs(viewer, { companyId: id }),
    listBuilds(viewer),
    readBoard(viewer.organizationId, id),
    availableReviewers(viewer.organizationId, company),
  ]);
  return NextResponse.json({ board, reviewers, canManage: isCompanyManager(viewer), members: TEAM_ROLES.map(role => {
    const saved = profiles.find(p => p.role === role);
    return { role, ...TEAM[role], ...saved, name: saved?.displayName ?? TEAM[role].name, playbook: { craft: PLAYBOOKS[role].craft, bar: PLAYBOOKS[role].bar, avoids: PLAYBOOKS[role].avoids, sources: PLAYBOOKS[role].sources } };
  }), builds: builds.filter(build => build.companyId === id), jobs: jobs.map(job => ({ ...job, teamRole: teamRoleFor(job) })) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Manager access required.' }, { status: 403 });
  const { id } = await params;
  const company = await getCompanyProfile(viewer, id);
  if (!company) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const parsed = edit.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  // With no member named, the request text decides who owns it.
  const role = body.role ?? teamRoleFor({ request: body.request });
  if (!TEAM[role].active) return NextResponse.json({ error: 'Tester is reserved and inactive.' }, { status: 409 });
  const scope = { organizationId: viewer.organizationId, companyId: new Types.ObjectId(id) };
  if (body.action === 'staff') {
    if (body.reviewerEmployeeId && !(await availableReviewers(viewer.organizationId, company)).some(e => e.id === body.reviewerEmployeeId)) return NextResponse.json({ error: 'Choose a person with access to this company.' }, { status: 400 });
    if (!body.active) {
      const [jobs,builds] = await Promise.all([
        Job.find({...scope,status:{$nin:['done','archived','rejected']}}).select('teamRole request design.skill design.title design.category').lean(),
        BuildRequest.find({...scope,status:{$in:['planning','proposed','queued','building','ready','failed']}}).select('teamRole').lean(),
      ]);
      if (jobs.some(j => teamRoleFor(j) === role) || builds.some(b => (b.teamRole ?? 'engineering') === role)) return NextResponse.json({ error: 'Reassign or finish this employee’s work before removing them from the company.' }, { status: 409 });
    }
    const identity=body.active?await ensureEmployeeIdentity(viewer.organizationId,id,role):null;
    await CompanyTeam.updateOne({ ...scope, role }, { $set: { active: body.active, displayName: body.displayName===TEAM[role].name&&identity?identity:body.displayName, specialty: body.specialty, reviewerEmployeeId: body.reviewerEmployeeId, updatedBy: new Types.ObjectId(viewer.userId) }, $setOnInsert: { remit: TEAM[role].remit } }, { upsert: true, runValidators: true });
    await OfficeSceneModel.updateOne({ _id: viewer.organizationId }, { $set: { 'scene.contextAt': 0 } });
  } else if (body.action === 'profile') {
    await CompanyTeam.updateOne({ ...scope, role: body.role }, { $set: { remit: body.remit, lessons: body.lessons, updatedBy: new Types.ObjectId(viewer.userId) } }, { upsert: true, runValidators: true });
  } else if (body.action === 'assign') {
    const result = await Job.updateOne({ ...scope, _id: new Types.ObjectId(body.jobId) }, { $set: { teamRole: body.role }, $unset: { teamAdvice: '' }, $push: { events: { at: new Date(), userId: new Types.ObjectId(viewer.userId), action: 'team_assigned', note: `Assigned to ${TEAM[body.role].name}; applies to future runs.` } } });
    if (!result.matchedCount) return NextResponse.json({ error: 'Responsibility not found in this company.' }, { status: 404 });
    await ensureTeamAssignment(viewer.organizationId, id, role, viewer.userId);
  } else if (role === 'engineering' || role === 'design') {
    const settings = await readEngineSettings(String(viewer.organizationId));
    const result = await startCodeChange(viewer, { companyId: id, request: body.request, level: settings.defaultCostLevel, teamRole: role });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 409 });
    await ensureTeamAssignment(viewer.organizationId, id, role, viewer.userId);
    return NextResponse.json({ ok: true, role, build: result.build });
  } else {
    const result = await createJob(viewer, { companyId: id, request: body.request, teamRole: role, background: true });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    await ensureTeamAssignment(viewer.organizationId, id, role, viewer.userId);
    after(() => runDesign(viewer, result.job.id));
    return NextResponse.json({ ok: true, role, job: result.job });
  }
  return NextResponse.json({ ok: true });
}
