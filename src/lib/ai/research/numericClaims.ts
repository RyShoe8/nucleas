/** A conservative review trigger, never a proof that a factual claim is correct. */
export function numericTokens(text: string): string[] {
  const clean = text.replace(/https?:\/\/\S+/g, '').replace(/^\s*\d+[.)]\s+/gm, '');
  return [...new Set([...clean.matchAll(/(?:(?:[$€£]|USD|EUR|GBP)\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s*(?:%|percent|USD|EUR|GBP|hours?|days?|months?|years?|impressions?|customers?|users?))?/gi)]
    .map(m => m[0].replace(/,/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
      .replace(/^usd\s*|\s*usd$/g, '$').replace(/^eur\s*|\s*eur$/g, '€').replace(/^gbp\s*|\s*gbp$/g, '£')
      .replace(/^(.*?)([$€£])$/, '$2$1').replace(/\s*percent|\s*%/g, '%').replace(/([$€£])\s+/g, '$1')
      .replace(/\b(hour|day|month|year|impression|customer|user)s\b/g, '$1')
      .replace(/\d+\.\d+/g, n => String(Number(n)))))];
}

export function numericClaimWarnings(draft: string, sources: string[]): string[] {
  // Sources must be fetched evidence; a user request, Voice or a model summary is not numeric authority.
  const statements = draft.split(/\n|(?<=[.!?])\s+/).filter(s => numericTokens(s).length);
  const rows = sources.flatMap(s => s.split(/\n|(?<=[.!?])\s+/));
  const terms = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(t => !['this', 'that', 'with', 'from', 'have', 'were', 'there'].includes(t)));
  return statements.filter(s => {
    const values = numericTokens(s), context = terms(s);
    return !rows.some(row => {
      const known = new Set(numericTokens(row));
      if (!values.every(v => known.has(v))) return false;
      const words = terms(row);
      return context.size > 0 && [...context].filter(t => words.has(t)).length >= Math.max(1, Math.ceil(context.size * 0.7));
    });
  }).map(s => s.trim().slice(0, 400)).slice(0, 50);
}
