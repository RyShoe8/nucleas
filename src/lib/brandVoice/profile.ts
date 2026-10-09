import { z } from "zod";

function scalarToString(val: unknown, maxLen = 500): string {
  if (val == null) return "";
  if (typeof val === "string") return val.trim().slice(0, maxLen);
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val).trim().slice(0, maxLen);
  }
  if (Array.isArray(val)) {
    return val
      .map((x) => (typeof x === "string" ? x.trim() : String(x).trim()))
      .filter(Boolean)
      .join("; ")
      .slice(0, maxLen);
  }
  return "";
}

function coercedString(max = 500) {
  return z.preprocess(
    (val) => scalarToString(val, max),
    z.string().max(max).default(""),
  );
}

function optionalTrimmedString(max = 500) {
  return z.preprocess(
    (v) => (v == null || v === "" ? undefined : String(v).trim().slice(0, max)),
    z.string().max(max).optional(),
  );
}

function optionalCoercedDate() {
  return z.preprocess(
    (v) => (v == null || v === "" ? undefined : v),
    z.coerce.date().optional(),
  );
}

const OPTIONAL_STRING_KEYS = new Set(["secondary", "corpusHash"]);
const OPTIONAL_DATE_KEYS = new Set(["memoryUpdatedAt", "analyzedAt"]);

function sanitizeNestedRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    if (val === null) {
      if (OPTIONAL_STRING_KEYS.has(key) || OPTIONAL_DATE_KEYS.has(key)) continue;
      out[key] = "";
      continue;
    }
    if (typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      out[key] = sanitizeNestedRecord(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** Strip null/empty optional nested fields before Zod parse (Mongo legacy shape). */
export function sanitizeBrandProfileInput(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return v;
  return sanitizeNestedRecord(v as Record<string, unknown>);
}

const stringList = (max: number) =>
  z.preprocess(
    (val) => (Array.isArray(val) ? val.filter((x) => typeof x === "string") : []),
    z.array(z.string()).max(max).default([]),
  );

export const brandMemorySchema = z.object({
  favoritePhrases: stringList(20),
  recurringTopics: stringList(20),
  recurringJokes: stringList(20),
  recurringCTAs: stringList(20),
  recurringEnemies: stringList(20),
  favoriteOpenings: stringList(20),
  favoriteClosings: stringList(20),
  favoriteTransitions: stringList(20),
  recurringOpinions: stringList(20),
  recurringWarnings: stringList(20),
  memoryUpdatedAt: optionalCoercedDate(),
});

export type BrandMemory = z.infer<typeof brandMemorySchema>;

export const brandPositioningSchema = z.object({
  primary: coercedString(),
  secondary: optionalTrimmedString(),
});

export const brandAudienceRelationshipSchema = z.object({
  style: coercedString(),
});

export const brandEmotionalBaselineSchema = z.object({
  primary: coercedString(),
  secondary: optionalTrimmedString(),
});

export const brandContradictionsSchema = z.object({
  primaryTrait: coercedString(),
  secondaryTrait: coercedString(),
});

export const brandContrastiveSchema = z.object({
  soundsLike: stringList(10),
  doesNotSoundLike: stringList(10),
});

export const brandColorProfileSchema = z.object({
  dominantColors: stringList(8),
  contrastLevel: coercedString(),
  saturationLevel: coercedString(),
  lightingMood: coercedString(),
});

export type BrandColorProfile = z.infer<typeof brandColorProfileSchema>;

export const visualPersonalitySchema = z.object({
  visualTone: coercedString(),
  compositionStyle: stringList(10),
  colorProfile: brandColorProfileSchema.default({
    dominantColors: [],
    contrastLevel: "",
    saturationLevel: "",
    lightingMood: "",
  }),
  textureStyle: stringList(10),
  typographyStyle: coercedString(),
  layoutBehavior: stringList(10),
  memeCompatibility: coercedString(),
  visualTaboos: stringList(15),
  visualArchetypes: stringList(10),
  recurringMotifs: stringList(15),
});

export type VisualPersonality = z.infer<typeof visualPersonalitySchema>;

export const sharedIdentitySchema = z.object({
  audienceType: coercedString(),
  internetCultureAlignment: coercedString(),
  sophisticationLevel: coercedString(),
  energyProfile: coercedString(),
  trustStyle: coercedString(),
});

export type SharedIdentity = z.infer<typeof sharedIdentitySchema>;

export const brandProfileSchema = z.object({
  positioning: brandPositioningSchema.default({ primary: "" }),
  audienceRelationship: brandAudienceRelationshipSchema.default({ style: "" }),
  emotionalBaseline: brandEmotionalBaselineSchema.default({ primary: "" }),
  taboos: stringList(15),
  rhetoricalPatterns: stringList(15),
  contentObjectives: stringList(10),
  contradictions: brandContradictionsSchema.default({
    primaryTrait: "",
    secondaryTrait: "",
  }),
  contrastive: brandContrastiveSchema.default({
    soundsLike: [],
    doesNotSoundLike: [],
  }),
  memory: brandMemorySchema.default({
    favoritePhrases: [],
    recurringTopics: [],
    recurringJokes: [],
    recurringCTAs: [],
    recurringEnemies: [],
  }),
  archetype: coercedString(),
  visualPersonality: visualPersonalitySchema.default({
    visualTone: "",
    compositionStyle: [],
    colorProfile: {
      dominantColors: [],
      contrastLevel: "",
      saturationLevel: "",
      lightingMood: "",
    },
    textureStyle: [],
    typographyStyle: "",
    layoutBehavior: [],
    memeCompatibility: "",
    visualTaboos: [],
    visualArchetypes: [],
    recurringMotifs: [],
  }),
  sharedIdentity: sharedIdentitySchema.default({
    audienceType: "",
    internetCultureAlignment: "",
    sophisticationLevel: "",
    energyProfile: "",
    trustStyle: "",
  }),
  confidence: z.number().min(0).max(1).default(0.5),
  visualConfidence: z.number().min(0).max(1).default(0.5),
  analyzedAt: optionalCoercedDate(),
  corpusHash: optionalTrimmedString(),
});

export type BrandProfile = z.infer<typeof brandProfileSchema>;

/** Normalize profile before Mongo write — never persist null optional strings. */
export function sanitizeBrandProfileForStorage(profile: BrandProfile): BrandProfile {
  return brandProfileSchema.parse(sanitizeBrandProfileInput(profile));
}

export const generationConstraintsSchema = z.object({
  positioning: z.string(),
  audienceRelationship: z.string(),
  emotionalBaseline: z.string(),
  taboos: z.array(z.string()),
  rhetoricalPatterns: z.array(z.string()),
  contentObjectives: z.array(z.string()),
  primaryTrait: z.string(),
  secondaryTrait: z.string(),
  soundsLike: z.array(z.string()),
  doesNotSoundLike: z.array(z.string()),
  favoritePhrases: z.array(z.string()),
  recurringTopics: z.array(z.string()),
  recurringCTAs: z.array(z.string()),
  recurringEnemies: z.array(z.string()),
  archetype: z.string().optional(),
  sharedIdentity: sharedIdentitySchema.optional(),
});

export type GenerationConstraints = z.infer<typeof generationConstraintsSchema>;

export function emptyVisualPersonality(): VisualPersonality {
  return visualPersonalitySchema.parse({});
}

export function emptySharedIdentity(): SharedIdentity {
  return sharedIdentitySchema.parse({});
}

export function emptyBrandMemory(): BrandMemory {
  return brandMemorySchema.parse({});
}

export function emptyBrandProfile(): BrandProfile {
  return brandProfileSchema.parse({
    positioning: { primary: "" },
    audienceRelationship: { style: "" },
    emotionalBaseline: { primary: "" },
    taboos: [],
    rhetoricalPatterns: [],
    contentObjectives: [],
    contradictions: { primaryTrait: "", secondaryTrait: "" },
    contrastive: { soundsLike: [], doesNotSoundLike: [] },
    memory: emptyBrandMemory(),
    archetype: "",
    visualPersonality: emptyVisualPersonality(),
    sharedIdentity: emptySharedIdentity(),
    confidence: 0,
    visualConfidence: 0,
  });
}
