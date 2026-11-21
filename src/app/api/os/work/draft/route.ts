import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile } from '@/lib/companies/companyProfile';
import { readWorkDraft } from '@/lib/work/submissions';
export async function GET(request: NextRequest) {
    const viewer = await requireCompanyViewer(request); if (viewer instanceof NextResponse) return viewer;
    const id = request.nextUrl.searchParams.get('id') ?? '';
    if (!/^[a-f0-9]{24}$/i.test(id)) return NextResponse.json({ error: 'Invalid draft.' }, { status: 400 });
    const draft = await readWorkDraft(viewer, id);
    if (!draft || !(await getCompanyProfile(viewer, draft.companyId))) return NextResponse.json({ error: 'Work draft not found.' }, { status: 404 });
    return NextResponse.json({ draft }, { headers: { 'Cache-Control': 'no-store' } });
}
