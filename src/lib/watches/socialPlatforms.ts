/** Where a post can go, with each platform's length limit and writing rules. Ported from Content Intelligence. */
export const SOCIAL_PLATFORM_IDS = [
  "twitter",
  "threads",
  "bluesky",
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "reddit",
] as const;

export type SocialPlatformId = (typeof SOCIAL_PLATFORM_IDS)[number];

export type SocialPlatformDef = {
  id: SocialPlatformId;
  label: string;
  maxChars: number;
  promptRules: string;
};

export const SOCIAL_PLATFORMS: SocialPlatformDef[] = [
  {
    id: "twitter",
    label: "X (Twitter)",
    maxChars: 280,
    promptRules: "Plain text only. Hashtags sparingly (0–2). No markdown.",
  },
  {
    id: "threads",
    label: "Threads",
    maxChars: 500,
    promptRules: "Conversational tone. Minimal hashtags. No markdown.",
  },
  {
    id: "bluesky",
    label: "Bluesky",
    maxChars: 300,
    promptRules: "Short, plain text. No markdown.",
  },
  {
    id: "instagram",
    label: "Instagram",
    maxChars: 2200,
    promptRules: "Caption style. Hashtags optional (max ~10). No markdown.",
  },
  {
    id: "facebook",
    label: "Facebook",
    maxChars: 1250,
    promptRules: "Engaging post length. Links OK when provided in input. No markdown.",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    maxChars: 3000,
    promptRules: "Professional tone. No excessive hashtags. No markdown.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    maxChars: 2200,
    promptRules: "Caption with a strong hook. Hashtags common but not excessive. No markdown.",
  },
  {
    id: "youtube",
    label: "YouTube",
    maxChars: 500,
    promptRules: "Community or video description style. Concise. No markdown.",
  },
  {
    id: "pinterest",
    label: "Pinterest",
    maxChars: 500,
    promptRules: "Pin description with keywords. Inspirational tone. No markdown.",
  },
  {
    id: "reddit",
    label: "Reddit",
    maxChars: 40000,
    promptRules:
      "Community tone. Strong first line. Concise post body. Avoid spammy or ALL CAPS clickbait. Plain text only.",
  },
];

const PLATFORM_BY_ID = new Map(SOCIAL_PLATFORMS.map((p) => [p.id, p]));

export function getSocialPlatform(id: SocialPlatformId): SocialPlatformDef {
  return PLATFORM_BY_ID.get(id)!;
}

export function isSocialPlatformId(s: string): s is SocialPlatformId {
  return (SOCIAL_PLATFORM_IDS as readonly string[]).includes(s);
}

export function normalizeDistributionPlatforms(raw: unknown): SocialPlatformId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<SocialPlatformId>();
  const out: SocialPlatformId[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const id = x.trim() as SocialPlatformId;
    if (!isSocialPlatformId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= SOCIAL_PLATFORM_IDS.length) break;
  }
  return out;
}

export function normalizeSocialCopyByPlatform(raw: unknown): Partial<Record<SocialPlatformId, string>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Partial<Record<SocialPlatformId, string>> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!isSocialPlatformId(key) || typeof val !== "string") continue;
    const s = val.trim();
    if (s) out[key] = s;
  }
  return out;
}

/** Primary copy: first platform in catalog order that has text, else twitter, else any value. */
export function primarySocialCopy(
  byPlatform: Partial<Record<SocialPlatformId, string>>,
  legacySocialCopy?: string,
  platformOrder: readonly SocialPlatformId[] = SOCIAL_PLATFORM_IDS,
): string {
  for (const id of platformOrder) {
    const t = byPlatform[id]?.trim();
    if (t) return t;
  }
  const twitter = byPlatform.twitter?.trim();
  if (twitter) return twitter;
  const first = Object.values(byPlatform).find((v) => v?.trim());
  if (first?.trim()) return first.trim();
  return legacySocialCopy?.trim() ?? "";
}

/** Merge legacy social_copy into map when empty. */
export function socialCopyByPlatformFromDoc(
  byPlatform: Partial<Record<SocialPlatformId, string>>,
  socialCopy?: string,
): Partial<Record<SocialPlatformId, string>> {
  const map = { ...byPlatform };
  if (Object.keys(map).length === 0 && socialCopy?.trim()) {
    map.twitter = socialCopy.trim();
  }
  return map;
}

export function truncateForPlatform(text: string, platformId: SocialPlatformId): string {
  const max = getSocialPlatform(platformId).maxChars;
  const t = text.trim();
  if (t.length <= max) return t;
  if (max <= 3) return t.slice(0, max);
  return `${t.slice(0, max - 1)}…`;
}
