import { useEffect, useRef, type MouseEvent } from 'react';

/**
 * Account sign-ins from the desktop app happen in the browser, so the app window has to find out when they finish.
 * Clicking the link tags it with a flow id. The callback records the result against that id and shows a short "return
 * to Nucleas" page instead of the web app, and the app window polls for the result and updates itself.
 */

const POLL_MS = 3000;
const GIVE_UP_MS = 600_000;
const FINISHED_EVENT = 'nucleas:connection-finished';

export interface ConnectionResult {
    error: boolean;
    message: string;
}

/** Polls until the sign-in with this flow id has finished, or null if it never does. */
export async function waitForConnection(flow: string, options: { fetcher?: typeof fetch; pollMs?: number; giveUpMs?: number } = {}): Promise<ConnectionResult | null> {
    const fetcher = options.fetcher ?? fetch;
    const pollMs = options.pollMs ?? POLL_MS;
    const deadline = Date.now() + (options.giveUpMs ?? GIVE_UP_MS);
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        try {
            const res = await fetcher(`/api/os/integrations/completion?flow=${flow}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
            const body = (await res.json()) as { complete?: boolean; error?: boolean; message?: string };
            if (res.ok && body.complete) return { error: Boolean(body.error), message: body.message ?? 'Connection completed.' };
        } catch {
            /* A dropped request is retried until the deadline. */
        }
    }
    return null;
}

/** Use as the onClick of a connection link. On the web it does nothing and the link behaves normally. */
export function beginDesktopConnection(event: MouseEvent<HTMLAnchorElement>): void {
    if (!window.nucleasDesktop) return;
    const flow = crypto.randomUUID().replaceAll('-', '');
    const url = new URL(event.currentTarget.href);
    url.searchParams.set('desktopFlow', flow);
    event.currentTarget.href = url.href;
    void waitForConnection(flow).then((result) => {
        const detail: ConnectionResult = result ?? { error: true, message: 'The connection did not finish in time. Try connecting again.' };
        window.dispatchEvent(new CustomEvent<ConnectionResult>(FINISHED_EVENT, { detail }));
    });
}

/** Runs when a connection started from this window finishes. */
export function useConnectionFinished(handler: (result: ConnectionResult) => void): void {
    const latest = useRef(handler);
    useEffect(() => {
        latest.current = handler;
    });
    useEffect(() => {
        const listener = (event: Event) => latest.current((event as CustomEvent<ConnectionResult>).detail);
        window.addEventListener(FINISHED_EVENT, listener);
        return () => window.removeEventListener(FINISHED_EVENT, listener);
    }, []);
}
