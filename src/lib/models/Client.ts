import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import {
  type IPlatformOperationsFields,
  platformOperationsSchemaFields,
} from '@/lib/models/platformFields';

export type ClientStatus = 'active' | 'inactive' | 'lead';
/** client = we work for them; owned = our own property; internal = the operating company itself. */
export type CompanyRelationship = 'client' | 'owned' | 'internal';

export interface IClient extends Document, IPlatformOperationsFields {
  organizationId: Types.ObjectId;
  userIds: Types.ObjectId[];
  /** Internal team members assigned to this client. */
  assignedToEmployeeId?: Types.ObjectId;
  assignedToEmployeeIds?: Types.ObjectId[];
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  domain?: string;
  description?: string;
  color: string;
  status: ClientStatus;
  /** Absent on legacy documents; treat missing as 'client'. */
  relationship?: CompanyRelationship;
  /** Primary project for this company (owned properties). Clients resolve theirs via projectType client-admin. */
  hubProjectId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ClientSchema: Schema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    userIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    assignedToEmployeeId: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
    },
    assignedToEmployeeIds: {
      type: [Schema.Types.ObjectId],
      ref: 'Employee',
      default: [],
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    contactName: {
      type: String,
      trim: true,
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    contactPhone: {
      type: String,
      trim: true,
    },
    domain: {
      type: String,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
    },
    logo: {
      type: String,
      trim: true,
    },
    color: {
      type: String,
      default: '#3b82f6',
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'lead'],
      default: 'active',
    },
    relationship: {
      type: String,
      enum: ['client', 'owned', 'internal'],
    },
    hubProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
    },
    ...platformOperationsSchemaFields,
  },
  {
    timestamps: true,
  }
);

ClientSchema.index({ organizationId: 1, name: 1 });
ClientSchema.index({ assignedToEmployeeIds: 1 });
ClientSchema.index({ clientPortalSlug: 1 }, { sparse: true });
ClientSchema.index({ hubProjectId: 1 }, { unique: true, sparse: true });
ClientSchema.index({ 'techStack.technologyId': 1 });
ClientSchema.index({ 'marketingStack.toolId': 1 });

const Client: Model<IClient> =
  mongoose.models.Client || mongoose.model<IClient>('Client', ClientSchema);

export default Client;
