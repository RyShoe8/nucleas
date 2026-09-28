import { describe, expect, it } from 'vitest';
import { ideChatSchema } from '@/lib/ide/ideChatSchema';

describe('ideChatSchema', () => {
  it('requires modelProfileId and model for Direct mode', () => {
    const missing = ideChatSchema.safeParse({ mode: 'direct', text: 'hello' });
    expect(missing.success).toBe(false);

    const ok = ideChatSchema.safeParse({
      mode: 'direct',
      text: 'hello',
      modelProfileId: '507f1f77bcf86cd799439011',
      model: 'Qwen/local-coder',
    });
    expect(ok.success).toBe(true);
  });

  it('allows worker modes without Direct fields', () => {
    const ok = ideChatSchema.safeParse({ mode: 'engineering', text: 'ship it' });
    expect(ok.success).toBe(true);
  });

  it('normalizes legacy Plan/Build mode ids', () => {
    const ok = ideChatSchema.safeParse({ mode: 'build', text: 'ship it' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.mode).toBe('orchestrated');
  });

  it('ignores optional Direct fields on worker modes', () => {
    const ok = ideChatSchema.safeParse({
      mode: 'product',
      text: 'outline',
      modelProfileId: '507f1f77bcf86cd799439011',
      model: 'gpt-4o-mini',
    });
    expect(ok.success).toBe(true);
  });
});
