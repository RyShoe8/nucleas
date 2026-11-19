import { Types } from 'mongoose';
import { MetricSyncState } from '@/lib/models/Metric';

/**
 * A company's websites (or which site an account belongs to) changed: per-site numbers only exist for the days
 * a sync fetched, so the next sync fetches each source's full history again. Totals are written by date, so
 * this refreshes them in place rather than adding to them.
 */
export async function refetchSiteHistory(organizationId: Types.ObjectId | string, companyId: Types.ObjectId | string): Promise<void> {
  await MetricSyncState.updateOne(
    { organizationId: new Types.ObjectId(String(organizationId)), companyId: new Types.ObjectId(String(companyId)) },
    { $unset: { backfilledCapabilities: '' } },
  );
}
