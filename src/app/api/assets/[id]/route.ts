import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import Asset, { AssetType } from '@/lib/models/Asset';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/auth/middleware';
import { isValidObjectId, sanitizeString } from '@/lib/utils/security';
import { getOrganizationUserIds } from '@/lib/utils/apiHelpers';
import { isManagerOrAdminRole } from '@/lib/utils/roles';
import { validateAssetLinkExclusivity } from '@/lib/assets/validateAssetLinks';
import {
  assertCanLinkAsset,
  buildAssetAccessScope,
  canAccessAsset,
  getAssetSessionContext,
} from '@/lib/assets/assetAccess';
import { deleteStoredFile } from '@/lib/storage/deleteStoredFile';

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
    if (!user || !user.organizationId) {
      return NextResponse.json({ error: 'User or organization not found' }, { status: 404 });
    }

    const orgUserIds = await getOrganizationUserIds(session.userId, user.organizationId);

    const asset = await Asset.findOne({ _id: id, userId: { $in: orgUserIds } }).lean();
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    if (!ctx.isManagerOrAdmin) {
      const scope = await buildAssetAccessScope(ctx);
      if (!canAccessAsset(ctx, asset, scope)) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
      }
    }

    return NextResponse.json(asset);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    const body = await request.json();
    const { name, type, url, textContent, description, category, tags, linkedProjectId, linkedClientId, linkedProjectTaskIndex, linkedProjectTaskId, linkedContentItemId, clientAccessible } = body;

    await connectDB();
    const { id } = await params;

    // Validate ObjectId format
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: 'Invalid asset ID' }, { status: 400 });
    }

    if (linkedClientId && !isValidObjectId(linkedClientId)) {
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
    }
    if (linkedProjectId && !isValidObjectId(linkedProjectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }
    if (linkedProjectTaskId && !isValidObjectId(linkedProjectTaskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    if (linkedContentItemId && !isValidObjectId(linkedContentItemId)) {
      return NextResponse.json({ error: 'Invalid content item ID' }, { status: 400 });
    }

    // Get user's organizationId
    const user = await User.findById(session.userId);
    if (!user || !user.organizationId) {
      return NextResponse.json({ error: 'User or organization not found' }, { status: 404 });
    }

    const orgUserIds = await getOrganizationUserIds(session.userId, user.organizationId);

    const ctx = await getAssetSessionContext(session.userId);
    if (ctx instanceof NextResponse) return ctx;

    const asset = await Asset.findOne({ _id: id, userId: { $in: orgUserIds } });
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    if (!ctx.isManagerOrAdmin) {
      const scope = await buildAssetAccessScope(ctx);
      if (!canAccessAsset(ctx, asset.toObject(), scope)) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
      }
    }

    // Sanitize string inputs
    if (name !== undefined) asset.name = sanitizeString(name, 200);
    if (type !== undefined) {
      const validTypes: AssetType[] = ['spreadsheet', 'document', 'tool', 'folder', 'link', 'screenshot', 'file', 'text', 'other'];
      if (!validTypes.includes(type as AssetType)) {
        return NextResponse.json({ error: 'Invalid asset type' }, { status: 400 });
      }
      asset.type = type as AssetType;
    }
    if (url !== undefined) asset.url = sanitizeString(url, 500);
    if (textContent !== undefined) asset.textContent = sanitizeString(textContent, 50000); // Allow up to 50KB of text
    if (description !== undefined) asset.description = sanitizeString(description, 2000);
    if (category !== undefined) asset.category = sanitizeString(category, 100);
    if (tags !== undefined) {
      // Validate tags is an array and sanitize each tag
      if (!Array.isArray(tags)) {
        return NextResponse.json({ error: 'Tags must be an array' }, { status: 400 });
      }
      asset.tags = tags.map((tag: unknown) => sanitizeString(String(tag), 50)).filter((tag: string) => tag.length > 0);
    }
    if (linkedClientId !== undefined) {
      if (linkedClientId === null || linkedClientId === '') {
        asset.linkedClientId = undefined;
      } else {
        asset.linkedClientId = linkedClientId;
      }
    }
    if (linkedProjectId !== undefined) {
      if (linkedProjectId === null || linkedProjectId === '') {
        asset.linkedProjectId = undefined;
      } else {
        asset.linkedProjectId = linkedProjectId;
      }
    }
    // Prefer stable taskId over taskIndex
    if (linkedProjectTaskId !== undefined && linkedProjectTaskId !== null && linkedProjectTaskId !== '') {
      asset.linkedProjectTaskId = linkedProjectTaskId;
      asset.linkedProjectTaskIndex = undefined;
    } else if (linkedProjectTaskIndex !== undefined && linkedProjectTaskIndex !== null && linkedProjectTaskIndex !== '') {
      asset.linkedProjectTaskIndex = typeof linkedProjectTaskIndex === 'number' ? linkedProjectTaskIndex : parseInt(linkedProjectTaskIndex);
      asset.linkedProjectTaskId = undefined;
    } else if (linkedProjectTaskId !== undefined || linkedProjectTaskIndex !== undefined) {
      // Explicitly clearing
      asset.linkedProjectTaskId = undefined;
      asset.linkedProjectTaskIndex = undefined;
    }
    if (linkedContentItemId !== undefined) {
      asset.linkedContentItemId = linkedContentItemId === null || linkedContentItemId === '' ? undefined : linkedContentItemId;
    }
    if (clientAccessible !== undefined) asset.clientAccessible = !!clientAccessible;

    const linkError = validateAssetLinkExclusivity({
      linkedClientId: asset.linkedClientId,
      linkedProjectId: asset.linkedProjectId,
      linkedProjectTaskId: asset.linkedProjectTaskId,
      linkedProjectTaskIndex: asset.linkedProjectTaskIndex,
      linkedContentItemId: asset.linkedContentItemId,
    });
    if (linkError) {
      return NextResponse.json({ error: linkError }, { status: 400 });
    }

    if (!ctx.isManagerOrAdmin) {
      const scope = await buildAssetAccessScope(ctx);
      const linkDenied = await assertCanLinkAsset(
        ctx,
        {
          linkedProjectId: asset.linkedProjectId,
          linkedClientId: asset.linkedClientId,
          linkedProjectTaskId: asset.linkedProjectTaskId,
          linkedProjectTaskIndex: asset.linkedProjectTaskIndex,
          linkedContentItemId: asset.linkedContentItemId,
        },
        scope
      );
      if (linkDenied) return linkDenied;
    }

    await asset.save();

    return NextResponse.json(asset);
  } catch {
    // Update asset error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    await connectDB();
    const { id } = await params;

    // Validate ObjectId format
    if (!isValidObjectId(id)) {
      return NextResponse.json({ error: 'Invalid asset ID' }, { status: 400 });
    }

    // Get user's organizationId
    const user = await User.findById(session.userId);
    if (!user || !user.organizationId) {
      return NextResponse.json({ error: 'User or organization not found' }, { status: 404 });
    }

    // Find all users in the same organization
    const orgUsers = await User.find({ organizationId: user.organizationId });
    const orgUserIds = orgUsers.map(u => u._id);

    const asset = await Asset.findOne({ _id: id, userId: { $in: orgUserIds } });
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const Employee = (await import('@/lib/models/Employee')).default;
    const currentUserEmployee = await Employee.findOne({ userId: session.userId, organizationId: user.organizationId });
    const isManagerOrAdmin = currentUserEmployee && isManagerOrAdminRole(currentUserEmployee.role);
    const isOwner = asset.userId.toString() === session.userId;

    if (!isManagerOrAdmin && !isOwner) {
      return NextResponse.json({ error: 'You do not have permission to delete this asset' }, { status: 403 });
    }

    const fileUrl = asset.fileUrl?.trim();
    if (fileUrl?.startsWith('https://')) {
      await deleteStoredFile(fileUrl);
    }

    await Asset.findOneAndDelete({ _id: id, userId: { $in: orgUserIds } });

    return NextResponse.json({ message: 'Asset deleted successfully' });
  } catch {
    // Delete asset error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
