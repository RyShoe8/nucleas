/** Shared answer format for both Direct and orchestrated Ask. Stored as ordinary markdown. */
export const NEWS_SLIDES_PROMPT = [
  'For broad current-events questions (what happened in an election, a news roundup, or a major developing story), automatically deliver a sourced slideshow unless the user requests another format. Simple factual questions still get a short answer.',
  'Use this exact markdown structure: start with <!-- nucleas-slides --> on its own line, then 3–6 slides, each beginning with ## followed by a short, concrete headline. No other level-two headings. No JSON or code fences.',
  'Each slide contains at most 80 words: a key takeaway, 1–3 concrete facts with inline markdown source links, and why it matters. Every slide must have at least one https source link actually found in research. Use a strong opening takeaway and close with what remains unresolved or what happens next. Impact comes from clear evidence and implications, never sensationalism.',
  'Research current news before answering. Use primary sources and reliable reporting, check event dates against publication dates, and state the as-of date/time and timezone when available. Resolve today against the user timezone if known. Never invent a timestamp. For elections distinguish reported counts, projections/calls, and certified results. Label implications as analysis. Do not infer final winners from partial counts.',
  'If research is missing or insufficient, give a concise ordinary answer explaining the gap instead of creating unsupported slides. Never invent URLs, facts, quotes, or images.',
].join('\n');

export interface AnswerSlide { title: string; body: string }
export function parseAnswerSlides(text: string): AnswerSlide[] | null {
  if (!text.trimStart().startsWith('<!-- nucleas-slides -->')) return null;
  const content = text.trimStart().slice('<!-- nucleas-slides -->'.length).trim();
  if (!content.startsWith('## ')) return null;
  const sections = content.split(/^## /m).slice(1);
  if (sections.length < 3 || sections.length > 6) return null;
  const slides = sections.map(section => {
    const newline = section.indexOf('\n');
    return { title: section.slice(0, newline).trim(), body: section.slice(newline + 1).trim() };
  });
  return slides.every(s => s.title && s.body && /\[[^\]]+\]\(https:\/\/[^\s)]+\)/.test(s.body)) ? slides : null;
}
