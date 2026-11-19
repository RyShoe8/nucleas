import { Types } from 'mongoose';
import { SeoLookup, type SeoLookupDoc } from '@/lib/models/SeoLookup';

const DAY_MS = 86_400_000;

/**
 * Returns the cached answer for this request when one is still fresh; otherwise computes it, stores it and returns it.
 * A failed computation is never cached. `cached` tells the caller the source was not contacted.
 */
export async function cachedLookup<T>(
  organizationId: Types.ObjectId | string,
  kind: SeoLookupDoc['kind'],
  key: string,
  days: number,
  compute: () => Promise<T>,
  now = new Date()
): Promise<{ data: T; cached: boolean; fetchedAt: Date }> {
  const org = new Types.ObjectId(String(organizationId));
  const hit = await SeoLookup.findOne({ organizationId: org, kind, key, expiresAt: { $gt: now } }).lean<{ data: T; updatedAt?: Date }>();
  if (hit) return { data: hit.data, cached: true, fetchedAt: hit.updatedAt ?? now };
  const data = await compute();
  await SeoLookup.updateOne(
    { organizationId: org, kind, key },
    { $set: { data, expiresAt: new Date(now.getTime() + days * DAY_MS) } },
    { upsert: true }
  ).catch(() => undefined);
  return { data, cached: false, fetchedAt: now };
}
