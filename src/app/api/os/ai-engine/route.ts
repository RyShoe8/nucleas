import { after, NextRequest, NextResponse } from 'next/server';
import User from '@/lib/models/User';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listAvailableModels } from '@/lib/ai/engine/catalog';
import { activeHealthIssues } from '@/lib/ai/engine/health';
import { cancelModelChecks, listModelChecks, queueModelChecks, runQueuedModelChecks } from '@/lib/ai/engine/modelChecks';
import { BENCHMARK_SOURCE, benchmarkRows, benchmarkStatus, saveBenchmarkKey } from '@/lib/ai/engine/benchmarks';
import { buildRanking } from '@/lib/ai/engine/rankings';
import { COST_LEVELS, NEED_LABELS, NEEDS, isCostLevel, isPriceCeiling, rankPaid, readEngineSettings, saveEngineSettings, selectModel, type Need } from '@/lib/ai/engine/select';

export const dynamic = 'force-dynamic';
/** Model checks run after the response; each free model takes a minute or two. */
export const maxDuration = 300;

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
  const leaderboard = await benchmarkRows(false).catch(() => []);
  const rankingFor = (need: 'plan' | 'code') => buildRanking({ paid: rankPaid(models, need).filter((m) => m.autoEligible), local: models.filter((m) => m.free), scores: leaderboard, need });
  const rankings = { plan: rankingFor('plan'), code: rankingFor('code') };
  const rankedKeys = new Set(
    models
      .filter((m) => rankings.plan.concat(rankings.code).some((r) => r.model === m.model && r.profileLabel === m.profileLabel))
      .map((m) => `${m.profileId}::${m.model}`)
  );
  const needs = await Promise.all(
    NEEDS.map(async (need) => ({
      need,
      ...NEED_LABELS[need],
      overrides: Object.fromEntries(COST_LEVELS.map((level) => [level, settings.overrides[level]?.[need] ?? null])),
      picks: Object.fromEntries(
        await Promise.all(COST_LEVELS.map(async (level) => [level, await selectModel(org, need, level, { models, settings })] as const))
      ),
    }))
  );
  return NextResponse.json(
    {
      defaultCostLevel: settings.defaultCostLevel,
      priceCeilings: settings.priceCeilings,
      benchmarks: { ...(await benchmarkStatus()), source: BENCHMARK_SOURCE },
      health: (await activeHealthIssues()).map((h) => ({
        ...h,
        profileLabel: models.find((m) => m.profileId === h.profileId)?.profileLabel ?? 'Credential',
      })),
      needs,
      checks: (await listModelChecks()).map((c) => ({ ...c, profileLabel: models.find((m) => m.profileId === c.profileId)?.profileLabel ?? 'Credential' })),
      rankings,
      // Everything the credentials list: the chooser shows a provider's full list, and the search explains each model's status.
      models: models
        .filter((m) => m.free || m.autoEligible || m.excludedReason !== 'Not a text chat model')
        .map((m) => ({
          profileId: m.profileId,
          profileLabel: m.profileLabel,
          model: m.model,
          free: m.free,
          strengths: m.strengths,
          price: m.blendedPricePer1M,
          benchmark: m.benchmark,
          status: m.free || m.autoEligible ? (rankedKeys.has(`${m.profileId}::${m.model}`) ? 'ranked' : 'eligible') : 'excluded',
          reason: m.excludedReason ?? null,
        })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Set the org default cost level or price ceilings, choose or clear the model for a need at one level, or set/remove the benchmark API key. */
export async function PUT(request: NextRequest) {
  const viewer = await requireAdmin(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { defaultCostLevel?: unknown; override?: { level?: unknown; need?: unknown; profileId?: unknown; model?: unknown }; clearOverride?: { level?: unknown; need?: unknown }; benchmarkApiKey?: unknown; priceCeilings?: unknown };
  if ('benchmarkApiKey' in body) {
    const key = typeof body.benchmarkApiKey === 'string' && body.benchmarkApiKey.trim() ? body.benchmarkApiKey : null;
    const saved = await saveBenchmarkKey(key);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  const need = (v: unknown): Need | undefined => ((NEEDS as readonly string[]).includes(String(v)) ? (v as Need) : undefined);
  const result = await saveEngineSettings(
    String(viewer.organizationId),
    {
      defaultCostLevel: isCostLevel(body.defaultCostLevel) ? body.defaultCostLevel : undefined,
      priceCeilings:
        body.priceCeilings && typeof body.priceCeilings === 'object'
          ? Object.fromEntries(Object.entries(body.priceCeilings as Record<string, unknown>).filter(([level, v]) => isCostLevel(level) && isPriceCeiling(v)))
          : undefined,
      override:
        body.override && need(body.override.need) && isCostLevel(body.override.level) && typeof body.override.profileId === 'string' && typeof body.override.model === 'string'
          ? { level: body.override.level, need: need(body.override.need)!, profileId: body.override.profileId, model: body.override.model }
          : null,
      clearOverride:
        body.clearOverride && need(body.clearOverride.need) && isCostLevel(body.clearOverride.level)
          ? { level: body.clearOverride.level, need: need(body.clearOverride.need)! }
          : null,
    },
    viewer.userId
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Measure every free model now (Nucleas's own checks). Runs in the background; unfinished ones continue on the next cron pass. */
export async function POST(request: NextRequest) {
  const viewer = await requireAdmin(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  if (body.action === 'cancel_checks') return NextResponse.json({ ok: true, cancelled: await cancelModelChecks() });
  if (body.action !== 'run_checks') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const queued = await queueModelChecks();
  if (queued === 0) return NextResponse.json({ error: 'No free models are available to check.' }, { status: 400 });
  after(() => runQueuedModelChecks({ budgetMs: 270_000 }).catch((error) => console.error('[ai-engine] model checks failed', error instanceof Error ? error.message : 'unknown')));
  return NextResponse.json({ ok: true, queued });
}
