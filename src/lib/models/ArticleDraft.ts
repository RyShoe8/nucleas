import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * An article being written (or written) in a company's Voice. The pipeline checkpoints each stage on the
 * document so a run that is cut off (timeout, deploy) resumes where it stopped instead of starting over.
 */
const factSchema = new Schema({ text: { type: String, maxlength: 600 }, source: { type: String, maxlength: 600 } }, { _id: false });
const sectionSchema = new Schema({ heading: { type: String, maxlength: 200 }, points: { type: [String], default: [] } }, { _id: false });
const linkSchema = new Schema({ url: { type: String, maxlength: 2000 }, anchor: { type: String, maxlength: 200 } }, { _id: false });
const attemptSchema = new Schema(
  { n: Number, words: Number, fidelity: Number, genericity: Number, issues: { type: [String], default: [] }, model: String },
  { _id: false }
);

const schema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    createdByUserId: { type: Schema.Types.ObjectId, required: true },
    topic: { type: String, required: true, maxlength: 300 },
    /** Optional direction from the person: angle, audience, must-cover points. */
    notes: { type: String, default: '', maxlength: 3000 },
    targetWords: { type: Number, default: 900 },
    faq: { type: Boolean, default: false },
    /** Pages the person wants used as source material. */
    referenceUrls: { type: [String], default: [] },
    /** Links that must appear in the article, woven in naturally. */
    links: { type: [linkSchema], default: [] },
    status: { type: String, enum: ['queued', 'running', 'done', 'failed'], default: 'queued' },
    stage: { type: String, enum: ['research', 'outline', 'draft', 'polish', 'done'], default: 'research' },
    progress: { type: String, default: 'Waiting to start', maxlength: 300 },
    error: { type: String, maxlength: 600 },
    leaseUntil: { type: Date },
    facts: { type: [factSchema], default: [] },
    sourcesUsed: { type: [String], default: [] },
    researchNote: { type: String, maxlength: 400 },
    title: { type: String, default: '', maxlength: 300 },
    angle: { type: String, default: '', maxlength: 600 },
    outline: { type: [sectionSchema], default: [] },
    body: { type: String, default: '', maxlength: 60000 },
    metaDescription: { type: String, default: '', maxlength: 400 },
    attempts: { type: [attemptSchema], default: [] },
    fidelity: { type: Number },
    fidelityMeasured: { type: Boolean, default: false },
    genericity: { type: Number },
    warnings: { type: [String], default: [] },
    voiceRevision: { type: Number },
    /** Models that did the work, in order, for the run-cost trail. */
    modelPath: { type: [String], default: [] },
    archived: { type: Boolean, default: false },
    /** digest: a newsletter or roundup a watch wrote from its flagged emails. */
    kind: { type: String, enum: ['article', 'digest'], default: 'article' },
    watchId: { type: Schema.Types.ObjectId },
    digestItemIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true }
);
schema.index({ organizationId: 1, companyId: 1, createdAt: -1 });
schema.index({ status: 1, leaseUntil: 1 });
export type ArticleDraftDoc = InferSchemaType<typeof schema>;
export const ArticleDraft: Model<ArticleDraftDoc> = (mongoose.models.ArticleDraft as Model<ArticleDraftDoc> | undefined) ?? mongoose.model<ArticleDraftDoc>('ArticleDraft', schema);
