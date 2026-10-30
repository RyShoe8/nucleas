import { describe, expect, it } from 'vitest';
import { altFromFileName } from './PublishingImagePicker';

describe('the description an uploaded image starts with', () => {
  it('comes from the file name when none was typed', () => {
    expect(altFromFileName('Game_Nights-Image.png')).toBe('Game Nights Image');
    expect(altFromFileName('weekly  roundup.final.jpeg')).toBe('weekly roundup.final');
    expect(altFromFileName('.png')).toBe('Social image');
  });
});
