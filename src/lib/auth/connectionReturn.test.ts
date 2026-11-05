import { describe, expect, it } from 'vitest';
import { connectionReturnPath } from './connectionReturn';
const company = '0123456789abcdef01234567';
describe('Connection sign-in return destination', () => {
    it('keeps the desktop completion identifier through browser login', () => {
        const flow = 'a'.repeat(32);
        expect(connectionReturnPath(`/api/os/integrations/facebook/start?companyId=${company}&desktopFlow=${flow}`)).toBe(`/api/os/integrations/facebook/start?companyId=${company}&desktopFlow=${flow}`);
        expect(connectionReturnPath(`/api/os/integrations/facebook/start?companyId=${company}&desktopFlow=invalid`)).toBe(`/api/os/integrations/facebook/start?companyId=${company}`);
    });
    it('preserves the selected company and Ad Manager scope', () => {
        const path = `/api/os/integrations/google/start?companyId=${company}&provider=admanager`;
        expect(connectionReturnPath(path)).toBe(path);
    });
    it('resumes connecting a mailbox, keeping only a valid address', () => {
        expect(connectionReturnPath('/api/os/content/gmail/start')).toBe('/api/os/content/gmail/start');
        expect(connectionReturnPath('/api/os/content/gmail/start?email=deals%40example.com&returnTo=https://evil.test')).toBe('/api/os/content/gmail/start?email=deals%40example.com');
        expect(connectionReturnPath('/api/os/content/gmail/start?email=not-an-address')).toBe('/api/os/content/gmail/start');
    });
    it('keeps the desktop completion identifier for mailboxes too', () => {
        const flow = 'b'.repeat(32);
        expect(connectionReturnPath(`/api/os/content/gmail/start?email=deals%40example.com&desktopFlow=${flow}`)).toBe(`/api/os/content/gmail/start?email=deals%40example.com&desktopFlow=${flow}`);
        expect(connectionReturnPath(`/api/os/content/gmail/start?desktopFlow=${flow}`)).toBe(`/api/os/content/gmail/start?desktopFlow=${flow}`);
        expect(connectionReturnPath('/api/os/content/gmail/start?desktopFlow=invalid')).toBe('/api/os/content/gmail/start');
        expect(connectionReturnPath(`/api/os/mail/google/start?companyId=${company}&desktopFlow=${flow}`)).toBe(`/api/os/mail/google/start?companyId=${company}&desktopFlow=${flow}`);
    });
    it('resumes connecting Mail, Calendar and Workspace, dropping anything else from the address', () => {
        expect(connectionReturnPath(`/api/os/mail/google/start?companyId=${company}&x=1`)).toBe(`/api/os/mail/google/start?companyId=${company}`);
        expect(connectionReturnPath('/api/os/mail/google/start?companyId=nope')).toBe('/api/os/mail/google/start');
        expect(connectionReturnPath('/api/scheduling/google/connect?returnTo=https://evil.test')).toBe('/api/scheduling/google/connect');
        expect(connectionReturnPath('/api/google/workspace/connect?returnTo=https://evil.test')).toBe('/api/google/workspace/connect');
    });
    it('rejects external destinations, unrelated actions and invalid companies', () => {
        for (const path of ['https://evil.test/api/os/integrations/google/start?companyId='+company, '//evil.test/', '/api/auth/logout', '/api/os/integrations/google/start?companyId=nope']) expect(connectionReturnPath(path)).toBeNull();
    });
    it('drops unknown query parameters and scopes', () => {
        expect(connectionReturnPath(`/api/os/integrations/google/start?companyId=${company}&provider=unexpected&returnTo=https://evil.test`)).toBe(`/api/os/integrations/google/start?companyId=${company}`);
    });
});
