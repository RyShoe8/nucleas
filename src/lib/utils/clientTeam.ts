import { Types } from 'mongoose';

export type ClientTeamSource = {
  assignedToEmployeeIds?: unknown[];
  assignedToEmployeeId?: unknown;
};

export type ClientListRole = 'Administrator' | 'Manager' | 'User';

export interface ClientListEmployee {
  _id: Types.ObjectId;
}

function normalizeEmployeeId(id: unknown): string | null {
  if (id == null || id === '') return null;
  if (typeof id === 'string') return id;
  if (typeof id === 'object' && id !== null && 'toString' in id) {
    return (id as { toString(): string }).toString();
  }
  return String(id);
}

/** Employee IDs assigned to this client (array + legacy single field). */
export function getClientTeamEmployeeIds(client: ClientTeamSource): Set<string> {
  const ids = new Set<string>();
  const fromArray = client.assignedToEmployeeIds ?? [];
  for (const id of fromArray) {
    const normalized = normalizeEmployeeId(id);
    if (normalized) ids.add(normalized);
  }
  if (ids.size === 0) {
    const legacy = normalizeEmployeeId(client.assignedToEmployeeId);
    if (legacy) ids.add(legacy);
  }
  return ids;
}

export function isEmployeeAssignedToClient(
  client: ClientTeamSource,
  employeeId: string | unknown
): boolean {
  const normalized = normalizeEmployeeId(employeeId);
  if (!normalized) return false;
  return getClientTeamEmployeeIds(client).has(normalized);
}

/** Build MongoDB query for GET /api/clients with mandatory org boundary. */
export function buildClientsListQuery(options: {
  organizationId: Types.ObjectId | string;
  userRole: ClientListRole | string;
  currentUserEmployee?: ClientListEmployee | null;
}): Record<string, unknown> {
  const orgId =
    typeof options.organizationId === 'string'
      ? options.organizationId
      : options.organizationId.toString();

  if (options.userRole === 'Administrator' || options.userRole === 'Manager') {
    return { organizationId: orgId };
  }

  if (!options.currentUserEmployee) {
    return { _id: { $exists: false } };
  }

  const employeeId = options.currentUserEmployee._id;
  return {
    $and: [
      { organizationId: orgId },
      {
        $or: [{ assignedToEmployeeIds: employeeId }, { assignedToEmployeeId: employeeId }],
      },
    ],
  };
}

export function canUserAccessClient(
  client: ClientTeamSource,
  options: {
    userRole: ClientListRole | string;
    employeeId?: string | null;
  }
): boolean {
  if (options.userRole === 'Administrator' || options.userRole === 'Manager') {
    return true;
  }
  if (!options.employeeId) return false;
  return isEmployeeAssignedToClient(client, options.employeeId);
}

/** Validate and normalize assigned employee ids for a client update. */
export async function validateClientAssignedEmployeeIds(
  organizationId: string,
  raw: unknown
): Promise<{ ok: true; ids: Types.ObjectId[] } | { ok: false; status: number; error: string }> {
  if (raw === undefined) {
    return { ok: true, ids: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'assignedToEmployeeIds must be an array' };
  }

  const unique = [
    ...new Set(
      raw
        .map((id) => (id == null ? '' : String(id).trim()))
        .filter(Boolean)
    ),
  ];

  for (const id of unique) {
    if (!Types.ObjectId.isValid(id)) {
      return { ok: false, status: 400, error: `Invalid employee id: ${id}` };
    }
  }

  if (unique.length === 0) {
    return { ok: true, ids: [] };
  }

  const Employee = (await import('@/lib/models/Employee')).default;
  const objectIds = unique.map((id) => new Types.ObjectId(id));
  const employees = await Employee.find({
    _id: { $in: objectIds },
    organizationId,
  }).select('_id');

  if (employees.length !== unique.length) {
    return { ok: false, status: 400, error: 'One or more employees are not in this organization' };
  }

  return { ok: true, ids: objectIds };
}
