import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '@/lib/activity/types-client';
import type { JobView } from '../jobs/JobCard';
import { OFFICE_ROLES, buildOffice } from './officeState';

const id = (c: string) => c.repeat(24);
const job = (overrides: Record<string, unknown> = {}) => ({
  id: id('a'), companyId: id('b'), companyName: 'PlayBound', status: 'active', request: 'x', canManage: true, runs: [], opportunities: [], publishing: null,
  updatedAt: '2026-11-10T00:00:00Z', teamRole: 'marketing',
  design: { skill: 'link_building', title: 'Link building', category: 'marketing', fields: [], questions: [], schedule: { kind: 'daily' } },
  ...overrides,
}) as unknown as JobView;
const companies = [{ id: id('b'), name: 'PlayBound', color: '#378ADD' }, { id: id('c'), name: 'Tailnote' }];
const build = (jobs: JobView[], activity: ActivityItem[] = [], today = []) => buildOffice({ companies, jobs, activity, today });

describe('the office', () => {
  it('keeps a member working when another assignment is awaiting review',()=>{
    const rooms=build([job({opportunities:[{id:'o',status:'recommended',values:{opportunity_type:'Resource page'},updatedAt:'2026-11-09T00:00:00Z'}]}),job({id:id('d'),runs:[{id:'r',status:'running',progressState:{label:'Researching'}}]})]);
    const member=rooms[0].desks.find(d=>d.role==='marketing')!;
    expect(member.state).toBe('working');expect(member.waiting).toBe(1);expect(member.says).toContain('Researching');expect(rooms[0].working).toBe(1);
  });
  it('uses only live outstanding consultations for collaboration', () => {
    const now=Date.parse('2026-11-19T15:00:00Z');
    const ask={at:new Date(now-1000).toISOString(),kind:'ask',from:'marketing',to:'design',text:'Review this campaign'};
    const input={companies,jobs:[job({status:'testing',teamLog:[ask]})],activity:[],today:[],now};
    const rooms=buildOffice(input);
    expect(rooms[0].desks.find(d=>d.role==='design')?.collaboration?.members).toEqual(['marketing','design']);
    for(const teamLog of [[{...ask,at:new Date(now-600000).toISOString()}],[ask,{...ask,kind:'answer',from:'design',to:'marketing'}]]) {
      expect(buildOffice({...input,jobs:[job({status:'testing',teamLog})]}).flatMap(r=>r.desks).some(d=>d.collaboration)).toBe(false);
    }
  });
  it('keeps owned and internal companies distinct from clients without losing their team or work', () => {
    const rooms = buildOffice({
      companies: [
        { id: id('b'), name: 'PlayBound', relationship: 'owned' },
        { id: id('c'), name: 'Nucleas', relationship: 'internal' },
        { id: id('d'), name: 'Client business', relationship: 'client' },
      ], jobs: [job()], activity: [], today: [],
    });
    expect(rooms.filter(r => r.relationship !== 'client').map(r => r.name).sort()).toEqual(['Nucleas', 'PlayBound']);
    expect(rooms.filter(r => r.relationship === 'client').map(r => r.name)).toEqual(['Client business']);
    expect(rooms.find(r => r.name === 'PlayBound')?.desks.find(d => d.role === 'marketing')?.jobs).toBe(1);
    expect(rooms.find(r=>r.name==='PlayBound')?.desks.map(d=>d.role)).toEqual(['marketing']);
    expect(rooms.filter(r=>r.name!=='PlayBound').every(r=>!r.desks.length)).toBe(true);
  });

  it('keeps unstaffed rooms without inventing employees, and never activates the reserved tester', () => {
    const rooms = build([]);
    expect(rooms.map((r) => r.name)).toEqual(['PlayBound', 'Tailnote']);
    expect(rooms.every(r=>r.desks.length===0)).toBe(true);
    expect(OFFICE_ROLES).not.toContain('tester');
    expect(rooms[0]?.desks.every((d) => d.state === 'away')).toBe(true);
  });

  it('shows who is waiting on you, who is working and who is resting, busiest room and desk first', () => {
    const rooms = build([
      job({ companyId: id('c'), opportunities: [{ id: 'o', status: 'recommended', values: { opportunity_type: 'Resource page' }, updatedAt: '2026-11-09T00:00:00Z' }] }),
      job({ id: id('d'), companyId: id('c'), teamRole: 'operations', runs: [{ id: 'r', status: 'running', progressState: { label: 'Reading sites' } }], design: { ...job().design, title: 'Spend check' } }),
      job({ id: id('e'), teamRole: 'creative' }),
    ]);
    expect(rooms[0]?.name).toBe('Tailnote');
    expect(rooms[0]?.waiting).toBe(1);
    expect(rooms[0]?.desks.slice(0, 2).map((d) => [d.role, d.state, d.says])).toEqual([
      ['marketing', 'waiting', 'Approve or skip a link opportunity: Resource page'],
      ['operations', 'working', 'Working on Spend check: Reading sites'],
    ]);
    expect(rooms[1]?.desks.find((d) => d.role === 'creative')?.state).toBe('idle');
  });

  it('puts code changes with Engineering and the week’s numbers on the wall', () => {
    const activity = [{ id: 'b1', kind: 'build', group: 'you', title: 'Friend View fixes', detail: 'ready', status: 'Ready', companyId: id('b'), companyName: 'PlayBound', category: 'code', open: { window: 'building' } }] as unknown as ActivityItem[];
    const rooms = buildOffice({ companies, jobs: [], activity, today: [{ companyId: id('b'), metrics: { sessions: { current: 4120, change: 12, unit: 'count' }, revenue_total: { current: 1500, change: -3, unit: 'money' } } }] });
    const engineering = rooms[0]?.desks.find((d) => d.role === 'engineering');
    expect(engineering).toMatchObject({ state: 'waiting', says: 'Friend View fixes', waiting: 1 });
    expect(rooms[0]?.screens).toEqual([{ label: 'Sessions', value: '4.1K', change: 12 }, { label: 'Revenue', value: '$1.5K', change: -3 }]);
  });
});
