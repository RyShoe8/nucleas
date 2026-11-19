import 'server-only';
import { Types } from 'mongoose';
import Client from '@/lib/models/Client';
import { getCompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';
import { recordActivity } from '@/lib/companies/activityLog';

/**
 * Archiving (the way a company is deleted): it disappears from every list, window and Ask, and its jobs,
 * watches and metric syncs stop. Nothing is erased: connections, history and settings stay, so an
 * Administrator can restore it exactly as it was.
 */
export type ArchiveResult = { ok: true; name: string } | { ok: false; status: 403 | 404 | 409; error: string };

export async function setCompanyArchived(viewer: CompanyViewer, companyId: string, archived: boolean): Promise<ArchiveResult> {
  if (viewer.role !== 'Administrator') return { ok: false, status: 403, error: 'Only Administrators can archive or restore a company.' };
  const profile = await getCompanyProfile(viewer, companyId, { includeArchived: true });
  if (!profile) return { ok: false, status: 404, error: 'Company not found.' };
  const filter = { _id: new Types.ObjectId(companyId), organizationId: viewer.organizationId, archivedAt: { $exists: !archived } };
  const update = archived
    ? { $set: { archivedAt: new Date(), archivedByUserId: new Types.ObjectId(viewer.userId) } }
    : { $unset: { archivedAt: '', archivedByUserId: '' } };
  const changed = await Client.updateOne(filter, update);
  if (!changed.modifiedCount) return { ok: false, status: 409, error: archived ? `${profile.name} is already archived.` : `${profile.name} is not archived.` };
  await recordActivity({ organizationId: viewer.organizationId, companyId, kind: 'company', title: archived ? 'Company archived' : 'Company restored', actorUserId: viewer.userId });
  return { ok: true, name: profile.name };
}

/** Companies whose scheduled work must not run. */
export async function archivedCompanyIds(): Promise<Types.ObjectId[]> {
  return (await Client.find({ archivedAt: { $exists: true } }).select('_id').lean<{ _id: Types.ObjectId }[]>()).map((c) => c._id);
}
