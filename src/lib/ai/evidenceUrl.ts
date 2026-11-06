/** Two links to the same page often differ only by a fragment, a trailing slash or letter case. */
export const sameUrl = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
