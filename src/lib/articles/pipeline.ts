import 'server-only';
import { Types } from 'mongoose';
import { ArticleDraft } from '@/lib/models/ArticleDraft';
import { BrandVoice } from '@/lib/models/BrandVoice';
import { analyzeGenericity, enforceTaboos, extractStyleKit, fidelityRetryIssues, findAiPhrases, measureStyle, plainText, scoreFidelity, styleRulesFromProfile, AI_PHRASES, type StyleProfile } from './style';
import type { Need } from '@/lib/ai/engine/select';

/**
 * Article pipeline: research -> outline -> draft -> polish. Each stage is checkpointed on the ArticleDraft so a
 * cut-off run resumes at the stage it stopped. Every model call goes through `deps.ask`, so the organization's
 * AI engine settings pick the model for each need (research/plan/write/utility), and every article is written
 * from the company's approved Voice: persona + measured style profile + passages from its own writing.
 */

export const MIN_FIDELITY = 72;
export const MAX_GENERICITY = 25;
export const MAX_ATTEMPTS = 3;
const RUN_BUDGET_MS = 240_000;
const LEASE_MS = 300_000;

export interface ArticleDeps {
  ask(input: { need: Need; organizationId: string; userId: string; system: string; user: string; maxTokens: number }): Promise<{ text: string; model: string } | null>;
  search(query: string): Promise<{ title: string; url: string; text: string }[]>;
  fetchPage(url: string): Promise<{ title: string; text: string } | null>;
}

interface VoiceInputs {
  persona: string;
  revision: number;
  profile: StyleProfile;
  kitText: string;
}

const GLOBAL_RULES = ['No emojis.', 'No em dashes or en dashes. Use commas or periods.', 'No exclamation-mark hype.', 'Never invent facts, numbers, names, quotes or sources. Use only the facts provided.'];

