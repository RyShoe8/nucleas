import { describe, expect, it, vi } from 'vitest';
import { retryDatabaseRead } from './retryRead';

describe('retryDatabaseRead', () => {
  it('recovers a transient pool failure with a fresh read', async () => {
    const error = Object.assign(new Error('connection reset'), { name: 'MongoNetworkError' });
    const read = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ready');
    expect(await retryDatabaseRead('test', read)).toBe('ready');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('bounds retries when the database stays unavailable', async () => {
    const error = Object.assign(new Error('pool cleared'), { name: 'MongoPoolClearedError' });
    const read = vi.fn().mockRejectedValue(error);
    await expect(retryDatabaseRead('test', read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('does not retry validation or authorization errors', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Forbidden'));
    await expect(retryDatabaseRead('test', read)).rejects.toThrow('Forbidden');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
