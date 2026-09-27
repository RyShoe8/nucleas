import mongoose, { Schema, Types, type InferSchemaType, type Model } from 'mongoose';
import { AiModelProfile, AiRolePipeline } from '@/lib/models/AiRolePipeline';
import { isFreeCredential } from '@/lib/ai/rolePipeline/modelMeta';
import { getRoute, ROUTES, type RouteDefinition } from './routes';

/** An organization's model assignment for one route, with an optional paid fallback. */
const bindingSchema = new Schema(
  {
    organizationId: { type: String, required: true },
    route: { type: String, required: true },
    modelProfileId: { type: Schema.Types.ObjectId, ref: 'AiModelProfile', required: true },
    model: { type: String, required: true, maxlength: 200 },
    fallbackProfileId: { type: Schema.Types.ObjectId, ref: 'AiModelProfile' },
    fallbackModel: { type: String, maxlength: 200 },
    /** Explicit consent to escalate from a free model to the paid fallback. Never silent. */
    allowPaidFallback: { type: Boolean, default: false },
    updatedByUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);
bindingSchema.index({ organizationId: 1, route: 1 }, { unique: true });

type BindingDoc = InferSchemaType<typeof bindingSchema>;
export const AiRouteBinding: Model<BindingDoc> =
  (mongoose.models.AiRouteBinding as Model<BindingDoc> | undefined) ?? mongoose.model<BindingDoc>('AiRouteBinding', bindingSchema);

export interface ModelChoice {
  profileId: string;
  model: string;
  free: boolean;
  label: string;
}

export interface ResolvedRoute {
  route: string;
  primary: ModelChoice | null;
  fallback: ModelChoice | null;
  allowPaidFallback: boolean;
  /** Where the primary choice came from, for the admin UI. */
  source: 'assigned' | 'ai_team' | 'rogly_default' | 'unconfigured';
}

type ProfileLean = { _id: Types.ObjectId; label: string; provider?: string; tier: string; enabled: boolean };

async function profileChoice(profileId: unknown, model: string | undefined | null): Promise<ModelChoice | null> {
  if (!profileId || !model || !Types.ObjectId.isValid(String(profileId))) return null;
  const p = await AiModelProfile.findById(profileId).select('label provider tier enabled').lean<ProfileLean>();
  if (!p || !p.enabled) return null;
  return { profileId: String(p._id), model, free: isFreeCredential({ provider: p.provider, tier: p.tier }), label: p.label };
}

async function freeProfile(): Promise<ProfileLean | null> {
  const profiles = await AiModelProfile.find({ enabled: true }).select('label provider tier enabled').lean<ProfileLean[]>();
  // Prefer the self-hosted tier (Rogly); fall back to any credential Nucleas treats as free.
  return profiles.find((p) => p.tier === 'local_remote') ?? profiles.find((p) => isFreeCredential({ provider: p.provider, tier: p.tier })) ?? null;
}

async function inherited(organizationId: string, def: RouteDefinition): Promise<ModelChoice | null> {
  if (!def.inheritFrom) return null;
  const pipeline = await AiRolePipeline.findOne({ organizationId, employee: def.inheritFrom.employee, enabled: true })
    .select('planner worker reviewer')
    .lean<Record<string, { modelProfileId?: Types.ObjectId; model?: string } | undefined>>();
  const stage = pipeline?.[def.inheritFrom.stage];
  return profileChoice(stage?.modelProfileId, stage?.model);
}

/**
 * Resolves a route to a model: an explicit assignment, else the matching AI Team binding, else the
 * default Rogly model for free routes. Returns primary null when nothing usable is configured.
 */
export async function resolveRoute(organizationId: string, routeKey: string): Promise<ResolvedRoute> {
  const def = getRoute(routeKey);
  if (!def) throw new Error(`Unknown route ${routeKey}`);

  const binding = await AiRouteBinding.findOne({ organizationId, route: routeKey }).lean();
  if (binding) {
    return {
      route: routeKey,
      primary: await profileChoice(binding.modelProfileId, binding.model),
      fallback: await profileChoice(binding.fallbackProfileId, binding.fallbackModel),
      allowPaidFallback: Boolean(binding.allowPaidFallback),
      source: 'assigned',
    };
  }

  const fromTeam = await inherited(organizationId, def);
  if (fromTeam) return { route: routeKey, primary: fromTeam, fallback: null, allowPaidFallback: false, source: 'ai_team' };

  if (def.defaultFreeModel) {
    const free = await freeProfile();
    if (free) {
      return {
        route: routeKey,
        primary: { profileId: String(free._id), model: def.defaultFreeModel, free: true, label: free.label },
        fallback: null,
        allowPaidFallback: false,
        source: 'rogly_default',
      };
    }
  }
  return { route: routeKey, primary: null, fallback: null, allowPaidFallback: false, source: 'unconfigured' };
}

export async function resolveAllRoutes(organizationId: string): Promise<(ResolvedRoute & RouteDefinition)[]> {
  return Promise.all(ROUTES.map(async (def) => ({ ...def, ...(await resolveRoute(organizationId, def.key)) })));
}

export async function assignRoute(
  organizationId: string,
  routeKey: string,
  input: { profileId: string; model: string; fallbackProfileId?: string | null; fallbackModel?: string | null; allowPaidFallback?: boolean },
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!getRoute(routeKey)) return { ok: false, error: 'Unknown route.' };
  const primary = await profileChoice(input.profileId, input.model?.trim());
  if (!primary) return { ok: false, error: 'Choose an enabled credential and a model.' };
  const fallback = input.fallbackProfileId ? await profileChoice(input.fallbackProfileId, input.fallbackModel?.trim()) : null;
  if (input.fallbackProfileId && !fallback) return { ok: false, error: 'The fallback credential or model is invalid.' };
  await AiRouteBinding.updateOne(
    { organizationId, route: routeKey },
    {
      $set: {
        modelProfileId: new Types.ObjectId(primary.profileId),
        model: primary.model,
        fallbackProfileId: fallback ? new Types.ObjectId(fallback.profileId) : undefined,
        fallbackModel: fallback?.model,
        allowPaidFallback: Boolean(input.allowPaidFallback && fallback),
        updatedByUserId: new Types.ObjectId(userId),
      },
    },
    { upsert: true }
  );
  return { ok: true };
}

export async function clearRoute(organizationId: string, routeKey: string): Promise<void> {
  await AiRouteBinding.deleteOne({ organizationId, route: routeKey });
}
