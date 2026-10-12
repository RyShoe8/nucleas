import { after, NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { articleInputSchema, createArticle, listArticles } from '@/lib/articles/articles';
import { advanceArticle } from '@/lib/articles/pipeline';
import { defaultArticleDeps } from '@/lib/articles/deps';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const companyId = request.nextUrl.searchParams.get('companyId') ?? undefined;
  return NextResponse.json({ articles: await listArticles(viewer, companyId && /^[a-f0-9]{24}$/i.test(companyId) ? companyId : undefined) }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Starts an article. The writing runs in the background; the window polls for progress. */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const parsed = articleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Check the article details.' }, { status: 400 });
  const result = await createArticle(viewer, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  after(async () => { await advanceArticle(result.data.id, defaultArticleDeps); });
  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
