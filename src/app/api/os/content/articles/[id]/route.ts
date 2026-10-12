import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { archiveArticle, getArticle, requeueArticle, restartArticle, saveArticleText } from '@/lib/articles/articles';
import { advanceArticle } from '@/lib/articles/pipeline';
import { defaultArticleDeps } from '@/lib/articles/deps';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const article = await getArticle(viewer, (await params).id);
  return article ? NextResponse.json({ article }, { headers: { 'Cache-Control': 'no-store' } }) : NextResponse.json({ error: 'Article not found.' }, { status: 404 });
}

const patchSchema = z.object({ title: z.string().max(300).optional(), body: z.string().max(60000).optional(), metaDescription: z.string().max(400).optional() });

/** Hand edits to the title, text or meta description. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Check the article text.' }, { status: 400 });
  const result = await saveArticleText(viewer, (await params).id, parsed.data);
  return result.ok ? NextResponse.json({ article: result.data }) : NextResponse.json({ error: result.error }, { status: result.status });
}

const actionSchema = z.object({ action: z.enum(['continue', 'restart']) });

/** continue: pick a stopped article back up where it stopped. restart: write it again from research. */
export async function POST(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const { id } = await params;
  const ok = parsed.data.action === 'restart' ? await restartArticle(viewer, id) : await requeueArticle(viewer, id);
  if (!ok) return NextResponse.json({ error: 'This article cannot be restarted right now.' }, { status: 409 });
  after(async () => { await advanceArticle(id, defaultArticleDeps); });
  return NextResponse.json({ ok: true }, { status: 202 });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  return (await archiveArticle(viewer, (await params).id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Article not found.' }, { status: 404 });
}
