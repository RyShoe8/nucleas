import type { PublishingConfig } from './config';

export function applyAdminFieldRules(config: Pick<PublishingConfig, 'adminFieldRules' | 'adminValueField' | 'adminLinkField'>, values: Record<string, string | boolean>, valuePct?: number, sourceLink?: string | null): Record<string, string | boolean> {
  const result = { ...values };
  for (const rule of config.adminFieldRules ?? []) {
    const applies = rule.whenValueOverPct === undefined || (valuePct !== undefined && Number.isFinite(valuePct) && valuePct / 100 > rule.whenValueOverPct / 100 + Number.EPSILON);
    const value = applies ? rule.value : rule.otherwise;
    if (value === undefined) delete result[rule.field];
    else result[rule.field] = value;
  }
  if (config.adminValueField) {
    if (valuePct !== undefined && Number.isFinite(valuePct)) result[config.adminValueField] = String(Math.round(valuePct * 100) / 100);
    else delete result[config.adminValueField];
  }
  if (config.adminLinkField) {
    delete result[config.adminLinkField];
    if (sourceLink) {
      try {
        const url = new URL(sourceLink);
        if (url.protocol === 'https:' || url.protocol === 'http:') result[config.adminLinkField] = sourceLink;
      } catch { /* Do not replace missing source links with invented URLs. */ }
    }
  }
  return result;
}
