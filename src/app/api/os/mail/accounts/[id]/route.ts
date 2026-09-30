import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { removeAccount, updateAccount } from '@/lib/mail/accounts';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

/** Rename a mailbox, colour it, or file it under a company (companyId: null clears it). */
export async function PATCH(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { label?: unknown; color?: unknown; companyId?: unknown };
  const result = await updateAccount(viewer, (await params).id, {
    ...(typeof body.label === 'string' ? { label: body.label } : {}),
    ...(typeof body.color === 'string' ? { color: body.color } : {}),
    ...(body.companyId === null || typeof body.companyId === 'string' ? { companyId: body.companyId as string | null } : {}),
  });
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
}

/** Disconnect a mailbox and delete its synced copy. Gmail itself is untouched. */
export async function DELETE(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const result = await removeAccount(viewer, (await params).id);
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
}
