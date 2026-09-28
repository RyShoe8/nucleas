import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { listAvailableModels, shortlistModels } from '@/lib/ai/engine/catalog';

export const dynamic = 'force-dynamic';

/**
 * Providers and the models each one lists right now, for Direct mode. Only chat models from
 * enabled credentials; strongest first (benchmark score, then price). `recommended` marks the
 * short list shown by default.
 */
export async function GET(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const models = await listAvailableModels();
  const recommended = new Set(shortlistModels(models));
  const providers = new Map<string, { profileId: string; label: string; models: { id: string; label: string; free: boolean; price: number | null; score: number | null; recommended: boolean }[] }>();
  for (const m of models) {
    const entry = providers.get(m.profileId) ?? { profileId: m.profileId, label: m.profileLabel, models: [] };
    entry.models.push({ id: m.model, label: m.label, free: m.free, price: m.blendedPricePer1M, score: m.benchmark?.intelligence ?? null, recommended: recommended.has(m) });
    providers.set(m.profileId, entry);
  }
  const list = [...providers.values()]
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      ...p,
      models: p.models.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.price ?? 0) - (a.price ?? 0) || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return NextResponse.json({ providers: list }, { headers: { 'Cache-Control': 'no-store' } });
}
