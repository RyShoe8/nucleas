/** Retry only page reads invalidated by a redirect. Never wrap a click, fill or submission. */
export async function readAfterNavigation<T>(page: { waitForLoadState: (state: 'domcontentloaded', options: { timeout: number }) => Promise<void>; waitForTimeout: (ms: number) => Promise<void> }, phase: string, read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await read(); } catch (error) {
      if (!(error instanceof Error) || !/Execution context was destroyed|Cannot find context with specified id/.test(error.message) || attempt >= 3) throw error;
      console.warn('[browser/read] page changed', { phase, attempt });
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }
}
