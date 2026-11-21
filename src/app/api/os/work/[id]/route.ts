import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { updateResponsibility, advanceResponsibility } from '@/lib/work/responsibilities';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { Types } from 'mongoose';
import { WorkResponsibility, WorkAssessment, WorkAgreementVersion } from '@/lib/models/WorkResponsibility';
import { workAgreementSchema } from '@/lib/work/agreements';
export const maxDuration = 800;
const update = z.object({ revision: z.number().int().nonnegative(), action: z.enum(['activate', 'pause', 'archive', 'assess', 'reopen', 'revise']), agreement: workAgreementSchema.optional(),
    monthlyBudgetMicros: z.number().int().positive().max(1e9).optional(), unitBudgetMicros: z.number().int().positive().max(1e9).optional(),
    targetKey: z.string().max(100).optional(), score: z.number().min(0).max(100).optional(), evidence: z.string().trim().max(3000).optional(), gatesPassed: z.array(z.string().max(300)).max(12).optional() });
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Only managers can change an agreement.' }, { status: 403 });
    const parsed = update.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid work decision.' }, { status: 400 });
    const { id } = await params;
    try { await updateResponsibility(viewer, id, parsed.data); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not update work.' }, { status: 409 }); }
    if (!['pause', 'archive', 'revise'].includes(parsed.data.action)) after(() => advanceResponsibility(id));
    return NextResponse.json({ ok: true });
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    const { id } = await params;
    const row = Types.ObjectId.isValid(id) ? await WorkResponsibility.findOne({ _id: id, organizationId: viewer.organizationId }).select('companyId').lean() : null;
    if (!row || !(await getCompanyProfile(viewer, String(row.companyId)))) return NextResponse.json({ error: 'Work not found.' }, { status: 404 });
    const assessments = await WorkAssessment.find({ responsibilityId: id, organizationId: viewer.organizationId, ...(request.nextUrl.searchParams.get('targetKey') ? { targetKey: request.nextUrl.searchParams.get('targetKey') } : {}) }).sort({ checkedAt: -1 }).limit(50).lean();
    const versions = await WorkAgreementVersion.find({ responsibilityId: id, organizationId: viewer.organizationId }).sort({ version: -1 }).limit(20).lean();
    return NextResponse.json({ assessments, versions }, { headers: { 'Cache-Control': 'no-store' } });
}
