import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import Asset from '@/lib/models/Asset';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/auth/middleware';
import { isValidObjectId } from '@/lib/utils/security';
import { getOrganizationUserIds } from '@/lib/utils/apiHelpers';
import {
  buildAssetAccessScope,
  canAccessAsset,
  getAssetSessionContext,
} from '@/lib/assets/assetAccess';

/** Serve stored image bytes/URL for IDE lightbox and <img> tags. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    await connectDB();
    const { id } = await params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: 'Invalid asset ID' }, { status: 400 });
    }

    const ctx = await getAssetSessionContext(session.userId);
    if (ctx instanceof NextResponse) return ctx;

    const user = await User.findById(session.userId);
    if (!user?.organizationId) {
      return NextResponse.json({ error: 'User or organization not found' }, { status: 404 });
    }

    const orgUserIds = await getOrganizationUserIds(session.userId, user.organizationId);
    const asset = await Asset.findOne({ _id: id, userId: { $in: orgUserIds } })
      .select('url fileUrl type userId linkedClientId linkedProjectId linkedContentItemId')
      .lean();
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    if (!ctx.isManagerOrAdmin) {
      const scope = await buildAssetAccessScope(ctx);
      if (!canAccessAsset(ctx, asset, scope)) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
      }
    }

    const source = (asset.fileUrl || asset.url || '').trim();
    if (!source) {
      return NextResponse.json({ error: 'Asset has no image content.' }, { status: 404 });
    }

    if (source.startsWith('data:image/')) {
      const match = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
      if (!match) {
        return NextResponse.json({ error: 'Invalid stored image.' }, { status: 500 });
      }
      const mime = match[1]!;
      const buffer = Buffer.from(match[2]!, 'base64');
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'private, max-age=3600',
          'Content-Length': String(buffer.byteLength),
        },
      });
    }

    if (source.startsWith('https://')) {
      return NextResponse.redirect(source, 302);
    }

    return NextResponse.json({ error: 'Unsupported asset image source.' }, { status: 415 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
