import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { validateImageFile, isValidObjectId } from '@/lib/utils/security';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate session userId is a valid ObjectId
    if (!isValidObjectId(session.userId)) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type by MIME type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 5MB' }, { status: 400 });
    }

    // Validate file content by checking magic bytes
    const isValidImage = await validateImageFile(file);
    if (!isValidImage) {
      return NextResponse.json({ error: 'Invalid image file' }, { status: 400 });
    }

    await connectDB();

    const user = await User.findById(session.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'profiles');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // Generate unique filename with proper extension handling
    // Use only timestamp and extension - don't use original filename to prevent path traversal
    const timestamp = Date.now();
    const extension = file.type.split('/')[1]?.toLowerCase() || 'jpg';
    // Ensure valid image extension
    const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const finalExtension = validExtensions.includes(extension) ? extension : 'jpg';
    // Use only userId (already validated) and timestamp - no user input in filename
    const filename = `${session.userId}-${timestamp}.${finalExtension}`;
    const filepath = join(uploadsDir, filename);

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filepath, buffer);

    // Verify file was written
    const { existsSync: checkExists } = await import('fs');
    if (!checkExists(filepath)) {
      throw new Error('Failed to save file');
    }

    // Update user profile picture
    const url = `/uploads/profiles/${filename}`;
    user.profilePicture = url;
    await user.save();

    return NextResponse.json({
      message: 'Profile picture uploaded successfully',
      url,
    });
  } catch {
    // Profile picture upload error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
