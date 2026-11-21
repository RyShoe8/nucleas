import { after, NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { createJob, runDesign } from '@/lib/jobs/jobs';
import { agreementBrief, workAgreementSchema } from '@/lib/work/agreements';
import { createResponsibility, listResponsibilities } from '@/lib/work/responsibilities';
import { validateWorkOwner } from '@/lib/companies/teamSpecialists';
import { startCodeChange } from '@/lib/building/builds';
import { readEngineSettings } from '@/lib/ai/engine/select';
import { linkWorkAssets } from '@/lib/work/resources';
import { claimWorkDraft, finishWorkDraft, releaseWorkDraft, type CreatedWork } from '@/lib/work/submissions';
export const maxDuration = 800;
export async function GET(request: NextRequest) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    return NextResponse.json({ responsibilities: await listResponsibilities(viewer, request.nextUrl.searchParams.get('companyId') ?? undefined, request.nextUrl.searchParams.get('all') === '1') }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: NextRequest) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only managers can assign work.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const parsed = workAgreementSchema.safeParse(body.agreement);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid agreement.' }, { status: 400 });
    if (typeof body.companyId !== 'string' || !(await getCompanyProfile(viewer, body.companyId))) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
    try { await validateWorkOwner(viewer, body.companyId, parsed.data.role, parsed.data.assignedMemberId); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
    const sourceTurnId = typeof body.draftTurnId === 'string' ? body.draftTurnId : undefined;
    let token: string | undefined;
    try {
        if (sourceTurnId) {
            const claim = await claimWorkDraft(viewer, sourceTurnId, body.companyId);
            if (claim.created) return NextResponse.json({ created: claim.created });
            token = claim.token;
        }
        await linkWorkAssets(viewer, body.companyId, parsed.data.assetIds);
        let created: CreatedWork;
        if (parsed.data.mode === 'ongoing') {
            const result = await createResponsibility(viewer, body.companyId, parsed.data, sourceTurnId);
            created = { kind: 'responsibility', id: result.id };
        } else if (parsed.data.mode === 'once' && ['engineering', 'design'].includes(parsed.data.role)) {
            const settings = await readEngineSettings(String(viewer.organizationId));
            const result = await startCodeChange(viewer, { sourceTurnId, companyId: body.companyId, request: agreementBrief(parsed.data), workAgreement: parsed.data, teamRole: parsed.data.role as 'engineering' | 'design', assignedMemberId: parsed.data.assignedMemberId, level: parsed.data.level ?? settings.defaultCostLevel });
            if (!result.ok) throw Error(result.message);
            created = { kind: 'build', id: result.build.id };
        } else {
            const result = await createJob(viewer, { sourceTurnId, companyId: body.companyId, request: agreementBrief(parsed.data), teamRole: parsed.data.role, level: parsed.data.level, workAgreement: parsed.data, background: true });
            if (!result.ok) throw Error(result.error);
            after(() => runDesign(viewer, result.job.id));
            created = { kind: 'job', id: result.job.id };
        }
        if (sourceTurnId && token) await finishWorkDraft(viewer, sourceTurnId, token, created);
        return NextResponse.json({ created });
    } catch (e) {
        if (sourceTurnId && token) await releaseWorkDraft(viewer, sourceTurnId, token);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not prepare work.' }, { status: 400 });
    }
}
