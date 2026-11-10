import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const caps: Record<string, number | null> = { acme: 500_000, other: 3_000_000, unset: null };
vi.mock('./settings', () => ({ readBudgetSettings: async (organizationId: string) => ({ value: { itemCapMicros: caps[organizationId] ?? null } }) }));

import { DEFAULT_ITEM_CAP_MICROS, itemCapRefusal, itemSpend, readItemCapMicros, recordItemSpend, withItemCap } from './itemCap';

describe('the cap on a single piece of work', () => {
  it('lets paid calls run until the total reaches the organization cap, then refuses with a budget message', async () => {
    await withItemCap('question', async () => {
      expect(await itemCapRefusal('acme')).toBeNull();
      recordItemSpend(300_000);
      expect(await itemCapRefusal('acme')).toBeNull();
      recordItemSpend(200_000);
      const refusal = await itemCapRefusal('acme');
      expect(refusal).toContain('AI budget cannot reserve');
      expect(refusal).toContain('$0.50 of the $0.50');
      expect(refusal).toContain('question');
    });
  });

  it('counts work started inside another piece of work toward the outer one', async () => {
    await withItemCap('question', async () => {
      recordItemSpend(100_000);
      await withItemCap('plan', async () => {
        recordItemSpend(450_000);
      });
      expect(await itemCapRefusal('acme')).not.toBeNull();
      expect(itemSpend()).toEqual({ spentMicros: 550_000, capMicros: 500_000 });
    });
  });

  it('keeps separate pieces of work apart, and does nothing outside one', async () => {
    recordItemSpend(9_000_000);
    expect(await itemCapRefusal('acme')).toBeNull();
    expect(itemSpend()).toBeNull();
    const [a, b] = await Promise.all([
      withItemCap('run', async () => { recordItemSpend(499_999); return itemCapRefusal('acme'); }),
      withItemCap('run', async () => { recordItemSpend(500_000); return itemCapRefusal('acme'); }),
    ]);
    expect(a).toBeNull();
    expect(b).not.toBeNull();
  });

  it('uses each organization\'s own cap, and the default until one is set', async () => {
    expect(await readItemCapMicros('acme')).toBe(500_000);
    expect(await readItemCapMicros('other')).toBe(3_000_000);
    expect(await readItemCapMicros('unset')).toBe(DEFAULT_ITEM_CAP_MICROS);
    const spend = 1_000_000;
    expect(await withItemCap('run', async () => { recordItemSpend(spend); return itemCapRefusal('acme'); })).not.toBeNull();
    expect(await withItemCap('run', async () => { recordItemSpend(spend); return itemCapRefusal('other'); })).toBeNull();
  });
});
