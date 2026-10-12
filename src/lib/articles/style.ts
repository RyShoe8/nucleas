/**
 * Style matching engine (pure, deterministic, no model calls).
 *
 * Ported from Content Intelligence's voice profile / fidelity / blacklist modules and adapted to markdown text.
 * It measures how the company's own writing sounds (person, paragraph rhythm, heading style, fragments, lists,
 * bold) and then scores a draft against that measurement, so "sounds like the brand" is a number rather than a
 * hope. It also flags the stock phrases and punctuation habits that make text read as machine written.
 */

export type VoicePerson = 'first_plural' | 'first_singular' | 'second' | 'third';
export type HeadingStyle = 'punchy' | 'descriptive' | 'question' | 'textbook';

export interface StyleProfile {
  person: VoicePerson;
  avgParagraphWords: number;
  shortParagraphShare: number;
  avgSentenceWords: number;
  /** Spread of sentence lengths (standard deviation, in words). Human writing varies more than model writing. */
  sentenceWordSpread: number;
  headingStyle: HeadingStyle;
  headingAvgWords: number;
  usesFragments: boolean;
  usesBold: boolean;
  listShare: number;
  headingSamples: string[];
  sampleCount: number;
}

export interface FidelityComponent { name: string; score: number; weight: number; detail: string }
export interface FidelityResult { score: number; measured: boolean; components: FidelityComponent[]; issues: string[] }

const SHORT_PARAGRAPH_WORDS = 12;

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** Markdown/plain text -> structural blocks. Headings are lines starting with #; list items start with -, * or "1.". */
export function splitBlocks(text: string): { headings: string[]; paragraphs: string[]; listItems: number } {
  const headings: string[] = [];
  const paragraphs: string[] = [];
  let listItems = 0;
  for (const raw of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;
    const lines = block.split('\n');
    if (/^#{1,6}\s/.test(lines[0]!)) {
      headings.push(lines[0]!.replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').trim());
      const rest = lines.slice(1).join(' ').trim();
      if (rest) paragraphs.push(rest);
      continue;
    }
    if (lines.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l))) {
      listItems += lines.length;
      continue;
    }
    paragraphs.push(lines.join(' ').trim());
  }
  return { headings, paragraphs, listItems };
}

