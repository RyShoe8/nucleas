import { describe, expect, it } from 'vitest';
import { signatureOutreachDesign, signatureQualificationFields, upgradeSignatureFields } from './signatureOutreach';
import { jobDesignSchema } from '../schema';

describe('signature evidence fields', () => {
  it('includes typed required fields in new and older saved jobs', () => {
    const current = signatureOutreachDesign();
    const keys = new Set(signatureQualificationFields.map(field => field.key));
    const legacy = { ...current, fields: current.fields.filter(field => !keys.has(field.key)) };
    for (const design of [current, upgradeSignatureFields(legacy), upgradeSignatureFields(upgradeSignatureFields(legacy))]) {
      expect(jobDesignSchema.safeParse(design).success).toBe(true);
      for (const field of signatureQualificationFields) {
        expect(design.fields.filter(f => f.key === field.key)).toEqual([field]);
      }
    }
    expect(upgradeSignatureFields(legacy).schedule).toEqual(legacy.schedule);
  });
});
