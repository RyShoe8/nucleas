const MEETING_POPOUT_WIDTH = 960;
const MEETING_POPOUT_HEIGHT = 720;

export type MeetingPopoutResult = {
  opened: boolean;
  blocked: boolean;
};

const MEETING_POPOUT_WINDOW_NAME = 'nucleas-meeting';

function buildMeetingPopoutUrl(agendaToken: string): string {
  const path = `/scheduling/meeting/${encodeURIComponent(agendaToken)}?popout=1`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

function buildAssetPopoutUrl(assetId: string): string {
  const path = `/assets/view/${encodeURIComponent(assetId)}?popout=1`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

function openSizedPopout(
  url: string,
  windowName: string,
  width: number = MEETING_POPOUT_WIDTH,
  height: number = MEETING_POPOUT_HEIGHT
): MeetingPopoutResult {
  if (typeof window === 'undefined') return { opened: false, blocked: false };

  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'popup=yes',
    'menubar=no',
    'toolbar=no',
    'location=yes',
    'status=no',
    'scrollbars=yes',
    'noopener',
    'noreferrer',
  ].join(',');

  const popup = window.open(url, windowName, features);
  // The desktop app opens this in the browser and hands back no window: that is success, not a blocked popup.
  if (window.nucleasDesktop) return { opened: true, blocked: false };
  if (!popup) {
    return { opened: false, blocked: true };
  }

  try {
    popup.focus();
  } catch {
    /* ignore cross-origin focus errors */
  }

  return { opened: true, blocked: false };
}

/**
 * Opens meeting detail in a pop-out window. Never navigates the main window.
 */
export function openMeetingPopout(agendaToken: string): MeetingPopoutResult {
  return openSizedPopout(buildMeetingPopoutUrl(agendaToken), MEETING_POPOUT_WINDOW_NAME);
}

export function openAssetPopout(assetId: string): MeetingPopoutResult {
  return openSizedPopout(buildAssetPopoutUrl(assetId), `nucleas-asset-${assetId}`);
}

export const MEETING_POPUP_BLOCKED_MESSAGE =
  'Allow pop-ups for this site to open the meeting window.';

export const ASSET_POPUP_BLOCKED_MESSAGE =
  'Allow pop-ups for this site to open the asset viewer.';
