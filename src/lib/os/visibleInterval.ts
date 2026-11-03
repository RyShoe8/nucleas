/** Run recurring UI refreshes only while this document is visible.
 * Returning to the window refreshes immediately, then resumes the normal cadence.
 */
export function visibleInterval(refresh: () => void, delay: number): () => void {
    let timer: number | undefined;
    const stop = () => {
        window.clearInterval(timer);
        timer = undefined;
    };
    const start = () => {
        if (!document.hidden && timer === undefined) timer = window.setInterval(refresh, delay);
    };
    const changed = () => {
        stop();
        if (!document.hidden) {
            refresh();
            start();
        }
    };
    start();
    document.addEventListener('visibilitychange', changed);
    return () => {
        stop();
        document.removeEventListener('visibilitychange', changed);
    };
}
