export type OsSwStatus = 'idle' | 'registering' | 'active' | 'pending' | 'error' | 'unsupported';

type SwState = {
    status: OsSwStatus;
    errorMessage: string | null;
    controlled: boolean;
};

let state: SwState = { status: 'idle', errorMessage: null, controlled: false };
const listeners = new Set<() => void>();
let controllerListenerAttached = false;

function notify() {
    listeners.forEach((cb) => cb());
}

export function getOsSwState(): SwState {
    return state;
}

export function subscribeOsSwState(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function syncControlledStatus(status: OsSwStatus, errorMessage: string | null = null) {
    const controlled = typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller);
    if (controlled) {
        state = { status: 'active', errorMessage: null, controlled: true };
    } else if (status === 'active' || status === 'pending' || status === 'registering') {
        state = {
            status: 'pending',
            errorMessage: errorMessage ?? 'Reload this page once to activate the service worker.',
            controlled: false,
        };
    } else {
        state = { status, errorMessage, controlled: false };
    }
    notify();
}

function attachControllerListener() {
    if (controllerListenerAttached || typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    controllerListenerAttached = true;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        syncControlledStatus(state.status, state.errorMessage);
    });
}

/** Register the OS service worker; no-op outside os.* host. */
export async function registerOsServiceWorker(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!['nucleas.app', 'www.nucleas.app', 'localhost'].includes(window.location.hostname) && !window.location.host.startsWith('os.')) {
        state = { status: 'idle', errorMessage: null, controlled: false };
        notify();
        return;
    }
    if (!('serviceWorker' in navigator)) {
        state = { status: 'unsupported', errorMessage: 'Service workers are not supported in this browser.', controlled: false };
        notify();
        return;
    }

    attachControllerListener();
    syncControlledStatus('registering');

    try {
        await navigator.serviceWorker.register('/os-sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        syncControlledStatus('active');
    } catch (err) {
        state = {
            status: 'error',
            errorMessage: err instanceof Error ? err.message : 'Service worker registration failed.',
            controlled: false,
        };
        notify();
    }
}
