import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { migrateAssignmentsToEmployeeId } from '@/lib/utils/migrateAssignmentsToEmployeeId';

/**
 * POST /api/admin/migrate-assignments
 * Migrate existing name-based assignments to employeeId-based assignments
 * Only accessible by administrators
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    // Check if user is an administrator
    const User = (await import('@/lib/models/User')).default;
    const Employee = (await import('@/lib/models/Employee')).default;
    const user = await User.findById(session.userId);
    if (!user || !user.organizationId) {
      return NextResponse.json({ error: 'User or organization not found' }, { status: 404 });
    }

    const currentUserEmployee = await Employee.findOne({ userId: session.userId, organizationId: user.organizationId });
    if (!currentUserEmployee || currentUserEmployee.role !== 'Administrator') {
      return NextResponse.json({ error: 'Only Administrators can run migrations' }, { status: 403 });
    }

    const result = await migrateAssignmentsToEmployeeId();

    return NextResponse.json({
      message: 'Migration completed successfully',
      ...result
    });
  } catch {
    // Migration error
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 });
  }
}
