export type VoicePreferredPhraseLike = {
  phrases: string[];
  url?: string;
  frequency_level?: number;
  allow_ai_variations?: boolean;
};

export type VoiceStylePromptOpts = {
  brandName?: string;
  brandMentionLevel?: number;
  contentProviderName?: string;
  sourcesInPostsLevel?: number;
  preferredPhrases?: VoicePreferredPhraseLike[];
};

export const GLOBAL_VOICE_TABOOS = [
  "No emojis",
  "No em dash or en dash punctuation (use commas or periods instead)",
] as const;

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

export function brandMentionLevelLabel(level: number): string {
  const l = Math.max(0, Math.min(100, Math.round(level)));
  if (l === 0) return "Never";
  if (l <= 25) return "Rare";
  if (l <= 50) return "Sometimes";
  if (l <= 75) return "Often";
  return "Always";
}

export function formatPhraseGroup(phrases: string[]): string {
  const list = phrases.map((p) => p.trim()).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0]!;
  return list.map((p) => `"${p}"`).join(" / ");
}

export function buildBrandMentionPromptLine(brandName: string, level: number): string | null {
  const name = brandName.trim();
  if (!name) return null;

  const l = Math.max(0, Math.min(100, Math.round(level)));
  if (l === 0) {
    return `- Do not mention the brand name "${name}" unless it already appears in the input email`;
  }
  if (l <= 25) {
    return `- Mention "${name}" rarely, only when clearly relevant`;
  }
  if (l <= 50) {
    return `- Mention "${name}" at least once when it fits naturally`;
  }
  if (l <= 75) {
    return `- Mention "${name}" prominently; include it at least once and again in the CTA or closing line when space allows`;
  }
  return `- Always lead with "${name}" and mention the brand at least twice when the post has room`;
}

export function buildContentProviderMentionPromptLine(
  contentProviderName: string,
  level: number,
): string | null {
  const name = contentProviderName.trim();
  if (!name) return null;

  const l = Math.max(0, Math.min(100, Math.round(level)));
  if (l === 0) {
    return `- Do not mention the content provider "${name}" in the post`;
  }
  if (l <= 25) {
    return `- Mention the content provider "${name}" rarely, only when clearly relevant`;
  }
  if (l <= 50) {
    return `- Mention the content provider "${name}" at least once when it fits naturally`;
  }
  if (l <= 75) {
    return `- Mention "${name}" prominently; include it at least once and again in the CTA or closing line when space allows`;
  }
  return `- Lead with or reference the content provider "${name}" at least twice when the post has room`;
}

export function buildPhraseFrequencyPromptLine(groupLabel: string, level: number): string | null {
  const text = groupLabel.trim();
  if (!text) return null;

  const l = Math.max(0, Math.min(100, Math.round(level)));
  if (l === 0) {
    return `- Do not use phrases from this group in this post: ${text}`;
  }
  if (l <= 25) {
    return `- Use a phrase from (${text}) rarely, only when clearly relevant`;
  }
  if (l <= 50) {
    return `- Consider a phrase from (${text}) when it fits naturally`;
  }
  if (l <= 75) {
    return `- Prefer a phrase from (${text}) when choosing preferred wording for this post`;
  }
  return `- Strongly prefer a phrase from (${text}) when choosing preferred wording for this post`;
}

function normalizePhraseRow(p: VoicePreferredPhraseLike): VoicePreferredPhraseLike | null {
  const phrases = (p.phrases ?? [])
    .map((x) => x.trim())
    .filter(Boolean);
  if (!phrases.length && typeof (p as { phrase?: string }).phrase === "string") {
    const legacy = (p as { phrase?: string }).phrase!.trim();
    if (legacy) phrases.push(...legacy.split(",").map((s) => s.trim()).filter(Boolean));
  }
  if (!phrases.length) return null;
  return {
    phrases,
    url: p.url?.trim(),
    frequency_level: Math.max(0, Math.min(100, Math.round(p.frequency_level ?? 50))),
    allow_ai_variations: Boolean(p.allow_ai_variations),
  };
}

function activePreferredPhrases(phrases: VoicePreferredPhraseLike[]): VoicePreferredPhraseLike[] {
  return phrases
    .map(normalizePhraseRow)
    .filter((p): p is VoicePreferredPhraseLike => p != null && p.frequency_level! > 0);
}

export function mergeTaboosWithGlobal(taboos: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...taboos, ...GLOBAL_VOICE_TABOOS]) {
    const s = t.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 15) break;
  }
  return out;
}

export function buildVoiceStylePromptLines(opts: VoiceStylePromptOpts): string[] {
  const lines: string[] = [...GLOBAL_VOICE_TABOOS.map((t) => `- ${t}`)];

  const brandLine = buildBrandMentionPromptLine(
    opts.brandName ?? "",
    opts.brandMentionLevel ?? 50,
  );
  if (brandLine) lines.push(brandLine);

  const providerLine = buildContentProviderMentionPromptLine(
    opts.contentProviderName ?? "",
    opts.sourcesInPostsLevel ?? 0,
  );
  if (providerLine) lines.push(providerLine);

  const pairs = activePreferredPhrases(opts.preferredPhrases ?? []);
  if (pairs.length) {
    lines.push(
      `- Use at most one preferred phrase+link pair from the user message when natural (do not force all)`,
    );
    lines.push(
      `- When choosing a phrase group, prefer higher-frequency entries over lower-frequency ones`,
    );
    lines.push(
      `- When you use a phrase that has a paired URL, include that URL; do not invent other URLs`,
    );
    if (pairs.some((p) => p.allow_ai_variations)) {
      lines.push(
        `- For groups marked with AI variations allowed: you may use close paraphrases of the listed terms (same intent and tone); do not invent unrelated slogans`,
      );
    }
    for (const p of pairs) {
      const groupLabel = formatPhraseGroup(p.phrases);
      const phraseLine = buildPhraseFrequencyPromptLine(groupLabel, p.frequency_level ?? 50);
      if (phraseLine) lines.push(phraseLine);
      if (!p.allow_ai_variations) {
        lines.push(
          `- When using group (${groupLabel}), use exact wording from that list only`,
        );
      }
    }
  }

  return lines;
}

export function formatPreferredPhrasesForUserMessage(
  phrases: VoicePreferredPhraseLike[],
): string {
  const formatted = activePreferredPhrases(phrases)
    .sort((a, b) => (b.frequency_level ?? 0) - (a.frequency_level ?? 0))
    .map((p) => {
      const label = brandMentionLevelLabel(p.frequency_level ?? 50);
      const level = p.frequency_level ?? 50;
      const group = formatPhraseGroup(p.phrases);
      const varNote = p.allow_ai_variations ? ", variations allowed" : ", exact wording only";
      const annotated = `${group} (${label}, ${level}${varNote})`;
      const url = p.url?.trim();
      return url?.startsWith("https://") ? `${annotated}|${url}` : annotated;
    });
  if (!formatted.length) return "";
  return `Preferred phrase pairs (use at most one; prefer higher frequency): ${formatted.join("; ")}`;
}

/** Strip emojis and em/en dashes; leave ASCII hyphen untouched. */
export function sanitizeVoicePostCopy(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/  +/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
}
