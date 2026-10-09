// Ported from Content Intelligence's derive-persona-summary; uses Nucleas storage and AI routing.
import type { BrandProfile } from "./profile";
import {
  brandMentionLevelLabel,
  buildBrandMentionPromptLine,
  formatPhraseGroup,
  GLOBAL_VOICE_TABOOS,
  type VoicePreferredPhraseLike,
} from "./styleRules";

export type PersonaVoiceOpts = {
  brandMentionLevel?: number;
  sourcesInPostsLevel?: number;
  preferredPhrases?: VoicePreferredPhraseLike[];
};

export type DerivePersonaSummaryOpts = {
  voiceOpts?: PersonaVoiceOpts;
  /** Social/deal post sliders — omitted from writer persona by default. */
  includeSocialPostSettings?: boolean;
  /** Image generation only — omitted from writer persona by default. */
  includeVisualIdentity?: boolean;
  composeEditorialBlock?: string;
};

const WRITER_RHETORICAL_FALLBACK = [
  "- Writing rhythm has not been established; add brand writing samples",
];
const SOCIAL_RHETORICAL_FALLBACK = ["- Lead with deal hook", "- Keep sentences short"];
const WRITER_OBJECTIVES_FALLBACK = "- engagement\n- authority\n- education";
const SOCIAL_OBJECTIVES_FALLBACK = "- engagement\n- conversion";

export function derivePersonaSummary(
  profile: BrandProfile,
  voiceName: string,
  opts: DerivePersonaSummaryOpts = {},
): string {
  const includeSocial = opts.includeSocialPostSettings === true;
  const includeVisual = opts.includeVisualIdentity === true;
  const voiceOpts = opts.voiceOpts;

  const lines = [
    `# ${voiceName} voice`,
    "",
    "## Voice summary",
    profile.positioning.primary ||
      (includeSocial
        ? `${voiceName} promotional voice shaped by linked content and historical posts.`
        : `${voiceName} editorial voice shaped by brand content and style examples.`),
    profile.positioning.secondary ? `Secondary positioning: ${profile.positioning.secondary}` : null,
    "",
    "## Tone & personality",
    `- Audience relationship: ${profile.audienceRelationship.style || "Not established"}`,
    `- Emotional baseline: ${profile.emotionalBaseline.primary || "Not established"}${
      profile.emotionalBaseline.secondary ? ` / ${profile.emotionalBaseline.secondary}` : ""
    }`,
    profile.archetype ? `- Archetype: ${profile.archetype}` : null,
    `- Primary trait: ${profile.contradictions.primaryTrait || "Not established"}`,
    `- Secondary trait: ${profile.contradictions.secondaryTrait || "Not established"}`,
    "",
    "## Sounds like / does not sound like",
    profile.contrastive.soundsLike.length
      ? `- Sounds like: ${profile.contrastive.soundsLike.join("; ")}`
      : null,
    profile.contrastive.doesNotSoundLike.length
      ? `- Does NOT sound like: ${profile.contrastive.doesNotSoundLike.join("; ")}`
      : null,
    "",
    "## Rhetorical patterns",
    ...(profile.rhetoricalPatterns.length
      ? profile.rhetoricalPatterns.map((p) => `- ${p}`)
      : includeSocial
        ? SOCIAL_RHETORICAL_FALLBACK
        : WRITER_RHETORICAL_FALLBACK),
    "",
    "## Taboos",
    ...tabooLines(profile.taboos),
    "",
    "## Content objectives",
    profile.contentObjectives.length
      ? profile.contentObjectives.map((o) => `- ${o}`).join("\n")
      : includeSocial
        ? SOCIAL_OBJECTIVES_FALLBACK
        : WRITER_OBJECTIVES_FALLBACK,
    "",
    "## Shared identity",
    profile.sharedIdentity.audienceType
      ? `- Audience: ${profile.sharedIdentity.audienceType}`
      : null,
    profile.sharedIdentity.internetCultureAlignment
      ? `- Culture: ${profile.sharedIdentity.internetCultureAlignment}`
      : null,
    profile.sharedIdentity.energyProfile
      ? `- Energy: ${profile.sharedIdentity.energyProfile}`
      : null,
    profile.sharedIdentity.trustStyle
      ? `- Trust style: ${profile.sharedIdentity.trustStyle}`
      : null,
    ...(includeVisual ? visualIdentitySections(profile) : []),
    "",
    "## Brand memory markers",
    profile.memory.favoritePhrases.length
      ? `Favorite phrases: ${profile.memory.favoritePhrases.join("; ")}`
      : null,
    profile.memory.recurringTopics.length
      ? `Recurring topics: ${profile.memory.recurringTopics.join("; ")}`
      : null,
    profile.memory.recurringEnemies.length
      ? `Recurring enemies: ${profile.memory.recurringEnemies.join("; ")}`
      : null,
    ...(includeSocial && voiceOpts ? voiceSettingsSections(voiceName, voiceOpts) : []),
    ...(opts.composeEditorialBlock?.trim()
      ? ["", "## Editorial compose", opts.composeEditorialBlock.trim()]
      : []),
  ].filter((x): x is string => Boolean(x));

  return lines.join("\n");
}