export const plainText = (markdown: string) =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function splitSentences(plain: string): string[] {
  return plain.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function detectPerson(plain: string): VoicePerson {
  const total = words(plain).length;
  if (total < 20) return 'third';
  const count = (re: RegExp) => (plain.match(re) ?? []).length;
  const ranked: [VoicePerson, number][] = [
    ['first_plural', count(/\b(?:we|our|ours|us)\b/gi)],
    ['first_singular', count(/\b(?:i|my|mine|me)\b/g)],
    ['second', count(/\b(?:you|your|yours)\b/gi)],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const [person, n] = ranked[0]!;
  return n / total >= 0.004 ? person : 'third';
}

const TEXTBOOK_HEADING = /^(understanding|introduction to|overview of|the (?:impact|importance|role|benefits) of|benefits of|challenges|considerations|key takeaways|looking ahead|final thoughts|in conclusion|conclusion)\b/i;

export function detectHeadingStyle(headings: string[]): { style: HeadingStyle; avgWords: number } {
  if (!headings.length) return { style: 'descriptive', avgWords: 0 };
  const avgWords = headings.reduce((n, h) => n + words(h).length, 0) / headings.length;
  const questions = headings.filter((h) => h.trim().endsWith('?')).length / headings.length;
  const textbook = headings.filter((h) => TEXTBOOK_HEADING.test(h.trim())).length / headings.length;
  if (textbook >= 0.3) return { style: 'textbook', avgWords };
  if (questions >= 0.3) return { style: 'question', avgWords };
  return { style: avgWords <= 5 ? 'punchy' : 'descriptive', avgWords };
}

const hasFragmentRun = (plain: string) => splitSentences(plain).some((s) => {
  const n = words(s).length;
  return n >= 1 && n <= 4 && /[.!?]$/.test(s);
});

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Measure how the given writing samples sound. Returns sampleCount 0 when there is nothing usable. */
export function measureStyle(samples: string[]): StyleProfile {
  const docs = samples.map((s) => s.trim()).filter((s) => words(s).length >= 20);
  const empty: StyleProfile = { person: 'third', avgParagraphWords: 0, shortParagraphShare: 0, avgSentenceWords: 0, sentenceWordSpread: 0, headingStyle: 'descriptive', headingAvgWords: 0, usesFragments: false, usesBold: false, listShare: 0, headingSamples: [], sampleCount: 0 };
  if (!docs.length) return empty;
  const paragraphs: string[] = [];
  const headings: string[] = [];
  let listItems = 0;
  let bold = false;
  for (const doc of docs) {
    const blocks = splitBlocks(doc);
    paragraphs.push(...blocks.paragraphs);
    headings.push(...blocks.headings);
    listItems += blocks.listItems;
    if (/(\*\*|__)[^*_\n]+\1/.test(doc.replace(/^#{1,6}.*$/gm, '')) || /<(?:strong|b)\b/i.test(doc)) bold = true;
  }
  if (!paragraphs.length) return empty;
  const counts = paragraphs.map((p) => words(plainText(p)).length);
  const sentenceLengths = splitSentences(plainText(paragraphs.join(' '))).map((s) => words(s).length);
  const avgSentence = sentenceLengths.length ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length : 0;
  const spread = sentenceLengths.length ? Math.sqrt(sentenceLengths.reduce((a, b) => a + (b - avgSentence) ** 2, 0) / sentenceLengths.length) : 0;
  const heading = detectHeadingStyle(headings);
  const blocks = paragraphs.length + listItems;
  return {
    person: detectPerson(plainText(paragraphs.join(' '))),
    avgParagraphWords: round1(counts.reduce((a, b) => a + b, 0) / counts.length),
    shortParagraphShare: Math.round((counts.filter((n) => n <= SHORT_PARAGRAPH_WORDS).length / counts.length) * 100) / 100,
    avgSentenceWords: round1(avgSentence),
    sentenceWordSpread: round1(spread),
    headingStyle: heading.style,
    headingAvgWords: round1(heading.avgWords),
    usesFragments: paragraphs.some((p) => hasFragmentRun(plainText(p))),
    usesBold: bold,
    listShare: blocks ? Math.round((listItems / blocks) * 100) / 100 : 0,
    headingSamples: [...new Set(headings)].slice(0, 8),
    sampleCount: docs.length,
  };
}

const PERSON_LABEL: Record<VoicePerson, string> = { first_plural: 'first-person plural ("we")', first_singular: 'first-person singular ("I")', second: 'second person ("you")', third: 'third person' };

const ratioScore = (actual: number, target: number, tolerance: number) => {
  const diff = Math.abs(actual - target);
  if (diff <= tolerance) return 100;
  return Math.max(0, Math.round(100 - ((diff - tolerance) / Math.max(tolerance, 0.0001)) * 50));
};
const magnitudeScore = (actual: number, target: number) => {
  if (target <= 0) return 100;
  return Math.max(0, Math.round(100 - Math.abs(Math.log(Math.max(actual / target, 0.01))) * 90));
};
const boolScore = (a: boolean, t: boolean) => (a === t ? 100 : 40);

/** Deterministic 0-100 score for how closely a draft matches the measured style. */
export function scoreFidelity(draft: string, target: StyleProfile | null | undefined): FidelityResult {
  if (!target || target.sampleCount === 0) return { score: 0, measured: false, components: [], issues: [] };
  const actual = measureStyle([draft]);
  if (actual.sampleCount === 0) return { score: 0, measured: false, components: [], issues: [] };
  const components: FidelityComponent[] = [];
  const issues: string[] = [];

  const personScore = actual.person === target.person ? 100 : 25;
  components.push({ name: 'person', score: personScore, weight: 3, detail: `expected ${PERSON_LABEL[target.person]}, got ${PERSON_LABEL[actual.person]}` });
  if (personScore < 100) issues.push(`Write in ${PERSON_LABEL[target.person]}, not ${PERSON_LABEL[actual.person]}.`);

  const paragraph = magnitudeScore(actual.avgParagraphWords, target.avgParagraphWords);
  components.push({ name: 'paragraphLength', score: paragraph, weight: 2, detail: `expected about ${Math.round(target.avgParagraphWords)} words per paragraph, got ${Math.round(actual.avgParagraphWords)}` });
  if (paragraph < 60) issues.push(`Paragraphs are ${actual.avgParagraphWords > target.avgParagraphWords ? 'longer' : 'shorter'} than this brand writes them (about ${Math.round(target.avgParagraphWords)} words).`);

  components.push({ name: 'shortParagraphs', score: ratioScore(actual.shortParagraphShare, target.shortParagraphShare, 0.12), weight: 1.5, detail: `expected ${Math.round(target.shortParagraphShare * 100)}% one-line paragraphs, got ${Math.round(actual.shortParagraphShare * 100)}%` });

  const sentence = magnitudeScore(actual.avgSentenceWords, target.avgSentenceWords);
  components.push({ name: 'sentenceLength', score: sentence, weight: 1.5, detail: `expected sentences of about ${Math.round(target.avgSentenceWords)} words, got ${Math.round(actual.avgSentenceWords)}` });
  if (sentence < 60) issues.push(`Sentences average ${Math.round(actual.avgSentenceWords)} words; this brand's average about ${Math.round(target.avgSentenceWords)}.`);

  // Machine text is evenly paced. Only judged when the draft is long enough for the spread to mean something.
  if (target.sentenceWordSpread > 0 && actual.sentenceWordSpread > 0) {
    const spread = ratioScore(actual.sentenceWordSpread, target.sentenceWordSpread, Math.max(2, target.sentenceWordSpread * 0.25));
    components.push({ name: 'rhythmVariety', score: spread, weight: 1.25, detail: `expected sentence length to vary by about ${Math.round(target.sentenceWordSpread)} words, got ${Math.round(actual.sentenceWordSpread)}` });
    if (spread < 60 && actual.sentenceWordSpread < target.sentenceWordSpread) issues.push('Sentence lengths are too even. Mix short and long sentences the way the examples do.');
  }

  if (actual.headingAvgWords > 0 || target.headingAvgWords > 0) {
    const headingStyle = actual.headingStyle === target.headingStyle ? 100 : 45;
    components.push({ name: 'headingStyle', score: headingStyle, weight: 2, detail: `expected ${target.headingStyle} headings, got ${actual.headingStyle}` });
    if (headingStyle < 100) issues.push(`Headings should be ${target.headingStyle}${target.headingSamples.length ? `, like: ${target.headingSamples.slice(0, 3).map((h) => `"${h}"`).join(', ')}` : ''}.`);
    components.push({ name: 'headingLength', score: magnitudeScore(actual.headingAvgWords, target.headingAvgWords), weight: 1, detail: `expected about ${Math.round(target.headingAvgWords)} words per heading, got ${Math.round(actual.headingAvgWords)}` });
  }

  components.push({ name: 'lists', score: ratioScore(actual.listShare, target.listShare, 0.15), weight: 1, detail: `expected ${Math.round(target.listShare * 100)}% list items, got ${Math.round(actual.listShare * 100)}%` });
  if (target.listShare <= 0.05 && actual.listShare >= 0.25) issues.push('Too many bullet lists. This brand writes in prose.');
  components.push({ name: 'fragments', score: boolScore(actual.usesFragments, target.usesFragments), weight: 0.75, detail: `expected fragments=${target.usesFragments}, got ${actual.usesFragments}` });
  components.push({ name: 'bold', score: boolScore(actual.usesBold, target.usesBold), weight: 0.75, detail: `expected bold=${target.usesBold}, got ${actual.usesBold}` });

  const totalWeight = components.reduce((n, c) => n + c.weight, 0);
  const score = totalWeight ? Math.round(components.reduce((n, c) => n + c.score * c.weight, 0) / totalWeight) : 0;
  return { score, measured: true, components, issues };
}

/** Compact "fix this" lines for the retry loop. */
export function fidelityRetryIssues(result: FidelityResult, minScore: number): string[] {
  if (!result.measured || result.score >= minScore) return [];
  const weakest = [...result.components].filter((c) => c.score < 70).sort((a, b) => a.score * a.weight - b.score * b.weight).slice(0, 3).map((c) => `${c.name}: ${c.detail}`);
  return [...new Set([...result.issues, ...weakest])].slice(0, 6);
}

/** Rules for the writer prompt, derived from the measurement rather than a fixed house style. */
export function styleRulesFromProfile(p: StyleProfile): string[] {
  if (p.sampleCount === 0) return [];
  const rules = [
    `Write in ${PERSON_LABEL[p.person]}.`,
    `Paragraphs average about ${Math.round(p.avgParagraphWords)} words and ${Math.round(p.shortParagraphShare * 100)}% of them are a single short line.`,
    `Sentences average about ${Math.round(p.avgSentenceWords)} words and vary a lot in length${p.sentenceWordSpread ? ` (spread of about ${Math.round(p.sentenceWordSpread)} words)` : ''}. Follow a long sentence with a short one.`,
    p.headingAvgWords ? `Headings are ${p.headingStyle} and about ${Math.round(p.headingAvgWords)} words long.` : '',
    p.headingSamples.length ? `Heading examples: ${p.headingSamples.slice(0, 4).map((h) => `"${h}"`).join(', ')}.` : '',
    p.usesFragments ? 'Short fragments are allowed for emphasis.' : 'Write complete sentences; avoid fragments.',
    p.usesBold ? 'Bold is used sparingly for emphasis.' : 'Do not use bold for emphasis.',
    p.listShare <= 0.05 ? 'Write in prose. Avoid bullet lists unless the content is a true list.' : `About ${Math.round(p.listShare * 100)}% of blocks are lists.`,
  ];
  return rules.filter(Boolean);
}

/* ------------------------------ Machine-writing detector ------------------------------ */

/** Stock phrases that mark text as machine or affiliate written. Lowercase; matched on the plain text. */
export const AI_PHRASES: readonly string[] = [
  "don't miss out", 'do not miss out', 'maximize your fun', 'exciting opportunity', 'join today', 'act now', 'elevate your experience', 'unlock rewards',
  'time is running out', 'limited time offer', 'game-changing', 'game changer', 'revolutionary', "in today's fast-paced world", 'look no further', 'dive in',
  'delve', 'without further ado', 'at the end of the day', "it's worth noting", "it is worth noting", 'in conclusion', 'leverage', 'synergy', 'cutting-edge',
  'best-in-class', 'take your experience to the next level', "don't wait", 'sign up now', 'claim now', 'hurry', 'exclusive offer', 'once-in-a-lifetime',
  'in the ever-evolving', 'ever-evolving landscape', 'navigate the landscape', 'rich tapestry', 'testament to', 'unlock the power', 'unlock the potential',
  'seamless', 'plethora', 'myriad of', 'a deep dive', 'buckle up', 'whether you are a', "whether you're a", "let's face it", 'stands as a', 'serves as a',
  'not just', 'in a world where', 'when it comes to', 'embark on', 'journey', 'fostering', 'robust', 'comprehensive guide', 'ultimate guide',
] as const;

/** Phrases that are only a problem when they pile up (single uses are ordinary English). */
const SOFT_PHRASES = new Set(['journey', 'robust', 'seamless', 'not just', 'when it comes to', 'serves as a', 'stands as a']);

export function findAiPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return AI_PHRASES.filter((phrase) => (SOFT_PHRASES.has(phrase) ? lower.split(phrase).length - 1 >= 2 : lower.includes(phrase)));
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/u;

export interface GenericityResult { score: number; issues: string[] }

/** 0 = reads as human editorial, 100 = obvious template. Deterministic: phrases, punctuation tics, repeated openers. */
export function analyzeGenericity(markdown: string): GenericityResult {
  const plain = plainText(markdown);
  const issues: string[] = [];
  let score = 0;
  const phrases = findAiPhrases(plain);
  for (const p of phrases) issues.push(`Stock phrase: "${p}"`);
  score += phrases.length * 18;
  const bangs = (plain.match(/!/g) ?? []).length;
  if (bangs > 1) { issues.push('Exclamation marks'); score += bangs * 3; }
  const dashes = (markdown.match(/[–—]/g) ?? []).length;
  if (dashes) { issues.push('Em or en dashes. Use commas or periods.'); score += Math.min(30, dashes * 6); }
  if (EMOJI.test(markdown)) { issues.push('Emoji'); score += 20; }
  const sentences = splitSentences(plain);
  const openers = new Map<string, number>();
  for (const s of sentences) {
    const opener = words(s).slice(0, 2).join(' ').toLowerCase();
    if (opener) openers.set(opener, (openers.get(opener) ?? 0) + 1);
  }
  const repeated = [...openers.entries()].filter(([, n]) => n >= 4 && sentences.length >= 12);
  for (const [opener, n] of repeated) { issues.push(`${n} sentences start with "${opener}"`); score += 10; }
  const triples = (plain.match(/\b[\w'-]+, [\w'-]+,? and [\w'-]+\b/g) ?? []).length;
  if (triples >= 4) { issues.push('Leans on three-item lists ("a, b, and c")'); score += 8; }
  const negations = (plain.match(/\bnot (?:just|only|merely) [^.]{3,60}, but\b/gi) ?? []).length;
  if (negations) { issues.push('"Not just X, but Y" construction'); score += negations * 8; }
  return { score: Math.min(100, score), issues: issues.slice(0, 12) };
}

/** Em/en dash and emoji removal for text that must follow the Voice taboos. Dashes become commas. */
export function enforceTaboos(markdown: string): string {
  return markdown
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(new RegExp(EMOJI.source, 'gu'), '')
    .replace(/[ \t]+$/gm, '');
}

/* ------------------------------ Style kit: real passages to imitate ------------------------------ */

export interface StyleKit { openings: string[]; signatures: string[]; details: string[] }

const CONCRETE = [/\d+(?:\.\d+)?%/, /\d{1,3}(?:,\d{3})+/, /\$\d/, /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/];

/** Pull the passages that best show the voice: how it opens, its most characteristic short paragraphs, and concrete facts. */
export function extractStyleKit(samples: string[]): StyleKit {
  const openings: string[] = [];
  const candidates: { text: string; score: number }[] = [];
  const details = new Set<string>();
  for (const sample of samples) {
    const blocks = splitBlocks(sample).paragraphs.map(plainText).filter((p) => words(p).length >= 6);
    openings.push(...blocks.slice(0, 2).filter((p) => p.length >= 20));
    for (const p of blocks) {
      const n = words(p).length;
      if (n >= 8 && n <= 65) {
        let score = 0;
        if (/\b(?:we|our|us|i|my|you|your)\b/i.test(p)) score += 3;
        if (n >= 8 && n <= 45) score += 2;
        if (/\b(?:never|always|refuse|insist|believe|rule|principle|prefer|reject|avoid)\b/i.test(p)) score += 1;
        candidates.push({ text: p, score });
      }
    }
    for (const s of splitSentences(plainText(sample))) {
      const n = words(s).length;
      if (n >= 4 && n <= 50 && CONCRETE.some((re) => re.test(s))) details.add(s);
    }
  }
  const signatures = [...new Set(candidates.sort((a, b) => b.score - a.score).map((c) => c.text))].slice(0, 6);
  return { openings: [...new Set(openings)].slice(0, 4), signatures, details: [...details].slice(0, 12) };
}
