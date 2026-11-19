import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import Project from '@/lib/models/Project';
import { requireAuth } from '@/lib/auth/middleware';
import { getOrganizationUserIds, migrateStagesToTasks, migrateProjectFields } from '@/lib/utils/apiHelpers';
import { buildProjectsListQuery } from '@/lib/utils/projectsListQuery';
import { getDefaultTaskDates, resolveTaskDateInput } from '@/lib/utils/dateUtils';
import { validateTaskAssigneesOnProjectTeam, mergeProjectTeamWithClient, type ProjectTeamSource } from '@/lib/utils/projectTeam';
import { isManagerOrAdminRole } from '@/lib/utils/roles';
import { Types } from 'mongoose';

interface ProjectCreateTaskData extends Record<string, unknown> {
  name?: string;
  assignedToEmployeeIds?: Types.ObjectId[];
  assignedToEmployeeId?: Types.ObjectId;
  assignedTo?: string;
}

interface ProjectCreateData extends Record<string, unknown> {
  name: string;
  description?: string;
  urls: string[];
  projectType: string;
  category: string;
  color: string;
  logo?: string;
  status: string;
  clientId?: string;
  userId: string;
  endDate?: Date;
  estimatedHours?: number;
  devUrl?: string;
  liveUrl?: string;
  assignedToEmployeeIds?: Types.ObjectId[];
  assignedToNames?: string[];
  assignedToEmployeeId?: Types.ObjectId;
  assignedTo?: string;
  tasks?: ProjectCreateTaskData[];
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    await connectDB();

    // Get user's organizationId
    const User = (await import('@/lib/models/User')).default;
    const Employee = (await import('@/lib/models/Employee')).default;
    const user = await User.findById(session.userId);
    if (!user || !user.organizationId) {
      return NextResponse.json({ error: 'User or organization not found' }, { status: 404 });
    }

    // Get current user's employee record and role
    const currentUserEmployee = await Employee.findOne({ userId: session.userId, organizationId: user.organizationId });
    const userRole = currentUserEmployee?.role || 'User';

    // Find all users in the same organization
    const orgUserIds = await getOrganizationUserIds(session.userId, user.organizationId);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let clientIdsForHubAccess: Types.ObjectId[] | undefined;
    if (userRole === 'User' && currentUserEmployee) {
      const Client = (await import('@/lib/models/Client')).default;
      const assignedClients = await Client.find({
        organizationId: user.organizationId,
        $or: [
          { assignedToEmployeeIds: currentUserEmployee._id },
          { assignedToEmployeeId: currentUserEmployee._id },
        ],
      })
        .select('_id')
        .lean();
      clientIdsForHubAccess = assignedClients.map((c) => c._id as Types.ObjectId);
    }

    const query = buildProjectsListQuery({
      orgUserIds,
      status,
      userRole,
      currentUserEmployee: currentUserEmployee
        ? { _id: currentUserEmployee._id as Types.ObjectId, name: currentUserEmployee.name }
        : null,
      clientIdsForHubAccess,
    });

    const projects = await Project.find(query).sort({ createdAt: -1 }).lean();
    const migratedProjects = projects.map((project) =>
      migrateProjectFields(migrateStagesToTasks(project))
    );

