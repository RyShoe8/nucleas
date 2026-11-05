import { NextRequest, NextResponse } from 'next/server';
import { loginFirstForConnection } from '@/lib/auth/connectionStart';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseWatches, WATCHES_FORBIDDEN } from '@/lib/watches/access';
import { buildWatchAuthUrl, createWatchState, googleCredentials, watchRedirectUri } from '@/lib/watches/mailboxes';

export const dynamic = 'force-dynamic';

const desktopFlowOf = (request: NextRequest) => {
  const flow = request.nextUrl.searchParams.get('desktopFlow') ?? '';
  return /^[a-f0-9]{32}$/.test(flow) ? flow : undefined;
};

/**
 * Starts Google sign-in for a mailbox a watch will read (read-only Gmail access). It opens in the system browser,
 * from the desktop app or from a reconnect email, where Nucleas may not be signed in yet, so it resumes after login.
 */
export async function GET(request: NextRequest) {
  const login = await loginFirstForConnection(request);
  if (login) return login;
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseWatches(viewer)) return NextResponse.json({ error: WATCHES_FORBIDDEN }, { status: 403 });
  const redirectUri = watchRedirectUri(request.url);
  let clientId: string;
  try {
    clientId = googleCredentials().clientId;
  } catch {
    return NextResponse.json({ error: 'Google sign-in is not configured.' }, { status: 503 });
  }
  if (!redirectUri) return NextResponse.json({ error: 'Google sign-in is not available on this host.' }, { status: 500 });
  const loginHint = request.nextUrl.searchParams.get('email')?.slice(0, 200) || undefined;
  return NextResponse.redirect(buildWatchAuthUrl({ clientId, redirectUri, state: await createWatchState(viewer.userId, desktopFlowOf(request)), loginHint }));
}
