import { expect, it } from 'vitest';
import { revenueMetricVisible } from './revenueVisibility';
it('shows payment metrics without unconnected advertising platforms', () => {
    const connections = [{ provider: 'stripe', status: 'connected' }, { provider: 'adsense', status: 'declared' }, { provider: 'admanager', status: 'disabled' }];
    for (const key of ['revenue_total', 'subscriber_revenue', 'mrr', 'yrr']) expect(revenueMetricVisible(key, connections)).toBe(true);
    for (const key of ['ad_revenue', 'adx_revenue', 'adx_impressions', 'adx_clicks']) expect(revenueMetricVisible(key, connections)).toBe(false);
});
it('shows only connected ad sources and hides revenue when none are connected', () => {
    const connections = [{ provider: 'admanager', status: 'connected' }];
    expect(revenueMetricVisible('revenue_total', connections)).toBe(true);
    expect(revenueMetricVisible('adx_revenue', connections)).toBe(true);
    expect(revenueMetricVisible('ad_revenue', connections)).toBe(false);
    expect(revenueMetricVisible('mrr', connections)).toBe(false);
    expect(revenueMetricVisible('revenue_total', [])).toBe(false);
});
