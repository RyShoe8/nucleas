import type { PublishingConfig } from './config';

export function applyAdminFieldRules(config: Pick<PublishingConfig, 'adminFieldRules' | 'adminValueField'>, values: Record<string, string | boolean>, valuePct?: number): Record<string, string | boolean> {
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
  return result;
}