function samplesFrom(examples: string): string[] {
  const text = examples.trim();
  if (!text) return [];
  const parts = text.split(/\n\s*-{3,}\s*\n/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [text];
}

export function buildVoiceInputs(voice: { persona?: string | null; examples?: string | null; revision?: number | null }): VoiceInputs {
  const samples = samplesFrom(voice.examples ?? '');
  const profile = measureStyle(samples);
  const kit = extractStyleKit(samples);
  const kitText = [
    kit.openings.length ? `How this company opens a piece:\n${kit.openings.map((p) => `> ${p}`).join('\n')}` : '',
    kit.signatures.length ? `Paragraphs that sound most like this company:\n${kit.signatures.map((p) => `> ${p}`).join('\n')}` : '',
    kit.details.length ? `Concrete details it likes to state (texture only; use them only if they are true for this article):\n${kit.details.map((d) => `- ${d}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  return { persona: voice.persona ?? '', revision: voice.revision ?? 0, profile, kitText };
}

function writerSystem(voice: VoiceInputs): string {
  const rules = styleRulesFromProfile(voice.profile);
  return [
    voice.persona.trim(),
    rules.length ? `STYLE, measured from this company's own writing:\n${rules.map((r) => `- ${r}`).join('\n')}` : '',
    voice.kitText ? `${voice.kitText}\n\nMatch their cadence and word choice. Never copy their sentences.` : '',
    `HARD RULES:\n${GLOBAL_RULES.map((r) => `- ${r}`).join('\n')}`,
    `Never use these stock phrases: ${AI_PHRASES.slice(0, 30).map((p) => `"${p}"`).join(', ')}.`,
    'Write like a person with something to say, not a template. Vary sentence length. Prefer concrete specifics to general claims. Start sections with the point, not a lead-in.',
  ].filter(Boolean).join('\n\n');
}

export function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

const trimTo = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/* ------------------------------ stages ------------------------------ */

async function researchStage(doc: ArticleRecord, deps: ArticleDeps, ctx: Ctx) {
  const pages: { title: string; url: string; text: string }[] = [];
  const planned = await deps.ask({
    need: 'utility', ...ctx.who, maxTokens: 300,
    system: 'You plan web research for an article. Reply with JSON only: {"queries": string[]} with 2 or 3 specific search queries.',
    user: `Topic: ${doc.topic}\n${doc.notes ? `Direction: ${doc.notes}` : ''}`,
  });
  ctx.note(planned?.model);
  const queries = (parseJson<{ queries?: string[] }>(planned?.text)?.queries ?? [doc.topic]).filter((q) => typeof q === 'string' && q.trim()).slice(0, 3);
  for (const q of queries.length ? queries : [doc.topic]) {
    try { pages.push(...(await deps.search(q))); } catch { /* a failed search just means fewer sources */ }
  }
  for (const url of doc.referenceUrls ?? []) {
    try {
      const page = await deps.fetchPage(url);
      if (page?.text) pages.unshift({ title: page.title || url, url, text: page.text });
    } catch { /* unreachable reference pages are skipped */ }
  }
  const unique = [...new Map(pages.filter((p) => p.text.trim().length > 80).map((p) => [p.url, p])).values()].slice(0, 8);
  if (!unique.length) {
    doc.facts = [];
    doc.sourcesUsed = [];
    doc.researchNote = 'No web sources were found, so the article stays general and avoids specific claims.';
    return;
  }
  const material = unique.map((p, i) => `[${i + 1}] ${p.title} (${p.url})\n${trimTo(p.text, 3500)}`).join('\n\n');
  const out = await deps.ask({
    need: 'research', ...ctx.who, maxTokens: 2500,
    system: 'Extract the facts an article on this topic can safely use from the sources. Reply with JSON only: {"facts": [{"text": string, "source": string}]}. At most 20 facts. Each fact is one self-contained sentence copied or closely paraphrased from a source, with that source\'s URL. Skip opinions, ads and anything uncertain. Never add facts that are not in the sources.',
    user: `Topic: ${doc.topic}\n\nSources:\n${material}`,
  });
  ctx.note(out?.model);
  const facts = parseJson<{ facts?: { text?: string; source?: string }[] }>(out?.text)?.facts ?? [];
  const known = new Set(unique.map((p) => p.url));
  doc.facts = facts
    .filter((f) => typeof f.text === 'string' && f.text.trim())
    .slice(0, 20)
    .map((f) => ({ text: String(f.text).trim().slice(0, 600), source: known.has(String(f.source)) ? String(f.source) : (unique[0]?.url ?? '') }));
  doc.sourcesUsed = [...new Set(doc.facts.map((f) => f.source).filter(Boolean))].slice(0, 12);
  doc.researchNote = doc.facts.length ? `${doc.facts.length} facts from ${doc.sourcesUsed.length} source${doc.sourcesUsed.length === 1 ? '' : 's'}.` : 'Sources were found but held no usable facts; the article stays general.';
}

async function outlineStage(doc: ArticleRecord, deps: ArticleDeps, ctx: Ctx) {
  const rules = styleRulesFromProfile(ctx.voice.profile).filter((r) => /Heading/.test(r)).join(' ');
  const out = await deps.ask({
    need: 'plan', ...ctx.who, maxTokens: 1500,
    system: `You outline articles in the voice of a specific company. Reply with JSON only: {"title": string, "angle": string, "sections": [{"heading": string, "points": string[]}]}. 4 to 7 sections for a ${doc.targetWords} word article. Each point is something concrete the section will say, drawn from the facts when possible. ${rules} ${doc.faq ? 'Make the last section "FAQ" with the questions readers actually ask as its points.' : ''}\n\n${ctx.voice.persona.slice(0, 3000)}`,
    user: [`Topic: ${doc.topic}`, doc.notes ? `Direction: ${doc.notes}` : '', doc.facts.length ? `Facts:\n${doc.facts.map((f) => `- ${f.text}`).join('\n')}` : 'No researched facts are available; keep points general.'].filter(Boolean).join('\n\n'),
  });
  ctx.note(out?.model);
  const parsed = parseJson<{ title?: string; angle?: string; sections?: { heading?: string; points?: string[] }[] }>(out?.text);
  const sections = (parsed?.sections ?? []).filter((s) => typeof s.heading === 'string' && s.heading.trim()).slice(0, 8);
  if (!sections.length) throw new Error('The outline step returned nothing usable. Try again.');
  doc.title = trimTo(String(parsed?.title ?? doc.topic).trim() || doc.topic, 200);
  doc.angle = String(parsed?.angle ?? '').slice(0, 500);
  doc.outline = sections.map((s) => ({ heading: String(s.heading).trim().slice(0, 160), points: (s.points ?? []).filter((p) => typeof p === 'string').map((p) => p.slice(0, 300)).slice(0, 8) }));
}

function draftUser(doc: ArticleRecord): string {
  return [
    `Write the article "${doc.title}".`,
    doc.angle ? `Angle: ${doc.angle}` : '',
    `Length: about ${doc.targetWords} words.`,
    `Outline:\n${doc.outline.map((s, i) => `${i + 1}. ${s.heading}\n${s.points.map((p) => `   - ${p}`).join('\n')}`).join('\n')}`,
    doc.facts.length ? `Facts you may use (nothing else may be stated as fact):\n${doc.facts.map((f) => `- ${f.text}`).join('\n')}` : 'There are no researched facts. Write from the angle and general knowledge only, and make no specific numerical or named claims.',
    doc.links.length ? `Work these links in naturally, each once, as markdown links inside paragraphs where they are relevant (never bunched at the end):\n${doc.links.map((l) => `- ${l.url}${l.anchor ? ` (anchor text: ${l.anchor})` : ''}`).join('\n')}` : '',
    doc.notes ? `Direction from the editor: ${doc.notes}` : '',
    'Format: markdown. Start with "# " and the title, then "## " section headings. Return only the article.',
  ].filter(Boolean).join('\n\n');
}

function cleanArticle(raw: string): string {
  let text = raw.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
  text = enforceTaboos(text);
  return text;
}

export interface Assessment { fidelity: number; measured: boolean; genericity: number; words: number; issues: string[]; score: number }

export function assess(markdown: string, voice: VoiceInputs, doc: { targetWords: number; links: { url: string; anchor?: string | null }[] }): Assessment {
  const fidelity = scoreFidelity(markdown, voice.profile);
  const generic = analyzeGenericity(markdown);
  const words = plainText(markdown).split(/\s+/).filter(Boolean).length;
  const issues: string[] = [];
  // Hard requirements first so the issue cap never hides them.
  if (words < doc.targetWords * 0.7) issues.push(`Too short: ${words} words, aim for about ${doc.targetWords}.`);
  if (words > doc.targetWords * 1.35) issues.push(`Too long: ${words} words, aim for about ${doc.targetWords}.`);
  const missing = doc.links.filter((l) => !markdown.includes(l.url));
  for (const l of missing) issues.push(`The link ${l.url} is missing. Work it into a relevant paragraph${l.anchor ? ` with the anchor text "${l.anchor}"` : ''}.`);
  const phrases = findAiPhrases(plainText(markdown));
  for (const p of phrases) issues.push(`Remove the stock phrase "${p}".`);
  issues.push(...fidelityRetryIssues(fidelity, MIN_FIDELITY));
  if (generic.score > MAX_GENERICITY) issues.push(...generic.issues.filter((i) => !i.startsWith('Stock phrase')));
  const fidelityPart = fidelity.measured ? fidelity.score : 70;
  const score = Math.round(fidelityPart * 0.5 + (100 - generic.score) * 0.5 - missing.length * 15 - (words < doc.targetWords * 0.7 || words > doc.targetWords * 1.35 ? 10 : 0));
  return { fidelity: fidelity.score, measured: fidelity.measured, genericity: generic.score, words, issues: [...new Set(issues)].slice(0, 10), score };
}

async function draftStage(doc: ArticleRecord, deps: ArticleDeps, ctx: Ctx) {
  const system = writerSystem(ctx.voice);
  let best = { text: '', a: null as Assessment | null };
  let candidate = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const revising = attempt > 1 && candidate;
    ctx.progress(revising ? `Polishing for the brand voice (pass ${attempt - 1} of ${MAX_ATTEMPTS - 1})` : 'Writing the draft');
    const out = await deps.ask({
      need: 'write', ...ctx.who, maxTokens: Math.min(8000, Math.round(doc.targetWords * 2.4) + 800), system,
      user: revising
        ? `${draftUser(doc)}\n\nYour previous draft is below. It has these problems:\n${(best.a?.issues ?? []).map((i) => `- ${i}`).join('\n')}\n\nRewrite the whole article so it fixes every problem while keeping the facts and structure. Make it sound like the company's own writing, not like a rewrite. Return only the article.\n\nPREVIOUS DRAFT:\n${candidate}`
        : draftUser(doc),
    });
    ctx.note(out?.model);
    if (!out?.text.trim()) {
      if (attempt === 1) throw new Error('The writing model returned nothing. Try again.');
      break;
    }
    candidate = cleanArticle(out.text);
    const a = assess(candidate, ctx.voice, doc);
    doc.attempts.push({ n: attempt, words: a.words, fidelity: a.fidelity, genericity: a.genericity, issues: a.issues.slice(0, 6), model: out.model });
    if (!best.a || a.score > best.a.score) best = { text: candidate, a };
    doc.body = best.text;
    await ctx.save();
    if (!a.issues.length) break;
    candidate = best.text;
    if (Date.now() > ctx.deadline) { doc.warnings.push('Stopped polishing early to stay inside the time budget.'); break; }
  }
  const a = best.a!;
  doc.body = best.text;
  doc.fidelity = a.fidelity;
  doc.fidelityMeasured = a.measured;
  doc.genericity = a.genericity;
  if (!a.measured) doc.warnings.push('This Voice has no writing samples, so style could not be measured. Add samples in Voice for a closer match.');
  else if (a.fidelity < MIN_FIDELITY) doc.warnings.push(`Voice match is ${a.fidelity}/100, under the ${MIN_FIDELITY} target. Edit by hand or add more writing samples to Voice.`);
  if (a.genericity > MAX_GENERICITY) doc.warnings.push(`Still reads a little generic (${a.genericity}/100). ${a.issues.slice(0, 2).join(' ')}`);
  for (const l of doc.links) if (!best.text.includes(l.url)) doc.warnings.push(`Link not placed: ${l.url}`);
  if (!doc.facts.length) doc.warnings.push(doc.researchNote ?? 'No researched facts were available. Check specifics before publishing.');
}

async function metaStage(doc: ArticleRecord, deps: ArticleDeps, ctx: Ctx) {
  const out = await deps.ask({
    need: 'utility', ...ctx.who, maxTokens: 120,
    system: 'Write a meta description of at most 155 characters for this article. Plain sentence, no quotes, no emoji, no dashes. Return only the description.',
    user: trimTo(plainText(doc.body), 3000),
  }).catch(() => null);
  ctx.note(out?.model);
  const fallback = trimTo(plainText(doc.body).split(/(?<=[.!?])\s/)[0] ?? '', 155);
  doc.metaDescription = enforceTaboos((out?.text.trim() || fallback).replace(/^["']|["']$/g, '')).slice(0, 160);
}

/* ------------------------------ runner ------------------------------ */

/** The fields the pipeline reads and writes, typed plainly (Mongoose's subdocument array types fight plain assignment). */
interface ArticleRecord {
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  topic: string;
  notes: string;
  targetWords: number;
  faq: boolean;
  referenceUrls: string[];
  links: { url: string; anchor?: string | null }[];
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: 'research' | 'outline' | 'draft' | 'polish' | 'done';
  progress: string;
  error?: string | null;
  leaseUntil?: Date | null;
  facts: { text: string; source: string }[];
  sourcesUsed: string[];
  researchNote?: string;
  title: string;
  angle: string;
  outline: { heading: string; points: string[] }[];
  body: string;
  metaDescription: string;
  attempts: { n: number; words: number; fidelity: number; genericity: number; issues: string[]; model: string }[];
  fidelity?: number;
  fidelityMeasured: boolean;
  genericity?: number;
  warnings: string[];
  voiceRevision?: number;
  modelPath: string[];
  save(): Promise<unknown>;
}
interface Ctx {
  who: { organizationId: string; userId: string };
  voice: VoiceInputs;
  deadline: number;
  note(model?: string): void;
  progress(text: string): void;
  save(): Promise<void>;
}

/**
 * Runs the article from its current stage. Safe to call again after any interruption; a lease keeps two
 * runs from working on the same article. Returns the final status.
 */
export async function advanceArticle(articleId: string | Types.ObjectId, deps: ArticleDeps): Promise<'done' | 'failed' | 'queued' | 'busy' | 'missing'> {
  const now = new Date();
  const doc = await ArticleDraft.findOneAndUpdate(
    { _id: articleId, status: { $in: ['queued', 'running', 'failed'] }, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lt: now } }] },
    { $set: { status: 'running', error: null, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
    { new: true }
  ) as unknown as ArticleRecord | null;
  if (!doc) return (await ArticleDraft.exists({ _id: articleId })) ? 'busy' : 'missing';

  const startedAt = Date.now();
  const voiceDoc = await BrandVoice.findOne({ organizationId: doc.organizationId, companyId: doc.companyId, status: 'approved' }).select('persona examples revision').lean<{ persona?: string; examples?: string; revision?: number }>();
  if (!voiceDoc?.persona?.trim()) {
    doc.status = 'failed';
    doc.error = 'Approve this company’s Voice first, so the article sounds like the brand.';
    doc.leaseUntil = null;
    await doc.save();
    return 'failed';
  }
  const voice = buildVoiceInputs(voiceDoc);
  doc.voiceRevision = voice.revision;
  const ctx: Ctx = {
    who: { organizationId: String(doc.organizationId), userId: String(doc.createdByUserId) },
    voice,
    deadline: startedAt + RUN_BUDGET_MS,
    note: (model) => { if (model && doc.modelPath[doc.modelPath.length - 1] !== model) doc.modelPath.push(model); },
    progress: (text) => { doc.progress = text; },
    save: async () => { doc.leaseUntil = new Date(Date.now() + LEASE_MS); await doc.save(); },
  };

  try {
    if (doc.stage === 'research') {
      ctx.progress('Researching');
      await ctx.save();
      await researchStage(doc, deps, ctx);
      doc.stage = 'outline';
      await ctx.save();
    }
    if (doc.stage === 'outline') {
      ctx.progress('Outlining');
      await ctx.save();
      await outlineStage(doc, deps, ctx);
      doc.stage = 'draft';
      await ctx.save();
    }
    if (doc.stage === 'draft') {
      if (Date.now() > ctx.deadline) return await park(doc);
      doc.attempts = [];
      doc.warnings = [];
      await draftStage(doc, deps, ctx);
      doc.stage = 'polish';
      await ctx.save();
    }
    if (doc.stage === 'polish') {
      ctx.progress('Finishing');
      await metaStage(doc, deps, ctx);
      doc.stage = 'done';
    }
    doc.status = 'done';
    doc.progress = 'Done';
    doc.leaseUntil = null;
    await doc.save();
    return 'done';
  } catch (err) {
    doc.status = 'failed';
    doc.error = (err instanceof Error ? err.message : 'The article run failed.').slice(0, 500);
    doc.leaseUntil = null;
    await doc.save().catch(() => undefined);
    return 'failed';
  }
}

async function park(doc: ArticleRecord): Promise<'queued'> {
  doc.status = 'queued';
  doc.progress = 'Paused to stay inside the time limit. It will continue shortly.';
  doc.leaseUntil = null;
  await doc.save();
  return 'queued';
}

/** Articles whose run was cut off (lease expired mid-run) or parked: resume them. Called from the cron. */
export async function resumeStaleArticles(deps: ArticleDeps, limit = 3): Promise<number> {
  const now = new Date();
  const rows = await ArticleDraft.find({ $or: [{ status: 'queued' }, { status: 'running', leaseUntil: { $lt: now } }], archived: false }).sort({ updatedAt: 1 }).limit(limit).select('_id').lean<{ _id: Types.ObjectId }[]>();
  for (const row of rows) await advanceArticle(row._id, deps);
  return rows.length;
}
