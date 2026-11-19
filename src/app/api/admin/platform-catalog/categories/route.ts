import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import PlatformCategory from '@/lib/models/PlatformCategory';
import { requireAdminUser } from '@/lib/blog/requireAdmin';
import { invalidatePlatformCatalogCache } from '@/lib/platformCatalog/loadPlatformCatalog';
import { slugifyCatalogName } from '@/lib/platformCatalog/slugify';
import PlatformStack from '@/lib/models/PlatformStack';

export async function POST(request: NextRequest) {
  const auth = await requireAdminUser();
  if (auth.error) return auth.error;

  await connectDB();
  const body = await request.json();
  const stackType = typeof body.stackType === 'string' ? body.stackType.trim().toLowerCase() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const slugInput = typeof body.slug === 'string' ? body.slug.trim() : '';
  const slug = slugInput ? slugifyCatalogName(slugInput) : slugifyCatalogName(label);

  const stack = await PlatformStack.findOne({ slug: stackType, isActive: true });
  if (!stack) {
    return NextResponse.json({ error: 'stackType must match an active platform stack' }, { status: 400 });
  }
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!slug) return NextResponse.json({ error: 'Could not derive slug from label' }, { status: 400 });

  const existing = await PlatformCategory.findOne({ stackType, slug });
  if (existing) {
    return NextResponse.json({ error: 'Category slug already exists for this stack type' }, { status: 400 });
  }

  const maxOrder = await PlatformCategory.findOne({ stackType }).sort({ displayOrder: -1 }).lean();
  const category = await PlatformCategory.create({
    stackType,
    slug,
    label,
    displayOrder: (maxOrder?.displayOrder ?? -1) + 1,
    isActive: true,
  });

  invalidatePlatformCatalogCache();
  return NextResponse.json({
    id: category._id.toString(),
    stackType: category.stackType,
    slug: category.slug,
    label: category.label,
    displayOrder: category.displayOrder,
    isActive: category.isActive,
    options: [],
  });
}
