/** What app windows in the desktop app need that a single browser page gets for free. */

const MAX_VALUE = 2000;
const MAX_ENTRIES = 30;

/**
 * A window's context as the desktop app accepts it: strings only, at most 30, each at most 2000 characters. It
 * refuses anything else, so an absent name or a long brief would otherwise stop the window from opening at all.
 */
export function desktopPayload(payload: Record<string, unknown> | undefined): Record<string, string> | undefined {
    if (!payload) return undefined;
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload).slice(0, MAX_ENTRIES)) {
        if (key.length > 80) continue;
        if (typeof value === 'string') clean[key] = value.slice(0, MAX_VALUE);
        else if (typeof value === 'number' || typeof value === 'boolean') clean[key] = String(value);
    }
    return clean;
}

/**
 * The address to open in its own window when this link is clicked, or null to leave it alone. App windows have no
 * back button, so a link to a full page (a recording, Assets) must not replace the app the person is using.
 */
export function pageLinkToOpen(link: { href: string; target?: string; hasDownload?: boolean }, pageUrl: string): string | null {
    if (link.hasDownload || (link.target && link.target !== '_self')) return null;
    let url: URL;
    const page = new URL(pageUrl);
    try {
        url = new URL(link.href, page);
    } catch {
        return null;
    }
    if (url.origin !== page.origin) return null;
    if (url.pathname === page.pathname) return null;
    if (url.pathname === '/login' || url.pathname.startsWith('/api/')) return null;
    return url.href;
}

/** Sends clicks on full-page links to their own window. Returns a function that stops doing so. */
export function openPagesInOwnWindow(): () => void {
    const onClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = pageLinkToOpen({ href: anchor.href, target: anchor.target, hasDownload: anchor.hasAttribute('download') }, window.location.href);
        if (!href) return;
        event.preventDefault();
        event.stopPropagation();
        window.open(href, '_blank');
    };
    // Capture phase: this has to run before a framework link handles the click inside the page.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
}

/** Events that tell other windows to refresh. On the web they share a page; desktop windows are separate processes. */
const SHARED_EVENTS = ['nucleas:jobs-changed', 'nucleas:companies-changed', 'nucleas:voice-changed', 'nucleas:voice-generated'];

/** Relays those events between desktop windows. Returns a function that stops relaying. */
export function shareWindowEvents(target: Window = window, channel: BroadcastChannel = new BroadcastChannel('nucleas-desktop-events')): () => void {
    let relaying = false;
    const send = (event: Event) => {
        if (!relaying) channel.postMessage(event.type);
    };
    for (const name of SHARED_EVENTS) target.addEventListener(name, send);
    const receive = (message: MessageEvent) => {
        if (!SHARED_EVENTS.includes(message.data)) return;
        // dispatchEvent runs listeners synchronously, so this keeps a received event from being sent back out.
        relaying = true;
        try {
            target.dispatchEvent(new Event(message.data as string));
        } finally {
            relaying = false;
        }
    };
    channel.addEventListener('message', receive);
    return () => {
        for (const name of SHARED_EVENTS) target.removeEventListener(name, send);
        channel.removeEventListener('message', receive);
        channel.close();
    };
}
