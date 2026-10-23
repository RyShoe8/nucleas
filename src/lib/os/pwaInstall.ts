const PWA_INSTALL_KEYS = {
    seenOnLoad: 'nucleas-os-install-seen-on-load',
    seenOnModules: 'nucleas-os-install-seen-on-modules',
    dismissed: 'nucleas-os-install-dismissed',
    engaged: 'nucleas-os-install-engaged',
    installed: 'nucleas-os-pwa-installed',
} as const;

const INSTALLED_DISPLAY_MODES = [
    'standalone',
    'window-controls-overlay',
    'fullscreen',
    'minimal-ui',
] as const;

export function isOsHost(): boolean {
    if (typeof window === 'undefined') return false;
    return window.location.hostname === 'nucleas.app' || window.location.hostname === 'www.nucleas.app' || window.location.host.startsWith('os.') || window.location.hostname === 'localhost';
}

function isInstalledDisplayMode(): boolean {
    if (typeof window === 'undefined') return false;
    return INSTALLED_DISPLAY_MODES.some((mode) =>
        window.matchMedia(`(display-mode: ${mode})`).matches
    );
}

function isWindowControlsOverlayActive(): boolean {
    if (typeof window === 'undefined') return false;
    const wco = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean } })
        .windowControlsOverlay;
    return wco?.visible === true;
}

function isNonBrowserDisplayOnOsHost(): boolean {
    if (typeof window === 'undefined' || !isOsHost()) return false;
    return !window.matchMedia('(display-mode: browser)').matches;
}

/** User is inside the installed PWA window (not a normal browser tab). */
export function isRunningAsInstalledPwa(): boolean {
    if (typeof window === 'undefined') return false;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return (
        isInstalledDisplayMode() ||
        nav.standalone === true ||
        isWindowControlsOverlayActive() ||
        isNonBrowserDisplayOnOsHost()
    );
}

export function isRunningInBrowserTab(): boolean {
    return isOsHost() && !isRunningAsInstalledPwa();
}

function hasPwaInstalledFlag(): boolean {
    return readFlag(PWA_INSTALL_KEYS.installed);
}

export function markPwaInstalled(): void {
    writeFlag(PWA_INSTALL_KEYS.installed);
}

export async function detectInstalledRelatedAppAsync(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    const nav = window.navigator as Navigator & {
        getInstalledRelatedApps?: () => Promise<unknown[]>;
    };
    if (typeof nav.getInstalledRelatedApps !== 'function') {
        return hasPwaInstalledFlag();
    }

    try {
        const apps = await nav.getInstalledRelatedApps();
        if (apps.length > 0) {
            markPwaInstalled();
            return true;
        }
    } catch {
        // ignore — API may be unavailable or blocked
    }
    return hasPwaInstalledFlag();
}

function readFlag(key: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

function writeFlag(key: string): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key, '1');
    } catch {
        // ignore quota / private mode
    }
}

export function hasSeenInstallOnLoad(): boolean {
    return readFlag(PWA_INSTALL_KEYS.seenOnLoad);
}

export function markSeenInstallOnLoad(): void {
    writeFlag(PWA_INSTALL_KEYS.seenOnLoad);
}

export function isInstallDismissed(): boolean {
    return readFlag(PWA_INSTALL_KEYS.dismissed);
}

export function markInstallDismissed(): void {
    writeFlag(PWA_INSTALL_KEYS.dismissed);
}

export function markInstallEngaged(): void {
    writeFlag(PWA_INSTALL_KEYS.engaged);
}

/** Clear reminder flags only — does not mark the app as installed. */
export function clearInstallReminders(): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(PWA_INSTALL_KEYS.seenOnLoad);
        localStorage.removeItem(PWA_INSTALL_KEYS.seenOnModules);
        localStorage.removeItem(PWA_INSTALL_KEYS.dismissed);
        localStorage.removeItem(PWA_INSTALL_KEYS.engaged);
    } catch {
        // ignore quota / private mode
    }
}
