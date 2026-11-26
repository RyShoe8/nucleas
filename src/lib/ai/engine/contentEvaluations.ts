import 'server-only';
import mongoose, { Schema, Types, type InferSchemaType } from 'mongoose';
import { CONTENT_CASES, CONTENT_SUITE_VERSION, contentScore, type ContentGrade } from '@/lib/ai/eval/contentCases';
import { CONTENT_STANDARD } from '@/lib/ai/research/contentQuality';
import { withItemCap } from '@/lib/ai/control/itemCap';

const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true }, profileId: { type: Schema.Types.ObjectId, required: true },
  model: { type: String, required: true }, need: { type: String, enum: ['write', 'review'], required: true },
  suite: { type: String, required: true }, status: { type: String, enum: ['running', 'awaiting_review', 'reviewed', 'failed'], required: true },
  results: { type: Schema.Types.Mixed, default: [] }, grades: { type: Schema.Types.Mixed }, score: Number,
  costMicros: { type: Number, default: 0 }, costUnknown: Boolean, createdBy: Schema.Types.ObjectId, reviewedBy: Schema.Types.ObjectId, reviewedAt: Date, error: String,
}, { timestamps: true });
schema.index({ organizationId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'running' } });
schema.index({ organizationId: 1, status: 1, reviewedAt: -1 });
export const ContentEvaluation = (mongoose.models.ContentEvaluation as mongoose.Model<InferSchemaType<typeof schema>> | undefined) ?? mongoose.model('ContentEvaluation', schema);
export type ContentModelScore = { need: 'write' | 'review'; score: number; cases: number; reviewedAt: string };
const scoreCache = new Map<string, { at: number; scores: Map<string, ContentModelScore[]> }>();

export async function runContentEvaluation(id: string, userId: string) {
  const run = await ContentEvaluation.findOne({ _id: id, status: 'running' });
  if (!run) return;
  // Dynamic imports keep the selection path free from an evaluation -> chat -> selection cycle.
  const { attemptCompanyCredentialChat } = await import('@/lib/ai/companyChat');
  const { assistantLedgerProjectId } = await import('@/lib/ai/company/assistantLedger');
  const results: { caseId: string; text: string; model: string; costMicros: number | null }[] = [];
  let cost = 0;
  let costUnknown = false;
  try {
    await withItemCap('content model evaluation', async () => {
      for (const item of CONTENT_CASES) {
        if (!await ContentEvaluation.exists({ _id: id, status: 'running' })) return;
        const reply = await attemptCompanyCredentialChat({
          organizationId: String(run.organizationId), userId, projectId: assistantLedgerProjectId(String(run.organizationId)),
          modelProfileId: String(run.profileId), model: run.model, standIn: false,
          systemPrompt: CONTENT_STANDARD + (run.need === 'review' ? '\nReview the draft against the supplied original evidence. Identify every factual problem, missing qualification and needed improvement. Do not assume the draft is correct.' : '\nWrite the requested content from the supplied original evidence. Keep it under 450 words; make it specific and useful.'),
          userText: `${item.brief}\n\nOriginal evidence (fixture):\n${item.source}${run.need === 'review' ? `\n\nDraft to review:\n${item.flawed}` : ''}`,
          priorTurns: [], includeRepoTools: false, includeImageTool: false, toolProfile: 'none', forcePlain: true,
          disableLookupAssist: true,
          stopOnUpstreamFailure: true, maxOutputTokensOverride: 2400, signal: AbortSignal.timeout(65_000),
        });
        cost += reply.costMicros ?? 0;
        costUnknown ||= reply.costMicros === null || reply.costMicros === undefined;
        if (reply.role !== 'assistant') throw new Error(reply.text.slice(0, 500));
        if (reply.standInFor || (reply.model && reply.model !== run.model)) throw new Error('A substitute model answered; this run cannot score the requested model.');
        results.push({ caseId: item.id, text: reply.text, model: reply.model ?? run.model, costMicros: reply.costMicros ?? null });
        await ContentEvaluation.updateOne({ _id: id, status: 'running' }, { $set: { results, costMicros: cost, costUnknown } });
      }
    });
    await ContentEvaluation.updateOne({ _id: id, status: 'running' }, { $set: { status: 'awaiting_review' } });
  } catch (error) {
    await ContentEvaluation.updateOne({ _id: id, status: 'running' }, { $set: { status: 'failed', results, costMicros: cost, costUnknown, error: error instanceof Error ? error.message : 'Evaluation failed.' } });
  }
}

export async function gradeContentEvaluation(organizationId: string, id: string, userId: string, grades: ContentGrade[]) {
  const run = await ContentEvaluation.findOne({ _id: id, organizationId, status: 'awaiting_review', suite: CONTENT_SUITE_VERSION }).lean();
  if (!run || !Array.isArray(run.results) || run.results.length !== CONTENT_CASES.length) return false;
  if (grades.length !== CONTENT_CASES.length || CONTENT_CASES.some(c => grades.filter(g => g.caseId === c.id).length !== 1)) return false;
  if (grades.some(g => ![g.factuality, g.coverage, g.voice, g.originality].every(n => Number.isInteger(n) && n >= 0 && n <= 4) || typeof g.criticalError !== 'boolean' || g.notes.trim().length < 3)) return false;
  const result = await ContentEvaluation.updateOne({ _id: id, organizationId, status: 'awaiting_review' }, { $set: { grades, score: contentScore(grades), reviewedBy: new Types.ObjectId(userId), reviewedAt: new Date(), status: 'reviewed' } });
  scoreCache.delete(`${mongoose.connection.name}:${organizationId}`);
  return result.modifiedCount === 1;
}

/** Only an administrator's completed review can influence routing; model self-grades never do. */
export async function contentModelScores(organizationId: string): Promise<Map<string, ContentModelScore[]>> {
  const result = new Map<string, ContentModelScore[]>();
  if (mongoose.connection.readyState !== 1) return result;
  const key = `${mongoose.connection.name}:${organizationId}`, cached = scoreCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.scores;
  const rows = await ContentEvaluation.find({ organizationId, status: 'reviewed', suite: CONTENT_SUITE_VERSION, reviewedBy: { $exists: true }, reviewedAt: { $gte: new Date(Date.now() - 90 * 86_400_000), $lte: new Date() } })
    .sort({ reviewedAt: -1 }).limit(150).select('profileId model need score reviewedAt').lean();
  for (const r of rows) {
    const key = `${r.profileId}:${r.model}`, scores = result.get(key) ?? [];
    if (scores.some(s => s.need === r.need) || typeof r.score !== 'number' || !Number.isFinite(r.score) || !r.reviewedAt) continue;
    scores.push({ need: r.need as 'write' | 'review', score: r.score, cases: CONTENT_CASES.length, reviewedAt: r.reviewedAt.toISOString() }); result.set(key, scores);
  }
  if (scoreCache.size >= 100) scoreCache.delete(scoreCache.keys().next().value!);
  scoreCache.set(key, { at: Date.now(), scores: result });
  return result;
}
