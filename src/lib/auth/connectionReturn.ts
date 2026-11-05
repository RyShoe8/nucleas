/** Only company connection entry points may be resumed after browser sign-in. */
export function connectionReturnPath(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value, 'https://nucleas.app');
        if (url.origin === 'https://nucleas.app' && url.pathname === '/api/os/content/gmail/start') {
            const email = url.searchParams.get('email');
            const kept = new URLSearchParams();
            if (email && email.length <= 200 && /^[^\s@]+@[^\s@]+$/.test(email)) kept.set('email', email);
            if (/^[a-f0-9]{32}$/.test(url.searchParams.get('desktopFlow') ?? '')) kept.set('desktopFlow', url.searchParams.get('desktopFlow')!);
            return kept.size ? `${url.pathname}?${kept}` : url.pathname;
        }
        if (url.origin === 'https://nucleas.app' && url.pathname === '/api/os/mail/google/start') {
            const company = url.searchParams.get('companyId');
            const kept = new URLSearchParams();
            if (company && /^[a-f0-9]{24}$/i.test(company)) kept.set('companyId', company);
            if (/^[a-f0-9]{32}$/.test(url.searchParams.get('desktopFlow') ?? '')) kept.set('desktopFlow', url.searchParams.get('desktopFlow')!);
            return kept.size ? `${url.pathname}?${kept}` : url.pathname;
        }
        if (url.origin === 'https://nucleas.app' && (url.pathname === '/api/scheduling/google/connect' || url.pathname === '/api/google/workspace/connect')) return url.pathname;
        if (url.origin !== 'https://nucleas.app' || !['/api/os/integrations/google/start', '/api/os/integrations/facebook/start'].includes(url.pathname)) return null;
        const companyId = url.searchParams.get('companyId');
        if (!companyId || !/^[a-f0-9]{24}$/i.test(companyId)) return null;
        const result = new URLSearchParams({ companyId });
        const flow = url.searchParams.get('desktopFlow');
        if (flow && /^[a-f0-9]{32}$/.test(flow)) result.set('desktopFlow', flow);
        const provider = url.searchParams.get('provider');
        if (provider && ['ga4', 'gsc', 'adsense', 'admanager'].includes(provider)) result.set('provider', provider);
        return `${url.pathname}?${result}`;
    } catch { return null; }
}
