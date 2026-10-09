import 'server-only';
import mongoose, { Schema, Types } from 'mongoose';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { MarketingPlan } from '@/lib/models/MarketingPlan';
import { getCompanyProfile, type CompanyViewer } from '@/lib/companies/companyProfile';

export type ArtifactKind = 'brand_voice' | 'marketing_plan';
const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  companyId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['brand_voice', 'marketing_plan'], required: true },
  revision: { type: Number, required: true },
  savedAt: { type: Date, required: true },
  text: { type: String, required: true },
}, { timestamps: true });
schema.index({ organizationId: 1, companyId: 1, kind: 1, revision: 1 }, { unique: true });
export const ArtifactRevision = mongoose.models.ArtifactRevision ?? mongoose.model('ArtifactRevision', schema);

async function current(organizationId: Types.ObjectId, companyId: Types.ObjectId, kind: ArtifactKind) {
  const query = { organizationId, companyId };
  const row = kind === 'brand_voice' ? await BrandVoice.findOne(query).lean() : await MarketingPlan.findOne(query).lean();
  if (!row) return null;
  const hidden = new Set(['_id', '__v', 'organizationId', 'companyId', 'updatedByUserId', 'approvedByUserId']);
  const data = Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.has(key)));
  return { revision: row.revision, savedAt: row.updatedAt, text: kind === 'brand_voice' ? String('persona' in row ? row.persona : '') : JSON.stringify(data, null, 2) };
}

/** Save the old value before replacement, including records created before history existed. */
export async function preserveArtifact(organizationId: Types.ObjectId, companyId: Types.ObjectId, kind: ArtifactKind) {
  const version = await current(organizationId, companyId, kind);
  if (!version?.text) return;
  await ArtifactRevision.updateOne({ organizationId, companyId, kind, revision: version.revision }, { $setOnInsert: version }, { upsert: true });
}

export async function artifactHistory(viewer: CompanyViewer, companyId: string, kind: ArtifactKind) {
  if (!Types.ObjectId.isValid(companyId) || !(await getCompanyProfile(viewer, companyId))) return null;
  const id = new Types.ObjectId(companyId);
  const versions = await ArtifactRevision.find({ organizationId: viewer.organizationId, companyId: id, kind }).sort({ revision: -1 }).limit(30).lean<{ revision: number; savedAt: Date; text: string }[]>();
  const latest = await current(viewer.organizationId, id, kind);
  // Approval and no-op saves are not new plans. Compare against the previous
  // distinct content, ignoring bookkeeping in both new and legacy snapshots.
  const previous = versions.find((v) => v.revision < (latest?.revision ?? 0) && artifactContent(v.text, kind) !== artifactContent(latest?.text ?? '', kind));
  return { current: latest, versions: previous ? [{ revision: previous.revision, savedAt: previous.savedAt, text: previous.text }] : [] };
}

export function artifactContent(text: string, kind: ArtifactKind): string {
  if (kind === 'brand_voice') return text.trim();
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const metadata = new Set(['revision', 'status', 'createdAt', 'updatedAt', 'approvedAt']);
    return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !metadata.has(key)).sort(([a], [b]) => a.localeCompare(b))));
  } catch { return text.trim(); }
}
