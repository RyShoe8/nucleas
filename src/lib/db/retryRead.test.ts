import { describe, expect, it, vi } from 'vitest';
import { retryDatabaseRead, retryIdempotentWrite } from './retryRead';

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
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('does not retry validation or authorization errors', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Forbidden'));
    await expect(retryDatabaseRead('test', read)).rejects.toThrow('Forbidden');
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('retryIdempotentWrite', () => {
  it('retries a settings save after a dropped connection, then succeeds', async () => {
    const error = Object.assign(new Error('connection closed'), { name: 'MongoNetworkError' });
    const write = vi.fn().mockRejectedValueOnce(error).mockRejectedValueOnce(Object.assign(new Error('cleared'), { name: 'MongoPoolClearedError' })).mockResolvedValue({ ok: true });
    expect(await retryIdempotentWrite('test', write)).toEqual({ ok: true });
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('gives up after four attempts and never retries other errors', async () => {
    const down = Object.assign(new Error('selection'), { name: 'MongoServerSelectionError' });
    const stuck = vi.fn().mockRejectedValue(down);
    await expect(retryIdempotentWrite('test', stuck)).rejects.toBe(down);
    expect(stuck).toHaveBeenCalledTimes(4);
    const invalid = vi.fn().mockRejectedValue(new Error('Validation failed'));
    await expect(retryIdempotentWrite('test', invalid)).rejects.toThrow('Validation failed');
    expect(invalid).toHaveBeenCalledTimes(1);
  });
});
