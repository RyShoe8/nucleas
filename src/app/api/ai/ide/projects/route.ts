import { NextRequest } from 'next/server';
import { requireAttentionAccess } from '@/lib/ai/control/attention';
import { aiError, aiResponse } from '@/lib/ai/control/http';
import Project from '@/lib/models/Project';
import { canUserContributeToProject } from '@/lib/utils/projectTeam';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const access = await requireAttentionAccess(request);
    const rows = await Project.find({ userId: { $in: access.ownerIds } })
      .select('name assignedToEmployeeIds assignedToEmployeeId tasks.assignedToEmployeeIds tasks.assignedToEmployeeId')
      .sort({ _id: -1 }).limit(100).maxTimeMS(3000).lean();
    return aiResponse({ projects: rows.filter(project => canUserContributeToProject(project, access.employeeId, access.canManage))
      .map(project => ({ id: String(project._id), name: project.name })), limited: rows.length === 100 });
  } catch (error) { return aiError(error); }
}
