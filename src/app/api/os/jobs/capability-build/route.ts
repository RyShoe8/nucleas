import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { getCompanyProfile, isCompanyManager, listCompanyProfiles } from '@/lib/companies/companyProfile';
import { readEngineSettings } from '@/lib/ai/engine/select';
import { proposeCodeChange } from '@/lib/building/builds';

export const maxDuration = 300;
const input = z.object({ companyId: z.string().regex(/^[a-f0-9]{24}$/i), brief: z.string().min(5).max(3000), missing: z.array(z.string().min(1).max(500)).min(1).max(10) });
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!isCompanyManager(viewer)) return NextResponse.json({ error: 'Manager access required.' }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A job brief and missing capabilities are required.' }, { status: 400 });
  const company = await getCompanyProfile(viewer, parsed.data.companyId);
  if (!company) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  const platform = (await listCompanyProfiles(viewer)).find(c => (c.relationship === 'owned' || c.relationship === 'internal') && /^(?:https?:\/\/)?(?:www\.)?nucleas\.app\/?$/i.test(c.domain ?? ''));
  if (!platform) return NextResponse.json({ error: 'Connect the owned Nucleas company and its code repository first.' }, { status: 409 });
  const { defaultCostLevel } = await readEngineSettings(String(viewer.organizationId));
  const proposal = await proposeCodeChange(viewer, { companyId: platform.id, level: defaultCostLevel, request: [
    'Extend the Nucleas jobs runtime to support this workflow. Inspect existing capabilities first. Implement only missing reusable operations and wire them through job setup, execution and review. Preserve permissions and approval of external actions. Include a dry run and regression coverage.',
    'Requesting company: ' + company.name, 'Job brief: ' + parsed.data.brief, 'Missing capabilities:', ...parsed.data.missing,
  ].join('\n') });
  return proposal.ok ? NextResponse.json({ buildId: proposal.build.id, title: proposal.build.title }) : NextResponse.json({ error: proposal.message }, { status: 409 });
}
