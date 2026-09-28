import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** An AI provider credential (API key and endpoint). The AI engine lists and picks its models. */

function modelFor<T>(name: string, definition: Schema<T>): Model<T> {
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, definition);
}

const profileSchema = new Schema(
  {
    key: { type: String, required: true, maxlength: 64 },
    label: { type: String, required: true, maxlength: 120 },
    provider: {
      type: String,
      enum: [
        'openai',
        'anthropic',
        'google',
        'groq',
        'deepseek',
        'together',
        'fireworks',
        'openrouter',
        'custom',
      ] as const,
      default: 'custom',
    },
    tier: { type: String, enum: ['commercial', 'local_remote'] as const, required: true },
    protocol: { type: String, enum: ['openai-chat'] as const, required: true, default: 'openai-chat' },
    endpoint: { type: String, required: true, maxlength: 2048 },
    /** Optional default model; the AI engine chooses models per request. Empty is allowed. */
    model: { type: String, required: false, maxlength: 200, default: '' },
    secretCiphertext: { type: String, required: true, maxlength: 16000 },
    secretLast4: { type: String, required: true, maxlength: 8 },
    /** Admin-entered available balance when the provider has no live balance API. */
    manualBalanceMicros: { type: Number, required: false, min: 0, default: null },
    manualBalanceUpdatedAt: { type: Date, required: false, default: null },
    enabled: { type: Boolean, required: true, default: true },
    updatedByUserId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);

profileSchema.index({ key: 1 }, { unique: true });

export type AiModelProfileDoc = InferSchemaType<typeof profileSchema>;
export const AiModelProfile = modelFor<AiModelProfileDoc>('AiModelProfile', profileSchema);
