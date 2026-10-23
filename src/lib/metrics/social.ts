/** Session sources from GA4 are traffic referrals, not follower or engagement counts. */
export const SOCIAL_PLATFORMS = [
  { id: 'facebook', label: 'Facebook', pattern: /(^|\.)(facebook\.com|fb\.com)$|^facebook$/i },
  { id: 'instagram', label: 'Instagram', pattern: /(^|\.)instagram\.com$|^instagram$/i },
  { id: 'reddit', label: 'Reddit', pattern: /(^|\.)reddit\.com$|^reddit$/i },
  { id: 'bluesky', label: 'Bluesky', pattern: /(^|\.)(bsky\.app|bsky\.social)$|^bluesky$/i },
  { id: 'x', label: 'X / Twitter', pattern: /(^|\.)(twitter\.com|x\.com|t\.co)$|^(twitter|x)$/i },
  { id: 'linkedin', label: 'LinkedIn', pattern: /(^|\.)(linkedin\.com|lnkd\.in)$|^linkedin$/i },
  { id: 'pinterest', label: 'Pinterest', pattern: /(^|\.)pinterest\.[a-z.]+$|^pinterest$/i },
  { id: 'tiktok', label: 'TikTok', pattern: /(^|\.)tiktok\.com$|^tiktok$/i },
  { id: 'youtube', label: 'YouTube', pattern: /(^|\.)(youtube\.com|youtu\.be)$|^youtube$/i },
  { id: 'threads', label: 'Threads', pattern: /(^|\.)threads\.(net|com)$|^threads$/i },
];
export function socialPlatform(source: string): string {
  return SOCIAL_PLATFORMS.find((platform) => platform.pattern.test(source))?.id ?? 'other';
}
