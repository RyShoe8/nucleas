import { describe, expect, it } from 'vitest';
import { connectionReturnPath } from './connectionReturn';
const company = '0123456789abcdef01234567';
describe('Connection sign-in return destination', () => {
    it('preserves the selected company and Ad Manager scope', () => {
        const path = `/api/os/integrations/google/start?companyId=${company}&provider=admanager`;
        expect(connectionReturnPath(path)).toBe(path);
    });
    it('rejects external destinations, unrelated actions and invalid companies', () => {
        for (const path of ['https://evil.test/api/os/integrations/google/start?companyId='+company, '//evil.test/', '/api/auth/logout', '/api/os/integrations/google/start?companyId=nope']) expect(connectionReturnPath(path)).toBeNull();
    });
    it('drops unknown query parameters and scopes', () => {
        expect(connectionReturnPath(`/api/os/integrations/google/start?companyId=${company}&provider=unexpected&returnTo=https://evil.test`)).toBe(`/api/os/integrations/google/start?companyId=${company}`);
    });
});
