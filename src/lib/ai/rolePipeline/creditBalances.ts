import 'server-only';
import { decryptModelSecret } from '@/lib/ai/modelSecrets';
import { microsToDollars } from '@/lib/ai/settingsSchema';
import { readFreePoolSnapshot } from '@/lib/ai/control/freePool';
import { companyDisplayName } from '@/lib/ai/rolePipeline/providerCatalog';
import {
  clearProviderBalanceCache,
  formatBalanceHint,
  getCachedProviderBalance,
  resolveProviderBalance,
  setCachedProviderBalance,
  type ProviderBalanceResult,
} from '@/lib/ai/rolePipeline/providerBalance';
import { AiModelProfile } from '@/lib/models/AiModelProfile';

export type CredentialBalanceRow = {
  profileId: string;
  label: string;
  provider: string;
  tier: string;
  enabled: boolean;
  kind: ProviderBalanceResult['kind'];
  remainingMicros: number | null;
  hint: string;
  source: string;
  error: string | null;
  manualBalanceMicros: number | null;
  manualBalanceUpdatedAt: string | null;
  asOf: string;
};

export async function loadCredentialBalances(input?: {
  enabledOnly?: boolean;
  forceRefresh?: boolean;
}): Promise<{
  freePool: { limitMicros: number; remainingMicros: number; hint: string };
  credentials: CredentialBalanceRow[];
  asOf: string;
}> {
  const asOf = new Date().toISOString();
  const freePool = await readFreePoolSnapshot();
  const query = input?.enabledOnly ? { enabled: true } : {};
  const rows = await AiModelProfile.find(query)
    .select(
      'key label provider tier enabled secretCiphertext manualBalanceMicros manualBalanceUpdatedAt'
    )
    .sort({ tier: 1, label: 1 })
    .limit(100)
    .maxTimeMS(5000)
    .lean();

  if (input?.forceRefresh) clearProviderBalanceCache();

  const credentials = await Promise.all(
    rows.map(async (row) => {
      const profileId = String(row._id);
      const provider = row.provider ?? 'custom';
      const cached = input?.forceRefresh ? null : getCachedProviderBalance(profileId);
      let result: ProviderBalanceResult;
      if (cached) {
        result = cached;
      } else {
        let bearerToken: string | undefined;
        if (provider === 'deepseek' || provider === 'openrouter') {
          try {
            bearerToken = decryptModelSecret(row.secretCiphertext);
          } catch {
            bearerToken = undefined;
          }
        }
        result = await resolveProviderBalance({
          provider,
          bearerToken,
          manualBalanceMicros: row.manualBalanceMicros ?? null,
        });
        setCachedProviderBalance(profileId, result);
      }
      return {
        profileId,
        label: companyDisplayName({ label: row.label, provider }),
        provider,
        tier: row.tier,
        enabled: row.enabled,
        kind: result.kind,
        remainingMicros: result.remainingMicros,
        hint: formatBalanceHint(result, microsToDollars),
        source: result.source,
        error: result.error,
        manualBalanceMicros: row.manualBalanceMicros ?? null,
        manualBalanceUpdatedAt: row.manualBalanceUpdatedAt
          ? new Date(row.manualBalanceUpdatedAt).toISOString()
          : null,
        asOf,
      } satisfies CredentialBalanceRow;
    })
  );

  return {
    freePool: {
      limitMicros: freePool.freePoolLimitMicros,
      remainingMicros: freePool.freePoolRemainingMicros,
      hint: `$${microsToDollars(freePool.freePoolRemainingMicros)}`,
    },
    credentials,
    asOf,
  };
}
