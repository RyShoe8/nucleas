import { NextRequest, NextResponse } from 'next/server';
import User from '@/lib/models/User';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listAvailableModels } from '@/lib/ai/engine/catalog';
import { COST_LEVELS, NEED_LABELS, NEEDS, isCostLevel, readEngineSettings, saveEngineSettings, selectModel, type Need } from '@/lib/ai/engine/select';

export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const user = await User.findById(viewer.userId).select('isAdmin').lean<{ isAdmin?: boolean }>();
  if (viewer.role !== 'Administrator' && !user?.isAdmin) {
    return NextResponse.json({ error: 'Only administrators can change the AI engine.' }, { status: 403 });
  }
  return viewer;
}

/** What the engine picks for every need at every cost level, plus the available models. ?refresh=1 re-reads provider catalogs. */
export async function GET(request: NextRequest) {
  const viewer = await requireAdmin(request);
  if (viewer instanceof NextResponse) return viewer;
  const org = String(viewer.organizationId);
  const models = await listAvailableModels({ force: request.nextUrl.searchParams.get('refresh') === '1' });
  const settings = await readEngineSettings(org);
  const needs = await Promise.all(
    NEEDS.map(async (need) => ({
      need,
      ...NEED_LABELS[need],
      pinned: settings.pins[need] ?? null,
      picks: Object.fromEntries(
        await Promise.all(COST_LEVELS.map(async (level) => [level, await selectModel(org, need, level, { models, settings })] as const))
      ),
    }))
  );
  return NextResponse.json(
    {
      defaultCostLevel: settings.defaultCostLevel,
      needs,
      models: models.map((m) => ({ profileId: m.profileId, profileLabel: m.profileLabel, model: m.model, free: m.free, strengths: m.strengths, price: m.blendedPricePer1M })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Set the org default cost level, or pin/unpin a model for a need. */
export async function PUT(request: NextRequest) {
  const viewer = await requireAdmin(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { defaultCostLevel?: unknown; pin?: { need?: unknown; profileId?: unknown; model?: unknown }; unpin?: unknown };
  const need = (v: unknown): Need | undefined => ((NEEDS as readonly string[]).includes(String(v)) ? (v as Need) : undefined);
  const result = await saveEngineSettings(
    String(viewer.organizationId),
    {
      defaultCostLevel: isCostLevel(body.defaultCostLevel) ? body.defaultCostLevel : undefined,
      pin:
        body.pin && need(body.pin.need) && typeof body.pin.profileId === 'string' && typeof body.pin.model === 'string'
          ? { need: need(body.pin.need)!, profileId: body.pin.profileId, model: body.pin.model }
          : null,
      unpin: need(body.unpin),
    },
    viewer.userId
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