    return NextResponse.json(migratedProjects);
  } catch {
    // Get projects error
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    await connectDB();

    // Check if user is a Manager or Administrator
    const User = (await import('@/lib/models/User')).default;
    const Employee = (await import('@/lib/models/Employee')).default;
    const user = await User.findById(session.userId);
    if (!user || !user.organizationId) {
      return NextResponse.json({ error: 'User or organization not found' }, { status: 404 });
    }

    const currentUserEmployee = await Employee.findOne({ userId: session.userId, organizationId: user.organizationId });
    const isManagerOrAdmin = currentUserEmployee && isManagerOrAdminRole(currentUserEmployee.role);

    if (!isManagerOrAdmin) {
      return NextResponse.json({ error: 'Only Managers and Administrators can create projects' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, url: _url, urls, devUrl, liveUrl, projectType, category, color, logo, status, clientId, estimatedHours, assignedTo, assignedToEmployeeId, assignedToEmployeeIds, assignedToNames, tasks, endDate, socialLinks: _socialLinks, techStack: _techStack, marketingStack: _marketingStack } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    const projectData: ProjectCreateData = {
      name,
      description,
      urls: urls || [],
      projectType: projectType || 'client',
      category: category || 'generic',
      color: color || '#3b82f6',
      logo: logo || undefined,
      status: status || 'planning',
      clientId: clientId || undefined,
      userId: session.userId,
    };

    if (endDate !== undefined && endDate !== null && endDate !== '') {
      projectData.endDate = new Date(endDate);
    }

    if (estimatedHours !== undefined) {
      projectData.estimatedHours = estimatedHours;
    }

    if (devUrl !== undefined && String(devUrl).trim()) {
      projectData.devUrl = String(devUrl).trim();
    }
    if (liveUrl !== undefined && String(liveUrl).trim()) {
      projectData.liveUrl = String(liveUrl).trim();
    }

    // Handle multiple employee assignments (preferred)
    if (assignedToEmployeeIds && Array.isArray(assignedToEmployeeIds) && assignedToEmployeeIds.length > 0) {
      projectData.assignedToEmployeeIds = assignedToEmployeeIds.map((id: string) => new Types.ObjectId(id));
      if (assignedToNames && Array.isArray(assignedToNames) && assignedToNames.length > 0) {
        projectData.assignedToNames = assignedToNames;
      } else {
        // Fetch names from employee records
        const assignedEmployees = await Employee.find({ _id: { $in: projectData.assignedToEmployeeIds } });
        projectData.assignedToNames = assignedEmployees.map(emp => emp.name);
      }
      // Keep legacy fields for backward compatibility (use first assignment)
      projectData.assignedToEmployeeId = projectData.assignedToEmployeeIds[0];
      projectData.assignedTo = projectData.assignedToNames[0];
    } else if (assignedToEmployeeId) {
      // Legacy single assignment support
      projectData.assignedToEmployeeId = new Types.ObjectId(assignedToEmployeeId);
      const assignedEmployee = await Employee.findById(assignedToEmployeeId);
      if (assignedEmployee) {
        projectData.assignedTo = assignedEmployee.name;
      }
    } else if (assignedTo) {
      // Legacy support: if name provided, try to find employee and set ID
      const assignedEmployee = await Employee.findOne({
        name: assignedTo,
        organizationId: user.organizationId
      });
      if (assignedEmployee) {
        projectData.assignedToEmployeeId = assignedEmployee._id;
      }
      projectData.assignedTo = assignedTo;
    }

    if (tasks && Array.isArray(tasks)) {
      let taskAssigneeTeam: ProjectTeamSource = projectData;
      if (clientId) {
        const Client = (await import('@/lib/models/Client')).default;
        const client = await Client.findById(clientId);
        taskAssigneeTeam = mergeProjectTeamWithClient(projectData, client);
      }

      const assigneeError = validateTaskAssigneesOnProjectTeam(taskAssigneeTeam, tasks);
      if (assigneeError) {
        return NextResponse.json({ error: assigneeError }, { status: 400 });
      }

      projectData.tasks = await Promise.all(tasks.map(async (task: Record<string, unknown> & { startDate?: unknown; endDate?: unknown; assignedToEmployeeIds?: unknown; assignedToEmployeeId?: unknown; assignedTo?: unknown }) => {
        const defaultDates = getDefaultTaskDates();
        const startDate = resolveTaskDateInput(task.startDate, { fallback: defaultDates.startDate });
        const endDate = resolveTaskDateInput(task.endDate, { fallback: defaultDates.endDate });

        const taskData = {
          ...task,
          startDate,
          endDate,
        } as unknown as ProjectCreateTaskData;

        // Handle employee assignment for tasks - prefer employeeIds array, then single id, then legacy name
        if (task.assignedToEmployeeIds !== undefined) {
          if (!Array.isArray(task.assignedToEmployeeIds) || task.assignedToEmployeeIds.length === 0) {
            taskData.assignedToEmployeeIds = [];
            taskData.assignedToEmployeeId = undefined;
            taskData.assignedTo = undefined;
          } else {
            taskData.assignedToEmployeeIds = task.assignedToEmployeeIds.map((id) => new Types.ObjectId(id as string));
            const assignedEmployees = await Employee.find({ _id: { $in: taskData.assignedToEmployeeIds } });
            taskData.assignedTo = assignedEmployees.map((e) => e.name).join(', ');
            taskData.assignedToEmployeeId = taskData.assignedToEmployeeIds[0];
          }
        } else if (task.assignedToEmployeeId) {
          taskData.assignedToEmployeeId = new Types.ObjectId(task.assignedToEmployeeId as string);
          taskData.assignedToEmployeeIds = [taskData.assignedToEmployeeId];
          const assignedEmployee = await Employee.findById(task.assignedToEmployeeId as string);
          if (assignedEmployee) {
            taskData.assignedTo = assignedEmployee.name;
          }
        } else if (task.assignedTo) {
          // Legacy support: if name provided, try to find employee and set ID
          const assignedEmployee = await Employee.findOne({
            name: task.assignedTo as string,
            organizationId: user.organizationId
          });
          if (assignedEmployee) {
            taskData.assignedToEmployeeId = assignedEmployee._id;
            taskData.assignedToEmployeeIds = [assignedEmployee._id];
          }
          taskData.assignedTo = task.assignedTo as string;
        }

        return taskData;
      }));
      let postTaskAssigneeTeam: ProjectTeamSource = projectData;
      if (clientId) {
        const Client = (await import('@/lib/models/Client')).default;
        const client = await Client.findById(clientId);
        postTaskAssigneeTeam = mergeProjectTeamWithClient(projectData, client);
      }
      const postAssigneeError = validateTaskAssigneesOnProjectTeam(postTaskAssigneeTeam, projectData.tasks ?? []);
      if (postAssigneeError) {
        return NextResponse.json({ error: postAssigneeError }, { status: 400 });
      }
    }

    // socialLinks, techStack, marketingStack are sanitized in projectData above when present

    const project = await Project.create(projectData);

    void import('@/lib/workspace/workspaceNotifications').then(({ notifyProjectChange, notifyTaskChange }) => {
      const organizationId = user.organizationId!;
      const actorUserId = session.userId;
      const actorEmployeeId = currentUserEmployee?._id?.toString() ?? null;

      void notifyProjectChange({
        project,
        actorUserId,
        actorEmployeeId,
        organizationId,
        isNew: true,
        changeLabel: 'New project assigned',
      }).catch((err) => console.error('[workspaceNotifications] project_new', err));

      for (const [index, task] of (project.tasks ?? []).entries()) {
        void notifyTaskChange({
          project,
          task,
          taskIndex: index,
          actorUserId,
          actorEmployeeId,
          organizationId,
          isNew: true,
          changeLabel: 'New task assigned',
        }).catch((err) => console.error('[workspaceNotifications] task_new', err));
      }
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Error creating project:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
