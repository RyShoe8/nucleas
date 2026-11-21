import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile } from '@/lib/companies/companyProfile';
import { readBoard } from '@/lib/companies/teamBoard';
import Asset from '@/lib/models/Asset';
import Project from '@/lib/models/Project';
import { Job } from '@/lib/models/Job';
import { getOrganizationUserIds } from '@/lib/utils/apiHelpers';
import { buildAssetAccessScope, canAccessAsset, getAssetSessionContext } from '@/lib/assets/assetAccess';

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
    return NextResponse.json({ board, assets: assets.filter(a => ctx.isManagerOrAdmin || canAccessAsset(ctx, a, access)).map(a => ({ id: String(a._id), name: a.name, type: a.type, url: a.fileUrl ?? a.url, description: a.description, text: a.textContent, updatedAt: a.updatedAt })), decisions }, { headers: { 'Cache-Control': 'no-store' } });
}
