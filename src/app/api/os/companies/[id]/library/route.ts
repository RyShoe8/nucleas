import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile, isCompanyManager } from '@/lib/companies/companyProfile';
import { readBoard, reviseBoardEvidence } from '@/lib/companies/teamBoard';
import { z } from 'zod';
import Asset from '@/lib/models/Asset';
import Project from '@/lib/models/Project';
import { Job } from '@/lib/models/Job';
import { getOrganizationUserIds } from '@/lib/utils/apiHelpers';
import { buildAssetAccessScope, canAccessAsset, getAssetSessionContext } from '@/lib/assets/assetAccess';

const correction = z.object({ id: z.string().min(1).max(80), fact: z.string().trim().min(5).max(1000), url: z.string().url().max(2000).refine(v => /^https?:\/\//i.test(v)), reason: z.string().trim().min(5).max(700), withdraw: z.boolean() });
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Manager access required.' }, { status: 403 });
    const { id } = await params;
    if (!(await getCompanyProfile(viewer, id))) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
    const parsed = correction.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Include the claim, source URL and reason for the correction.' }, { status: 400 });
    const ok = await reviseBoardEvidence(String(viewer.organizationId), id, viewer.userId, parsed.data);
    return NextResponse.json(ok ? { board: await readBoard(viewer.organizationId, id) } : { error: 'This memory changed. Refresh and try again.' }, { status: ok ? 200 : 409 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    const { id } = await params;
    if (!(await getCompanyProfile(viewer, id))) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
    const ctx = await getAssetSessionContext(viewer.userId); if (ctx instanceof NextResponse) return ctx;
    const users = await getOrganizationUserIds(viewer.userId, String(viewer.organizationId));
    const projects = await Project.find({ clientId: new Types.ObjectId(id), userId: { $in: users } }).select('_id').lean();
    const scope = { organizationId: viewer.organizationId, companyId: new Types.ObjectId(id) };
    const [board, assets, jobs, access] = await Promise.all([
        readBoard(viewer.organizationId, id),
        Asset.find({ userId: { $in: users }, $or: [{ linkedClientId: id }, { linkedProjectId: { $in: projects.map(p => p._id) } }] }).sort({ updatedAt: -1 }).limit(100).lean(),
        Job.find(scope).select('design.title request events').sort({ updatedAt: -1 }).limit(50).lean(),
        buildAssetAccessScope(ctx),
    ]);
    const decisions = jobs.flatMap(j => j.events.filter(e => /approv|accept|reject|review|complet|publish/i.test(e.action)).slice(-10).map(e => ({ jobId: String(j._id), title: j.design?.title ?? j.request.slice(0, 120), action: e.action, note: e.note, at: e.at }))).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 100);
    return NextResponse.json({ board, canManage: isCompanyManager(viewer), assets: assets.filter(a => ctx.isManagerOrAdmin || canAccessAsset(ctx, a, access)).map(a => ({ id: String(a._id), name: a.name, type: a.type, url: a.fileUrl ?? a.url, description: a.description, text: a.textContent, updatedAt: a.updatedAt })), decisions }, { headers: { 'Cache-Control': 'no-store' } });
}
