/** Only company connection entry points may be resumed after browser sign-in. */
export function connectionReturnPath(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value, 'https://nucleas.app');
        if (url.origin !== 'https://nucleas.app' || !['/api/os/integrations/google/start', '/api/os/integrations/facebook/start'].includes(url.pathname)) return null;
        const companyId = url.searchParams.get('companyId');
        if (!companyId || !/^[a-f0-9]{24}$/i.test(companyId)) return null;
        const result = new URLSearchParams({ companyId });
        const provider = url.searchParams.get('provider');
        if (provider && ['ga4', 'gsc', 'adsense', 'admanager'].includes(provider)) result.set('provider', provider);
        return `${url.pathname}?${result}`;
    } catch { return null; }
}
