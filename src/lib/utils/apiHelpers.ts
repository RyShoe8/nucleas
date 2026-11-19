import User from '@/lib/models/User';
import { Types } from 'mongoose';

/**
 * Get organization user IDs for a given user
 * Used across many API routes to filter by organization
 * Note: organizationId is stored as a string in the User model
 */
export async function getOrganizationUserIds(userId: string | Types.ObjectId, organizationId: string | Types.ObjectId): Promise<Types.ObjectId[]> {
  // organizationId is stored as string in User model, so convert ObjectId to string if needed
  const orgId = typeof organizationId === 'string' ? organizationId : organizationId.toString();
  // Runs on nearly every authenticated request — only fetch _id, skip hydration
  const orgUsers = await User.find({ organizationId: orgId }).select('_id').lean();

  // Ensure we return proper ObjectIds - convert string IDs to ObjectId if needed
  const userIds = orgUsers.map(u => {
    if (typeof u._id === 'string') {
      return new Types.ObjectId(u._id);
    }
    return u._id as Types.ObjectId;
  });

  // Ensure the current user is included (in case of any edge cases)
  const currentUserId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
  const currentUserIdString = currentUserId.toString();
  if (!userIds.some(id => id.toString() === currentUserIdString)) {
    userIds.push(currentUserId);
  }

  // Return unique IDs only
  const uniqueIds = Array.from(new Set(userIds.map(id => id.toString()))).map(id => new Types.ObjectId(id));

  return uniqueIds;
}

/**
 * Map stage status to task status for migration
 */
export function mapStageStatusToTaskStatus(stageStatus: string): 'planning' | 'active' | 'in-review' | 'complete' {
  switch (stageStatus) {
    case 'in-development':
      return 'active';
    case 'launched':
      return 'complete';
    case 'in-review':
      return 'in-review';
    case 'planning':
    default:
      return 'planning';
  }
}

interface MigratableProjectStage {
  name?: string;
  description?: string;
  startDate?: unknown;
  endDate?: unknown;
  estimatedHours?: unknown;
  assignedTo?: unknown;
  status?: string;
}

interface MigratableProjectLike {
  tasks?: unknown[];
  stages?: MigratableProjectStage[];
  projectType?: string;
  category?: string;
}

/**
 * Migrate stages to tasks for backward compatibility
 * Returns the project with migrated tasks if migration occurred
 */
export function migrateStagesToTasks<T extends MigratableProjectLike>(project: T): T {
  if ((!project.tasks || project.tasks.length === 0) && project.stages && project.stages.length > 0) {
    project.tasks = project.stages.map((stage) => ({
      name: stage.name,
      description: stage.description,
      startDate: stage.startDate,
      endDate: stage.endDate,
      estimatedHours: stage.estimatedHours,
      assignedTo: stage.assignedTo,
      status: mapStageStatusToTaskStatus(stage.status as string),
    }));
  }
  return project;
}

/**
 * Safely migrate projectType and category if they are swapped (old format)
 */
export function migrateProjectFields<T extends MigratableProjectLike>(project: T): T {
  const websiteTypes = ['website', 'store', 'app', 'generic'];
  const internalClientTypes = ['internal', 'client'];

  // If projectType is one of the website types, it's the old format where they were swapped
  if (project.projectType && websiteTypes.includes(project.projectType)) {
    const currentType = project.projectType;
    const currentCategory = project.category;

    // projectType should be 'internal' or 'client'
    project.projectType = internalClientTypes.includes(currentCategory ?? '') ? currentCategory : 'client';
    // category should be one of the website types
    project.category = currentType;
  }

  // Also ensure category is set if missing (for very old projects)
  if (!project.category && websiteTypes.includes(project.projectType ?? '')) {
    // In this case projectType is correct but category is missing
    // Actually if projType is website, it IS swapped.
  }

  return project;
}

