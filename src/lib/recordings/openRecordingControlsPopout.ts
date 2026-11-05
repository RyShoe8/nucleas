const RECORDING_CONTROLS_WINDOW_NAME = 'nucleas-recording-controls';

function buildRecordingControlsPopoutUrl(): string {
  const path = '/recording/controls?popout=1';
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

/**
 * Opens recording controls in a small movable popup.
 * @returns the popup window, or null if blocked
 */
export function openRecordingControlsPopout(): Window | null {
  if (typeof window === 'undefined') return null;

  const url = buildRecordingControlsPopoutUrl();
  const width = 340;
  const height = 140;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + window.outerHeight - height - 48));

  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'popup=yes',
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'scrollbars=no',
    'resizable=yes',
  ].join(',');

  // The desktop app sends popups to the browser, away from the recording. Its inline controls are used instead.
  if (window.nucleasDesktop) return null;
  const popup = window.open(url, RECORDING_CONTROLS_WINDOW_NAME, features);
  return popup;
}

export function closeRecordingControlsPopout(popup: Window | null): void {
  if (!popup || popup.closed) return;
  try {
    popup.close();
  } catch {
    // ignore
  }
}
