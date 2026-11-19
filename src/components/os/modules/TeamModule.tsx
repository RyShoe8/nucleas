'use client';
import { useState } from 'react';
import { useOsCompanies } from './CompaniesModule';
import CompanyTeamPanel from './CompanyTeamPanel';
import { TEAM_ROLES, type TeamRole } from '@/lib/companies/teamRoles';
import type { ModuleRenderContext } from '@/lib/os/types';

export default function TeamModule({ payload }: Partial<ModuleRenderContext>) {
  return <TeamContent key={[payload?.companyId,payload?.role,payload?.jobId].join(':')} payload={payload}/>;
}

function TeamContent({ payload }: Partial<ModuleRenderContext>) {
  const { companies, error } = useOsCompanies();
  const [selected, setSelected] = useState(payload?.companyId ?? '');
  const company = companies?.find(c => c.id === selected);
  return <div className="h-full overflow-y-auto p-5 space-y-5">
    <header className="flex flex-wrap gap-3 items-center justify-between"><div><h2 className="text-xl font-semibold">Team</h2><p className="text-sm text-text-secondary">Specialists with context. Work with an owner.</p></div><label className="text-xs">Company <select aria-label="Team company" value={selected} onChange={e => setSelected(e.target.value)} className="ml-2 rounded-lg border border-border bg-background-card p-2"><option value="">Choose a company</option>{companies?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></header>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    {company ? <CompanyTeamPanel key={company.id + (payload?.role ?? 'all') + (payload?.jobId ?? '')} companyId={company.id} companyName={company.name} focusJobId={payload?.companyId === company.id ? payload?.jobId : undefined} initialRole={payload?.companyId === company.id && TEAM_ROLES.includes(payload?.role as TeamRole) ? payload?.role as TeamRole : undefined} /> : <div className="grid sm:grid-cols-2 gap-3">{companies?.map(c => <button key={c.id} className="ui-card-interactive p-4 text-left" onClick={() => setSelected(c.id)}><strong>{c.name}</strong><p className="text-xs text-text-secondary mt-1">Open company team →</p></button>)}</div>}
  </div>;
}
