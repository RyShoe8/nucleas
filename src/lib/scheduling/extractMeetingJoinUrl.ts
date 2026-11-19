import type { GoogleCalendarEvent } from '@/lib/scheduling/googleCalendar';

export type MeetingJoinPlatform = 'google_meet' | 'zoom' | 'teams' | 'discord' | 'other';

export type MeetingJoinInfo = {
  joinUrl: string;
  joinPlatform: MeetingJoinPlatform;
};

const URL_PATTERNS: { platform: MeetingJoinPlatform; pattern: RegExp }[] = [
  { platform: 'google_meet', pattern: /https?:\/\/meet\.google\.com\/[^\s<>"')]+/i },
  {
    platform: 'zoom',
    pattern: /https?:\/\/(?:[\w-]+\.)?zoom\.(?:us|com)\/[^\s<>"')]+/i,
  },
  {
    platform: 'teams',
    pattern: /https?:\/\/teams\.microsoft\.com\/[^\s<>"')]+/i,
  },
  {
    platform: 'discord',
    pattern: /https?:\/\/(?:discord\.gg|discord\.com\/invite)\/[^\s<>"')]+/i,
  },
];

function detectPlatformFromUrl(url: string): MeetingJoinPlatform {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('meet.google.com')) return 'google_meet';
    if (host.includes('zoom.us') || host.includes('zoom.com')) return 'zoom';
    if (host.includes('teams.microsoft.com')) return 'teams';
    if (host.includes('discord.gg') || host.includes('discord.com')) return 'discord';
  } catch {
    /* ignore */
  }
  return 'other';
}

function findUrlInText(text: string | undefined): MeetingJoinInfo | null {
  if (!text?.trim()) return null;
  for (const { platform, pattern } of URL_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) {
      const joinUrl = match[0].replace(/[.,;:!?)]+$/, '');
      return { joinUrl, joinPlatform: platform };
    }
  }
  return null;
}

function fromConferenceData(event: GoogleCalendarEvent): MeetingJoinInfo | null {
  const entryPoints = event.conferenceData?.entryPoints;
  if (!entryPoints?.length) return null;
  const video = entryPoints.find((ep) => ep.entryPointType === 'video' && ep.uri?.trim());
  if (!video?.uri) return null;
  const joinUrl = video.uri.trim();
  const label = (video.label || video.meetingCode || '').toLowerCase();
  let joinPlatform: MeetingJoinPlatform = detectPlatformFromUrl(joinUrl);
  if (joinPlatform === 'other') {
    if (label.includes('meet') || label.includes('google')) joinPlatform = 'google_meet';
    else if (label.includes('zoom')) joinPlatform = 'zoom';
    else if (label.includes('teams')) joinPlatform = 'teams';
  }
  return { joinUrl, joinPlatform };
}

export function extractMeetingJoinUrl(event: GoogleCalendarEvent): MeetingJoinInfo | null {
  const fromConference = fromConferenceData(event);
  if (fromConference) return fromConference;

  const fromDescription = findUrlInText(event.description);
  if (fromDescription) return fromDescription;

  const fromLocation = findUrlInText(event.location);
  if (fromLocation) return fromLocation;

  return null;
}
