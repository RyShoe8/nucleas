import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** Current = orchestrated/direct/all; the rest are legacy values kept for stored rules. */
const modes = [
  'orchestrated',
  'marketing',
  'product',
  'support',
  'engineering',
  'researcher',
  'direct',
  'all',
  'plan',
  'build',
  'research',
] as const;

const schema = new Schema(
  {
    organizationId: { type: String, required: true, immutable: true },
    projectId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    mode: { type: String, enum: modes, required: true, default: 'all' },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 8000 },
    enabled: { type: Boolean, required: true, default: true },
    sortOrder: { type: Number, required: true, default: 0, min: 0, max: 10000 },
    updatedByUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);

schema.index({ organizationId: 1, projectId: 1, sortOrder: 1, _id: 1 });

function modelFor<T>(name: string, definition: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, definition);
}

export type AiProjectTaskRuleDoc = InferSchemaType<typeof schema>;
export const AiProjectTaskRule = modelFor<AiProjectTaskRuleDoc>('AiProjectTaskRule', schema);
export const ideTaskRuleModes = modes;
