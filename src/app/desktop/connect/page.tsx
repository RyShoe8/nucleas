import { getSession } from '@/lib/auth/session';
import { readDesktopGrant, validDesktopId } from '@/lib/auth/desktopGrant';
import DesktopApproval from './DesktopApproval';

export const dynamic = 'force-dynamic';
export default async function Connect({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
    const { request } = await searchParams;
    const grant = validDesktopId(request) ? await readDesktopGrant(request) : null;
    const session = await getSession();
    return <main className="mx-auto max-w-lg p-10 space-y-6">
        <h1 className="text-2xl font-semibold">Connect Nucleas Desktop</h1>
        {!grant ? <p>This request expired. Start sign-in again from the desktop app.</p> : !session ? <><p>Sign in here in your browser, then connect your desktop app.</p><a className="ui-button" href="/login">Sign in to Nucleas</a></> : <>
            <p>Connect as {session.email}. Only continue if you started this request in Nucleas Desktop and this code matches the app:</p>
            <p className="text-3xl tracking-widest font-mono">{grant.code}</p>
            <DesktopApproval requestId={request!} />
        </>}
    </main>;
}
