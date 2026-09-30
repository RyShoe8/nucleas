import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { applyThreadAction, moveThread, teachFilter, type ThreadAction } from '@/lib/mail/messages';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const ACTIONS: ThreadAction[] = ['read', 'unread', 'archive', 'star', 'unstar', 'trash'];
const BUCKETS = ['important', 'normal', 'updates', 'promotions', 'suspicious'] as const;

/**
 * Do something to a conversation: { accountId, threadId, action } where action is read | unread | archive | star |
 * unstar | trash | spam | not_spam (with scope: sender | domain) | move (with bucket).
 */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const b = (await request.json().catch(() => ({}))) as { accountId?: unknown; threadId?: unknown; action?: unknown; scope?: unknown; bucket?: unknown };
  if (typeof b.accountId !== 'string' || typeof b.threadId !== 'string' || typeof b.action !== 'string') return NextResponse.json({ error: 'accountId, threadId and action are required.' }, { status: 400 });
  const base = { accountId: b.accountId, threadId: b.threadId };
  let result;
  if ((ACTIONS as string[]).includes(b.action)) result = await applyThreadAction(viewer, { ...base, action: b.action as ThreadAction });
  else if (b.action === 'spam' || b.action === 'not_spam') result = await teachFilter(viewer, { ...base, verdict: b.action, scope: b.scope === 'domain' ? 'domain' : 'sender' });
  else if (b.action === 'move' && (BUCKETS as readonly unknown[]).includes(b.bucket)) result = await moveThread(viewer, { ...base, bucket: b.bucket as (typeof BUCKETS)[number] });
  else return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
}
