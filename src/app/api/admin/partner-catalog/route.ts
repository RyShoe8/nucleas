import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import PartnerCatalog from '@/lib/models/PartnerCatalog';

/**
 * GET /api/admin/partner-catalog
 * Returns the partner catalog for the current user's organization (catalog userId = org admin userId).
 * System admins could be extended to list all catalogs.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const user = await User.findById(session.userId);
    if (!user || !user.organizationId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Catalog is owned by org (use organizationId as owner userId for "one catalog per org")
    const catalog = await PartnerCatalog.findOne({ userId: user.organizationId }).lean();
    return NextResponse.json(catalog || { partnerLinks: [], productTypes: [], name: 'Default' });
  } catch (error) {
    console.error('Error fetching partner catalog:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/partner-catalog
 * Create or update partner catalog for the current user's organization. Manager/Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    const user = await User.findById(session.userId);
    if (!user || !user.organizationId) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const Employee = (await import('@/lib/models/Employee')).default;
    const employee = await Employee.findOne({ userId: session.userId, organizationId: user.organizationId });
    if (!employee || (employee.role !== 'Manager' && employee.role !== 'Administrator')) {
      return NextResponse.json({ error: 'Forbidden - Manager or Administrator required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, partnerLinks, productTypes } = body;

    let catalog = await PartnerCatalog.findOne({ userId: user.organizationId });
    if (!catalog) {
      catalog = await PartnerCatalog.create({
        name: name || 'Default',
        partnerLinks: partnerLinks || [],
        productTypes: productTypes || [],
        userId: user.organizationId,
      });
      return NextResponse.json(catalog, { status: 201 });
    }

    if (name !== undefined) catalog.name = name;
    if (Array.isArray(partnerLinks)) catalog.partnerLinks = partnerLinks;
    if (Array.isArray(productTypes)) catalog.productTypes = productTypes;
    await catalog.save();

    return NextResponse.json(catalog);
  } catch (error) {
    console.error('Error updating partner catalog:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
