'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

interface AdminPlan {
  _id: string;
  name: string;
  slug: string;
  archived?: boolean;
}

interface User {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  organizationDomain: string | null;
  organizationMongoId: string | null;
  plan: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  createdAt: string;
  isAdmin: boolean;
  registrationApproval: 'pending' | 'approved' | 'rejected';
}

interface OrgGroup {
  organizationId: string;
  displayName: string;
  domain: string | null;
  organizationMongoId: string | null;
  plan: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  members: User[];
}

function buildOrgGroups(users: User[]): OrgGroup[] {
  const map = new Map<string, User[]>();
  for (const u of users) {
    const key = u.organizationId || 'unknown';
    const list = map.get(key) ?? [];
    list.push(u);
    map.set(key, list);
  }

  const groups: OrgGroup[] = [];
  for (const [organizationId, members] of map) {
    const sortedMembers = [...members].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const primary = sortedMembers[0];
    const displayName =
      sortedMembers.find((m) => m.organizationName && m.organizationName !== 'N/A')?.organizationName ??
      primary.organizationName ??
      'Unknown organization';
    const domain =
      sortedMembers.find((m) => m.organizationDomain)?.organizationDomain ?? null;
    const meta = sortedMembers.find((m) => m.organizationMongoId) ?? primary;
    groups.push({
      organizationId,
      displayName,
      domain,
      organizationMongoId: meta.organizationMongoId ?? null,
      plan: meta.plan ?? null,
      planName: meta.planName ?? null,
      subscriptionStatus: meta.subscriptionStatus ?? null,
      subscriptionPlanId: meta.subscriptionPlanId ?? null,
      members: sortedMembers,
    });
  }

  groups.sort((a, b) => {
    const nameCmp = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    if (nameCmp !== 0) return nameCmp;
    return a.organizationId.localeCompare(b.organizationId);
  });

  return groups;
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  /** Org IDs in this set have their member list collapsed (empty set = all expanded). */
  const [collapsedOrgIds, setCollapsedOrgIds] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [planSelections, setPlanSelections] = useState<Record<string, string>>({});
  const [applyingOrgId, setApplyingOrgId] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const response = await fetch('/api/admin/plans');
        if (!response.ok) return;
        const data = await response.json();
        const active = (data.plans || []).filter((p: AdminPlan) => !p.archived);
        setPlans(active);
      } catch {
        // Plans list optional for page load
      }
    };
    fetchPlans();
  }, []);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch('/api/admin/users');
        if (response.status === 403) {
          setError('Access denied. Admin privileges required.');
          return;
        }
        if (!response.ok) {
          throw new Error('Failed to fetch users');
        }
        const data = await response.json();
        const list: User[] = (data.users || []).map((u: User) => ({
          ...u,
          organizationId: u.organizationId ?? 'unknown',
        }));
        setUsers(list);
        setTotalUsers(data.totalUsers);
        const initialSelections: Record<string, string> = {};
        for (const u of list) {
          if (u.subscriptionPlanId && u.organizationId && !initialSelections[u.organizationId]) {
            initialSelections[u.organizationId] = u.subscriptionPlanId;
          }
        }
        setPlanSelections(initialSelections);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load users');
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const orgGroups = useMemo(() => buildOrgGroups(users), [users]);
  const pendingRegistrations = useMemo(
    () => users.filter((user) => user.registrationApproval === 'pending'),
    [users]
  );

  const toggleOrgCollapsed = useCallback((organizationId: string) => {
    setCollapsedOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(organizationId)) next.delete(organizationId);
      else next.add(organizationId);
      return next;
    });
  }, []);

  const handleToggleAdmin = async (userId: string, currentStatus: boolean, userEmail: string) => {
    const action = currentStatus ? 'remove admin privileges from' : 'promote to admin';
    if (!confirm(`Are you sure you want to ${action} ${userEmail}?`)) {
      return;
    }

    setUpdatingId(userId);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAdmin: !currentStatus }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update user');
      }

      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isAdmin: !currentStatus } : u))
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRegistrationApproval = async (
    userId: string,
    registrationApproval: 'approved' | 'rejected'
  ) => {
    setUpdatingId(userId);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationApproval }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to review registration');
      setUsers((prev) => prev.map((user) =>
        user.id === userId ? { ...user, registrationApproval } : user
      ));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to review registration');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleApplyPlan = async (group: OrgGroup) => {
    if (!group.organizationMongoId) {
      alert('No organization record found for this group. The owner may not have completed setup.');
      return;
    }
    const planId = planSelections[group.organizationId];
    if (!planId) {
      alert('Select a subscription plan first.');
      return;
    }

    setApplyingOrgId(group.organizationId);
    try {
      const response = await fetch(
        `/api/admin/organizations/${group.organizationMongoId}/subscription`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId, status: 'active' }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to assign plan');
      }

      const selectedPlan = plans.find((p) => p._id === planId);
      setUsers((prev) =>
        prev.map((u) =>
          u.organizationId === group.organizationId
            ? {
                ...u,
                plan: data.plan ?? u.plan,
                subscriptionStatus: data.subscriptionStatus ?? u.subscriptionStatus,
                subscriptionPlanId: planId,
                planName: selectedPlan?.name ?? u.planName,
              }
            : u
        )
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to assign plan');
    } finally {
      setApplyingOrgId(null);
    }
  };

  const handleDelete = async (user: User, orgMemberCount: number) => {
    const soleOrgMember = orgMemberCount === 1;
    const firstMessage = soleOrgMember
      ? `Delete ${user.email}? This is the only member of their organization — all projects, meetings, billing, and org data will be permanently removed.`
      : `Are you sure you want to delete user ${user.email}? This action cannot be undone.`;

    if (!confirm(firstMessage)) {
      return;
    }

    if (soleOrgMember) {
      const typed = prompt('Type DELETE to confirm permanent organization removal:');
      if (typed !== 'DELETE') {
        return;
      }
    }

    setDeletingId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete user');
      }

      const data = await response.json();
      setUsers((prev) =>
        soleOrgMember
          ? prev.filter((u) => u.organizationId !== user.organizationId)
          : prev.filter((u) => u.id !== user.id)
      );
      setTotalUsers((n) => (soleOrgMember ? n - orgMemberCount : n - 1));
      if (data.organizationRemoved) {
        // no-op; state already updated
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-[100px] py-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-text-secondary">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-[100px] py-8">
        <div className="max-w-7xl mx-auto">
          <Card className="p-6">
            <div className="bg-error-light border border-error/30 text-error px-4 py-3 rounded-lg">
              {error}
            </div>
            <Button onClick={() => router.push('/')} className="mt-4">
              Go Back
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-[100px] py-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-text-primary mb-2">Users</h1>
          <p className="text-text-secondary">Manage users and roles</p>
        </div>

        <Card className="p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <h2 className="text-xl font-semibold text-text-primary mb-1">Registered Users</h2>
              <p className="text-3xl font-bold text-primary">{totalUsers}</p>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-primary mb-1">Awaiting approval</h2>
              <p className="text-3xl font-bold text-warning-dark">{pendingRegistrations.length}</p>
            </div>
          </div>
        </Card>

        {pendingRegistrations.length > 0 && (
          <Card className="p-6 mb-6 border-warning/40">
            <h2 className="text-xl font-semibold text-text-primary mb-1">Registration requests</h2>
            <p className="text-sm text-text-secondary mb-4">Approve access or reject the request. Invited teammates bypass this queue.</p>
            <div className="space-y-3">
              {pendingRegistrations.map((user) => (
                <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0">
                  <div>
                    <div className="font-medium text-text-primary">{user.name}</div>
                    <div className="text-sm text-text-secondary">{user.email} · Registered {new Date(user.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void handleRegistrationApproval(user.id, 'approved')}
                      disabled={updatingId === user.id} className="rounded bg-success/10 px-3 py-2 text-sm text-success disabled:opacity-50">
                      Approve
                    </button>
                    <button type="button" onClick={() => void handleRegistrationApproval(user.id, 'rejected')}
                      disabled={updatingId === user.id} className="rounded bg-error-light px-3 py-2 text-sm text-error disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4">Users by organization</h2>

          {users.length === 0 ? (
            <div className="text-center py-8 text-text-secondary">No users found</div>
          ) : (
            <div className="space-y-4">
              {orgGroups.map((group) => {
                const isCollapsed = collapsedOrgIds.has(group.organizationId);
                const memberCount = group.members.length;

                return (
                  <div
                    key={group.organizationId}
                    className="border border-border rounded-lg overflow-hidden bg-background-card/30"
                  >
                    <button
                      type="button"
                      onClick={() => toggleOrgCollapsed(group.organizationId)}
                      aria-expanded={!isCollapsed}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                        <span className="text-lg font-semibold text-text-primary truncate">
                          {group.displayName}
                        </span>
                        {group.domain && (
                          <a
                            href={`https://${group.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:text-primary-hover shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {group.domain}
                          </a>
                        )}
                        <span className="text-sm text-text-secondary">
                          {memberCount} user{memberCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <span className="text-text-secondary shrink-0" aria-hidden>
                        {isCollapsed ? '▶' : '▼'}
                      </span>
                    </button>

                    <div
                      className="px-4 py-3 border-t border-border bg-muted/10 flex flex-wrap items-center gap-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-sm text-text-secondary shrink-0">Subscription:</span>
                      <span className="text-sm text-text-primary">
                        {group.planName || group.plan || 'No plan'}
                        {group.subscriptionStatus && group.subscriptionStatus !== 'none'
                          ? ` (${group.subscriptionStatus})`
                          : ''}
                      </span>
                      <p className="w-full text-xs text-text-muted">
                        Manual plan assignment bypasses Stripe checkout and trial periods. The org
                        gets access immediately on the selected plan.
                      </p>
                      <select
                        value={planSelections[group.organizationId] ?? group.subscriptionPlanId ?? ''}
                        onChange={(e) =>
                          setPlanSelections((prev) => ({
                            ...prev,
                            [group.organizationId]: e.target.value,
                          }))
                        }
                        disabled={!group.organizationMongoId || applyingOrgId === group.organizationId}
                        className="text-sm rounded border border-border bg-background px-2 py-1.5 text-text-primary min-w-[160px] disabled:opacity-50"
                        title={
                          group.organizationMongoId
                            ? 'Assign subscription plan'
                            : 'Organization not set up'
                        }
                      >
                        <option value="">Select plan…</option>
                        {plans.map((plan) => (
                          <option key={plan._id} value={plan._id}>
                            {plan.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="secondary"
                        onClick={() => handleApplyPlan(group)}
                        disabled={
                          !group.organizationMongoId ||
                          applyingOrgId === group.organizationId ||
                          !(planSelections[group.organizationId] ?? group.subscriptionPlanId)
                        }
                      >
                        {applyingOrgId === group.organizationId ? 'Applying…' : 'Apply'}
                      </Button>
                    </div>

                    {!isCollapsed && (
                      <>
                        {/* Desktop */}
                        <div className="hidden md:block overflow-x-auto border-t border-border">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-border bg-muted/20">
                                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">
                                  Email
                                </th>
                                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">
                                  Name
                                </th>
                                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">
                                  Domain
                                </th>
                                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">
                                  Joined
                                </th>
                                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">
                                  Role
                                </th>
                                <th className="text-right py-3 px-4 text-sm font-semibold text-text-secondary">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.members.map((user) => (
                                <tr key={user.id} className="border-b border-border hover:bg-background">
                                  <td className="py-3 px-4 text-sm text-text-primary">{user.email}</td>
                                  <td className="py-3 px-4 text-sm text-text-primary">{user.name}</td>
                                  <td className="py-3 px-4 text-sm text-text-primary">
                                    {user.organizationDomain ? (
                                      <a
                                        href={`https://${user.organizationDomain}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:text-primary-hover"
                                      >
                                        {user.organizationDomain}
                                      </a>
                                    ) : (
                                      <span className="text-text-secondary">—</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-sm text-text-secondary">
                                    {new Date(user.createdAt).toLocaleDateString()}
                                  </td>
                                  <td className="py-3 px-4 text-sm">
                                    <span className={`mr-2 px-2 py-1 rounded text-xs font-medium ${
                                      user.registrationApproval === 'approved'
                                        ? 'bg-success/10 text-success'
                                        : user.registrationApproval === 'pending'
                                          ? 'bg-warning-light text-warning-dark'
                                          : 'bg-error-light text-error'
                                    }`}>
                                      {user.registrationApproval === 'approved' ? 'Approved' : user.registrationApproval === 'pending' ? 'Pending' : 'Rejected'}
                                    </span>
                                    {user.isAdmin ? (
                                      <span className="px-2 py-1 rounded bg-primary-light text-primary-dark text-xs font-medium">
                                        Admin
                                      </span>
                                    ) : (
                                      <span className="px-2 py-1 rounded bg-border text-text-secondary text-xs font-medium">
                                        User
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-sm text-right">
                                    <div className="flex items-center justify-end gap-3">
                                      {user.registrationApproval !== 'approved' && (
                                        <button type="button" onClick={() => void handleRegistrationApproval(user.id, 'approved')}
                                          disabled={updatingId === user.id} className="text-sm px-3 py-1 rounded bg-success/10 text-success disabled:opacity-50">
                                          Approve
                                        </button>
                                      )}
                                      {user.registrationApproval === 'pending' && (
                                        <button type="button" onClick={() => void handleRegistrationApproval(user.id, 'rejected')}
                                          disabled={updatingId === user.id} className="text-sm px-3 py-1 rounded bg-error-light text-error disabled:opacity-50">
                                          Reject
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleToggleAdmin(user.id, user.isAdmin, user.email)
                                        }
                                        disabled={updatingId === user.id}
                                        className={`text-sm px-3 py-1 rounded transition-colors disabled:opacity-50 ${
                                          user.isAdmin
                                            ? 'bg-warning-light text-warning-dark hover:bg-warning'
                                            : 'bg-primary-light text-primary-dark hover:bg-primary'
                                        }`}
                                      >
                                        {updatingId === user.id
                                          ? 'Updating...'
                                          : user.isAdmin
                                            ? 'Remove Admin'
                                            : 'Make Admin'}
                                      </button>
                                      {!user.isAdmin && (
                                        <button
                                          type="button"
                                          onClick={() => handleDelete(user, group.members.length)}
                                          disabled={deletingId === user.id}
                                          className="text-error hover:text-error-dark transition-colors disabled:opacity-50"
                                        >
                                          {deletingId === user.id ? 'Deleting...' : 'Delete'}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile */}
                        <div className="md:hidden border-t border-border p-3 space-y-3 bg-muted/10">
                          {group.members.map((user) => (
                            <Card key={user.id} className="p-4">
                              <div className="space-y-3">
                                <div>
                                  <div className="text-xs font-semibold text-text-secondary mb-1">
                                    Email
                                  </div>
                                  <div className="text-sm text-text-primary">{user.email}</div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-text-secondary mb-1">
                                    Name
                                  </div>
                                  <div className="text-sm text-text-primary">{user.name}</div>
                                </div>
                                {user.organizationDomain && (
                                  <div>
                                    <div className="text-xs font-semibold text-text-secondary mb-1">
                                      Domain
                                    </div>
                                    <a
                                      href={`https://${user.organizationDomain}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm text-primary hover:text-primary-hover"
                                    >
                                      {user.organizationDomain}
                                    </a>
                                  </div>
                                )}
                                <div className="flex items-center justify-between pt-2 border-t border-border">
                                  <div>
                                    <div className="text-xs font-semibold text-text-secondary mb-1">
                                      Role
                                    </div>
                                    <div className="mb-2 text-xs font-medium">
                                      Registration: {user.registrationApproval}
                                    </div>
                                    {user.isAdmin ? (
                                      <span className="px-2 py-1 rounded bg-primary-light text-primary-dark text-xs font-medium">
                                        Admin
                                      </span>
                                    ) : (
                                      <span className="px-2 py-1 rounded bg-border text-text-secondary text-xs font-medium">
                                        User
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex gap-2">
                                    {user.registrationApproval !== 'approved' && (
                                      <button type="button" onClick={() => void handleRegistrationApproval(user.id, 'approved')}
                                        disabled={updatingId === user.id} className="text-xs px-3 py-1.5 rounded bg-success/10 text-success disabled:opacity-50">
                                        Approve
                                      </button>
                                    )}
                                    {user.registrationApproval === 'pending' && (
                                      <button type="button" onClick={() => void handleRegistrationApproval(user.id, 'rejected')}
                                        disabled={updatingId === user.id} className="text-xs px-3 py-1.5 rounded bg-error-light text-error disabled:opacity-50">
                                        Reject
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleToggleAdmin(user.id, user.isAdmin, user.email)
                                      }
                                      disabled={updatingId === user.id}
                                      className={`text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50 ${
                                        user.isAdmin
                                          ? 'bg-warning-light text-warning-dark hover:bg-warning'
                                          : 'bg-primary-light text-primary-dark hover:bg-primary'
                                      }`}
                                    >
                                      {updatingId === user.id
                                        ? 'Updating...'
                                        : user.isAdmin
                                          ? 'Remove Admin'
                                          : 'Make Admin'}
                                    </button>
                                    {!user.isAdmin && (
                                      <button
                                        type="button"
                                        onClick={() => handleDelete(user, group.members.length)}
                                        disabled={deletingId === user.id}
                                        className="text-xs px-3 py-1.5 rounded text-error hover:bg-error-light transition-colors disabled:opacity-50"
                                      >
                                        {deletingId === user.id ? 'Deleting...' : 'Delete'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