function visualIdentitySections(profile: BrandProfile): string[] {
  return [
    "",
    "## Visual identity",
    profile.visualPersonality.visualTone
      ? `- Visual tone: ${profile.visualPersonality.visualTone}`
      : null,
    profile.visualPersonality.compositionStyle.length
      ? `- Composition: ${profile.visualPersonality.compositionStyle.join("; ")}`
      : null,
    profile.visualPersonality.colorProfile.dominantColors.length
      ? `- Colors: ${profile.visualPersonality.colorProfile.dominantColors.join(", ")}`
      : null,
    profile.visualPersonality.visualTaboos.length
      ? `- Visual taboos: ${profile.visualPersonality.visualTaboos.join("; ")}`
      : null,
    profile.visualPersonality.memeCompatibility
      ? `- Meme compatibility: ${profile.visualPersonality.memeCompatibility}`
      : null,
  ].filter((x): x is string => Boolean(x));
}

function voiceSettingsSections(voiceName: string, opts: PersonaVoiceOpts): string[] {
  const level = Math.max(0, Math.min(100, Math.round(opts.brandMentionLevel ?? 50)));
  const mentionLine = buildBrandMentionPromptLine(voiceName, level);

  const brandMention = [
    "",
    "## Brand mention frequency",
    `- Setting: ${level} (${brandMentionLevelLabel(level)})`,
    mentionLine,
  ].filter((x): x is string => Boolean(x));

  const sourcesLevel = Math.max(0, Math.min(100, Math.round(opts.sourcesInPostsLevel ?? 0)));
  const sourcesInPosts = [
    "",
    "## Content provider names in posts",
    `- Setting: ${sourcesLevel} (${brandMentionLevelLabel(sourcesLevel)})`,
    `- Controls how often generated copy names the promo/casino from each email (e.g. Chipnwin), not the voice brand or Gmail label (Email · Promotions)`,
  ];

  const pairs = (opts.preferredPhrases ?? [])
    .map((p) => {
      const phrases =
        p.phrases?.map((x) => x.trim()).filter(Boolean) ??
        (typeof (p as { phrase?: string }).phrase === "string"
          ? [(p as { phrase?: string }).phrase!.trim()]
          : []);
      if (!phrases.length) return null;
      const group = formatPhraseGroup(phrases);
      const freq = Math.max(0, Math.min(100, Math.round(p.frequency_level ?? 50)));
      const label = brandMentionLevelLabel(freq);
      const url = p.url?.trim();
      const varNote = p.allow_ai_variations ? ", AI variations allowed" : ", exact wording only";
      const suffix = ` (${label}, ${freq}${varNote})`;
      return url?.startsWith("https://")
        ? `- ${group}|${url}${suffix}`
        : `- ${group}${suffix}`;
    })
    .filter((x): x is string => Boolean(x));

  const preferredPhrases = [
    "",
    "## Preferred phrases for posts",
    "- Use at most one phrase+link pair when natural (do not force every post)",
    ...(pairs.length ? pairs : ["- None configured"]),
  ];

  return [...brandMention, ...sourcesInPosts, ...preferredPhrases];
}

function tabooLines(taboos: string[]): string[] {
  const merged = [...taboos];
  for (const t of GLOBAL_VOICE_TABOOS) {
    if (!merged.some((x) => x.toLowerCase() === t.toLowerCase())) {
      merged.push(t);
    }
  }
  if (!merged.length) {
    return ["- Avoid generic AI phrasing", "- Avoid corporate jargon"];
  }
  return merged.map((t) => `- ${t}`);
}

/** Writer-focused persona for compose — no social/deal or visual sections. */
export function deriveWriterPersonaSummary(
  profile: BrandProfile,
  voiceName: string,
  composeEditorialBlock?: string,
): string {
  return derivePersonaSummary(profile, voiceName, {
    includeSocialPostSettings: false,
    includeVisualIdentity: false,
    composeEditorialBlock,
  });
}
