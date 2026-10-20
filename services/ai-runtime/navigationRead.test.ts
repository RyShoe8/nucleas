import { expect, it, vi } from 'vitest';
import { readAfterNavigation } from './navigationRead';
const page = () => ({ waitForLoadState: vi.fn(async () => {}), waitForTimeout: vi.fn(async () => {}) });
it('retries a read after a redirect destroys its context', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('Execution context was destroyed, most likely because of a navigation')).mockResolvedValue('Saved');
  const p = page();
  expect(await readAfterNavigation(p, 'confirmation', read)).toBe('Saved');
  expect(read).toHaveBeenCalledTimes(2);
  expect(p.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 10000 });
});
it('does not retry unrelated failures', async () => {
  const read = vi.fn().mockRejectedValue(new Error('Access denied'));
  await expect(readAfterNavigation(page(), 'confirmation', read)).rejects.toThrow('Access denied');
  expect(read).toHaveBeenCalledTimes(1);
});
it('limits retries when navigation never settles', async () => {
  const read = vi.fn().mockRejectedValue(new Error('Execution context was destroyed'));
  await expect(readAfterNavigation(page(), 'confirmation', read)).rejects.toThrow('Execution context');
  expect(read).toHaveBeenCalledTimes(3);
});
