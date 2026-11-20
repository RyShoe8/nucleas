import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
import { TEAM_ROLES } from '@/lib/companies/teamRoles';

const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  role: { type: String, enum: TEAM_ROLES, required: true },
  active: { type: Boolean, default: undefined },
  displayName: { type: String, maxlength: 60 },
  identityName: { type: String, maxlength: 60 },
  specialty: { type: String, maxlength: 120 },
  reviewerEmployeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  remit: { type: String, maxlength: 2000, required: true },
  lessons: { type: String, maxlength: 4000, default: '' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
schema.index({ organizationId: 1, companyId: 1, role: 1 }, { unique: true });
schema.index({ organizationId: 1, identityName: 1 }, { unique: true, partialFilterExpression: { identityName: { $type: 'string' } } });
export type CompanyTeamDoc = InferSchemaType<typeof schema>;
export const CompanyTeam: Model<CompanyTeamDoc> = (mongoose.models.CompanyTeam as Model<CompanyTeamDoc> | undefined) ?? mongoose.model<CompanyTeamDoc>('CompanyTeam', schema);
