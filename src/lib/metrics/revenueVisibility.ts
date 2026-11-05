/** Sources currently feeding the company Revenue cards. */
const SOURCES: Record<string, readonly string[]> = {
    revenue_total: ['stripe', 'adsense', 'admanager'],
    subscriber_revenue: ['stripe'],
    ad_revenue: ['adsense'],
    adx_revenue: ['admanager'],
    adx_impressions: ['admanager'],
    adx_clicks: ['admanager'],
    mrr: ['stripe'],
    yrr: ['stripe'],
};
export function revenueMetricVisible(key: string, connections: readonly { provider: string; status: string }[]): boolean {
    return (SOURCES[key] ?? []).some(provider => connections.some(connection => connection.provider === provider && connection.status === 'connected'));
}
