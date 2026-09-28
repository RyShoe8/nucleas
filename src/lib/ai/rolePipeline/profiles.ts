import 'server-only';
import type { GatewayConfiguration } from '@nucleas/ai-core/gateway';
import { GatewayError, validateGatewayConfiguration } from '@nucleas/ai-core/gateway';
import { decryptModelSecret } from '@/lib/ai/modelSecrets';
import { isFreeCredential } from '@/lib/ai/rolePipeline/modelMeta';
import {
  cleanedCompanyLabel,
  companyDisplayName,
  isModelAllowedForProvider,
} from '@/lib/ai/rolePipeline/providerCatalog';
import { AiModelProfile } from '@/lib/models/AiModelProfile';
import { isModelListedForProfile } from '@/lib/ai/engine/catalog';
import mongoose, { Types } from 'mongoose';
import { AiModelCheck } from '@/lib/ai/engine/checkResults';

export function mapModelProfilePublic(row: {
  _id: { toString(): string };
  key: string;
  label: string;
  provider?: string;
  tier: string;
  protocol: string;
  endpoint: string;
  model?: string | null;
  secretLast4: string;
  enabled: boolean;
  manualBalanceMicros?: number | null;
  manualBalanceUpdatedAt?: Date | null;
  updatedAt?: Date;
  createdAt?: Date;
}) {
  const provider = row.provider ?? 'custom';
  return {
    id: String(row._id),
    key: row.key,
    label: companyDisplayName({ label: row.label, provider }),
    provider,
    tier: row.tier,
    protocol: row.protocol,
    endpoint: row.endpoint,
    model: row.model ?? '',
    secretConfigured: true,
    secretLast4: row.secretLast4,
    enabled: row.enabled,
    manualBalanceMicros: row.manualBalanceMicros ?? null,
    manualBalanceUpdatedAt: row.manualBalanceUpdatedAt
      ? new Date(row.manualBalanceUpdatedAt).toISOString()
      : null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? null,
  };
}

/** Persist company-only labels for legacy "Company · Model" rows (idempotent). */
export async function normalizeLegacyCredentialLabels(
  rows: Array<{ _id: { toString(): string }; label: string; provider?: string | null }>
): Promise<void> {
  const ops = rows.flatMap((row) => {
    const next = cleanedCompanyLabel(row);
    if (!next) return [];
    row.label = next;
    return [
      AiModelProfile.updateOne({ _id: row._id }, { $set: { label: next } }).catch(() => undefined),
    ];
  });
  if (ops.length) await Promise.all(ops);
}

/** Resolve an enabled company credential into a gateway config for a chosen model. */
export async function gatewayFromModelProfile(
  profileId: string,
  modelOverride?: string
): Promise<{
  gateway: GatewayConfiguration;
  profile: { id: string; label: string; tier: string; model: string; provider: string };
}> {
  if (!Types.ObjectId.isValid(profileId)) throw new GatewayError('configuration');
  const row = await AiModelProfile.findById(profileId)
    .select('label provider tier protocol endpoint model secretCiphertext enabled')
    .maxTimeMS(3000)
    .lean();
  if (!row || !row.enabled) throw new GatewayError('configuration');
  const model = (modelOverride?.trim() || row.model || '').trim();
  if (!model) throw new GatewayError('configuration');
  const provider = row.provider ?? 'custom';
  // A model is callable when it is in the curated catalog or the provider currently lists it.
  if (!isModelAllowedForProvider(provider, model) && !(await isModelListedForProfile(String(row._id), model))) {
    throw new GatewayError('configuration');
  }

  let bearerToken: string;
  try {
    bearerToken = decryptModelSecret(row.secretCiphertext);
  } catch {
    throw new GatewayError('credentials');
  }
  if (!bearerToken.trim()) throw new GatewayError('credentials');
  const free = isFreeCredential({ provider, tier: row.tier });
  const gateway: GatewayConfiguration = {
    endpoint: row.endpoint,
    model,
    protocol: 'openai-chat',
    bearerToken,
    // Cold local hosts often exceed 60s; schema allows up to 120s.
    timeoutMs: free ? 120000 : 60000,
  };
  validateGatewayConfiguration(gateway);
  // Free models take tools the way the model checks found works best (native or described in the prompt).
  if (free && mongoose.connection.readyState === 1) {
    const check = await AiModelCheck.findOne({ profileId: row._id, model }).select('toolMode').lean<{ toolMode?: 'native' | 'prompted' | null }>();
    if (check?.toolMode === 'prompted') gateway.toolMode = 'prompted';
  }
  return {
    gateway,
    profile: {
      id: String(row._id),
      label: companyDisplayName({ label: row.label, provider }),
      tier: row.tier,
      model,
      provider,
    },
  };
}
