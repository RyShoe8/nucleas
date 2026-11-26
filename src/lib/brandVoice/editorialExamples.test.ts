import { describe, expect, it } from 'vitest';
import { editorialExample } from './editorialExamples';

describe('learning from human edits', () => {
  it('separates possible factual corrections from stylistic edits', () => {
    expect(editorialExample('The plan costs $8.', 'The plan costs $10.')?.kind).toBe('possible_factual_correction');
    expect(editorialExample('Try https://old.example.', 'Try https://new.example.')?.kind).toBe('possible_factual_correction');
    expect(editorialExample('Amazing value for everyone!', 'Worth a look if the features fit.')?.kind).toBe('editorial');
    expect(editorialExample(' Same text ', 'Same text')).toBeNull();
  });
});
