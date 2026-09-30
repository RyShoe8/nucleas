import { NextRequest, NextResponse } from 'next/server';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { fetchAttachment } from '@/lib/mail/messages';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ messageId: string; attachmentId: string }> };

/** Streams an attachment straight from Gmail (attachments are not stored in Nucleas). Always a download, never rendered. */
export async function GET(request: NextRequest, { params }: Context) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const { messageId, attachmentId } = await params;
  const file = await fetchAttachment(viewer, messageId, decodeURIComponent(attachmentId)).catch(() => null);
  if (!file) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  const safeName = file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'attachment';
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
