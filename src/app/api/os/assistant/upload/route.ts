import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { requireCompanyViewer } from '@/lib/companies/osRouteContext';
import { uploadPrefix } from '@/lib/ai/attachments/uploads';

export const dynamic = 'force-dynamic';

/**
 * Issues a one-time token so the browser can upload an Ask attachment straight to Blob storage
 * (no request size limit). Only into the signed-in user's own folder; files are deleted once read.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 });
  // Upload-completed callbacks come from Vercel, not the browser; nothing to do for them.
  if (body.type === 'blob.upload-completed') {
    return NextResponse.json(await handleUpload({ body, request, onBeforeGenerateToken: async () => ({}), onUploadCompleted: async () => undefined }));
  }
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(uploadPrefix(viewer.userId)) || pathname.includes('..')) {
          throw new Error('Uploads must go to your own folder.');
        }
        return { addRandomSuffix: true, validUntil: Date.now() + 60 * 60 * 1000 };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload could not start.' }, { status: 400 });
  }
}

/** Removes an attachment the user took off before sending: { pathname } in their own folder. */
export async function DELETE(request: NextRequest) {
  const viewer = await requireCompanyViewer(request);
  if (viewer instanceof NextResponse) return viewer;
  const body = (await request.json().catch(() => ({}))) as { pathname?: unknown };
  if (typeof body.pathname !== 'string' || !body.pathname.startsWith(uploadPrefix(viewer.userId)) || body.pathname.includes('..')) {
    return NextResponse.json({ error: 'That upload does not belong to you.' }, { status: 403 });
  }
  await del(body.pathname).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
