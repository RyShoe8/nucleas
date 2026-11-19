import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import InsightItem from '@/lib/models/InsightItem';
import { requireAdminInsights } from '@/lib/insights/requireAdminInsights';

export async function POST(request: NextRequest) {
  const auth = await requireAdminInsights();
  if (auth.error) return auth.error;

  await connectDB();
  const body = await request.json();
  const { categoryId, title, description, detectsFromCategorySlug, itemOrder } = body;

  if (!categoryId || !title?.trim()) {
    return NextResponse.json({ error: 'categoryId and title are required' }, { status: 400 });
  }

  const maxOrder = await InsightItem.findOne({ categoryId })
    .sort({ itemOrder: -1 })
    .select('itemOrder')
    .lean();

  const item = await InsightItem.create({
    categoryId,
    title: title.trim(),
    description: description?.trim() ?? '',
    detectsFromCategorySlug: detectsFromCategorySlug || undefined,
    itemOrder: itemOrder ?? (maxOrder?.itemOrder ?? 0) + 1,
    isActive: true,
  });

  return NextResponse.json({
    id: item._id.toString(),
    categoryId: item.categoryId.toString(),
    title: item.title,
    description: item.description,
    itemOrder: item.itemOrder,
    detectsFromCategorySlug: item.detectsFromCategorySlug,
    isActive: item.isActive,
    vendors: [],
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminInsights();
  if (auth.error) return auth.error;

  await connectDB();
  const body = await request.json();
  const order: { id: string; itemOrder: number; categoryId?: string }[] = body.order ?? [];

  if (!Array.isArray(order)) {
    return NextResponse.json({ error: 'order array required' }, { status: 400 });
  }

  await Promise.all(
    order.map(({ id, itemOrder, categoryId }) => {
      const update: Record<string, unknown> = { itemOrder };
      if (categoryId) update.categoryId = categoryId;
      return InsightItem.updateOne({ _id: id }, { $set: update });
    })
  );

  return NextResponse.json({ ok: true });
}
