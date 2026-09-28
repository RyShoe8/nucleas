import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import { AiHttpError } from '@/lib/ai/control/access';
import { aiError, aiResponse, readAiBody } from '@/lib/ai/control/http';
import { encryptModelSecret, secretLast4 } from '@/lib/ai/modelSecrets';
import { modelProfilePatchSchema } from '@/lib/ai/rolePipeline/schemas';
import { mapModelProfilePublic } from '@/lib/ai/rolePipeline/profiles';
import { clearProviderBalanceCache } from '@/lib/ai/rolePipeline/providerBalance';
import { AiModelProfile } from '@/lib/models/AiModelProfile';
import connectDB from '@/lib/db/mongodb';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const auth = await requirePlatformAdmin();
  if (auth.error) return auth.error;
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new AiHttpError(403, 'Invalid request origin.');
    }
    const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) throw new AiHttpError(404, 'Model profile not found.');
    await connectDB();
    const input = modelProfilePatchSchema.parse(await readAiBody(request));
    const $set: Record<string, unknown> = { updatedByUserId: auth.user!._id };
    if (input.label !== undefined) $set.label = input.label;
    if (input.tier !== undefined) $set.tier = input.tier;
    if (input.endpoint !== undefined) $set.endpoint = input.endpoint;
    if (input.model !== undefined) $set.model = input.model;
    if (input.enabled !== undefined) $set.enabled = input.enabled;
    if (input.manualBalanceMicros !== undefined) {
      $set.manualBalanceMicros = input.manualBalanceMicros;
      $set.manualBalanceUpdatedAt = input.manualBalanceMicros == null ? null : new Date();
    }
    if (input.apiKey !== undefined) {
      $set.secretCiphertext = encryptModelSecret(input.apiKey);
      $set.secretLast4 = secretLast4(input.apiKey);
    }
    const row = await AiModelProfile.findByIdAndUpdate(id, { $set }, { new: true, runValidators: true });
    if (!row) throw new AiHttpError(404, 'Model profile not found.');
    if (input.manualBalanceMicros !== undefined) clearProviderBalanceCache(id);
    return aiResponse({ profile: mapModelProfilePublic(row) });
  } catch (error) {
    return aiError(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = await requirePlatformAdmin();
  if (auth.error) return auth.error;
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new AiHttpError(403, 'Invalid request origin.');
    }
    const { id } = await context.params;
    if (!Types.ObjectId.isValid(id)) throw new AiHttpError(404, 'Model profile not found.');
    await connectDB();
    const deleted = await AiModelProfile.findByIdAndDelete(id);
    if (!deleted) throw new AiHttpError(404, 'Model profile not found.');
    return aiResponse({ ok: true });
  } catch (error) {
    return aiError(error);
  }
}
