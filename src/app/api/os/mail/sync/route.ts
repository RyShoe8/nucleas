import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { MailAccount } from '@/lib/models/Mail';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { canUseMail, MAIL_FORBIDDEN, syncAccount } from '@/lib/mail/accounts';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** "Sync now": one mailbox ({ accountId }) or all of them. */
export async function POST(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  if (!canUseMail(viewer)) return NextResponse.json({ error: MAIL_FORBIDDEN }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { accountId?: unknown };
  const filter: Record<string, unknown> = { organizationId: viewer.organizationId };
  if (typeof body.accountId === 'string' && Types.ObjectId.isValid(body.accountId)) filter._id = new Types.ObjectId(body.accountId);
  const accounts = await MailAccount.find(filter).select('_id').limit(20).lean<{ _id: Types.ObjectId }[]>();
  const results = await Promise.all(accounts.map((a) => syncAccount(a._id)));
  return NextResponse.json({ synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.error)) });
}
