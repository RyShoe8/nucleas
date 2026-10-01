import { describe, expect, it } from 'vitest';
import { jobDesignSchema } from '../schema';
import { linkBuildingConfigSchema, linkBuildingDesign } from './linkBuilding';

describe('link-building skill', () => {
  it('creates a recommendation-only recurring design with browser fallback', () => {
    const config = linkBuildingConfigSchema.parse({
      projectId: 'project-1',
      schedule: { kind: 'daily', time: '09:00', timezone: 'America/Chicago' },
      recordsPerRun: 1,
      country: 'United States',
      language: 'English',
      exclusions: '',
    });
    const design = jobDesignSchema.parse(linkBuildingDesign(config));
    expect(design.skill).toBe('link_building');
    expect(design.recommendedCompletion).toBe('review');
    expect(design.delivery.method).toBe('nucleas');
    expect(design.instructions).toContain('browser_navigate');
    expect(design.instructions).toContain('Do not submit');
    expect(design.fields.map((field) => field.key)).toEqual(expect.arrayContaining(['strategic_reason', 'relevance_score', 'relevance_evidence', 'estimated_authority', 'target_keywords', 'target_url', 'submission_copy']));
  });
});
