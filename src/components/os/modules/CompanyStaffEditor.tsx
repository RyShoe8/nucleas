'use client';
import { useState } from 'react';
import { TEAM, type TeamRole } from '@/lib/companies/teamRoles';

export interface StaffMember { role: TeamRole; name: string; active: boolean; specialty?: string; reviewerEmployeeId?: string | null }
const examples: Record<TeamRole, string> = { design: 'UX researcher, product designer', creative: 'Brand artist, animator, video producer', engineering: 'Platform engineer, frontend developer', support: 'Customer success, community care', operations: 'Resource planning, workflow improvement', marketing: 'SEO specialist, growth strategist, social editor', tester: 'Reserved' };
function StaffCard({ member, reviewers, save }: { member: StaffMember; reviewers: { id: string; name: string }[]; save: (body: Record<string, unknown>) => Promise<unknown> }) {
  const [active, setActive] = useState(member.active), [name, setName] = useState(member.name), [specialty, setSpecialty] = useState(member.specialty ?? ''), [reviewer, setReviewer] = useState(member.reviewerEmployeeId ?? ''), [saving, setSaving] = useState(false);
  return <form className="rounded-xl border border-border p-3 space-y-3" onSubmit={async e => { e.preventDefault(); setSaving(true); try { await save({ action: 'staff', role: member.role, active, displayName: name, specialty, reviewerEmployeeId: reviewer || null }); } finally { setSaving(false); } }}>
    <label className="flex gap-2 items-center text-sm font-semibold"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />{TEAM[member.role].name}<span className="ml-auto text-xs font-normal text-text-secondary">{member.active ? 'Assigned' : 'Available'}</span></label>
    <label className="block text-xs">Employee name<input required maxLength={60} value={name} onChange={e => setName(e.target.value)} className="ui-control mt-1 w-full" /></label>
    <label className="block text-xs">Specialty<input maxLength={120} value={specialty} placeholder={examples[member.role]} onChange={e => setSpecialty(e.target.value)} className="ui-control mt-1 w-full" /></label>
    <label className="block text-xs">Human contact for reviews<select value={reviewer} onChange={e => setReviewer(e.target.value)} className="ui-control mt-1 w-full"><option value="">Organization owner</option>{reviewers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <button disabled={saving} className="ui-button text-xs">{saving ? 'Saving…' : 'Save assignment'}</button>
  </form>;
}
export default function CompanyStaffEditor({ members, reviewers, save }: { members: StaffMember[]; reviewers: { id: string; name: string }[]; save: (body: Record<string, unknown>) => Promise<unknown> }) {
  return <details className="rounded-2xl border border-border p-4"><summary className="cursor-pointer font-semibold text-sm">Manage virtual employees <span className="text-text-secondary font-normal">· {members.filter(m => m.active).length} assigned</span></summary>
    <p className="my-3 text-xs text-text-secondary">Choose who works here and give each employee a specialty. Each assignment has its own persistent name, appearance and desk. Their human contact receives review and intervention alerts. Existing company permissions still apply. Assigning work also assigns its employee; existing work must be reassigned or finished before removing them.</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{members.filter(m => TEAM[m.role].active).map(m => <StaffCard key={`${m.role}:${m.active}:${m.name}:${m.specialty}:${m.reviewerEmployeeId}`} member={m} reviewers={reviewers} save={save} />)}</div>
    <p className="mt-3 text-xs text-text-secondary">Tester remains reserved and inactive.</p>
  </details>;
}
