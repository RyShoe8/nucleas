import {describe,it,expect} from 'vitest';
import {buildOffice} from '@/components/os/modules/office/officeState';
import {advanceScene,projectActor,visibleSnapshot} from './timeline';
const rooms=()=>buildOffice({companies:[{id:'a',name:'A',relationship:'owned'},{id:'b',name:'B',relationship:'client'}],jobs:[],activity:[],today:[],assignments:['a', 'b'].flatMap(companyId=>(['design','creative','engineering','support','operations','marketing'] as const).map(role=>({companyId,role,active:true,displayName:role})))});
describe('shared office timeline',()=>{
  it('late joiners and continuously open windows see the same position',()=>{
    const start=advanceScene(null,rooms(),1000000,{personId:'a:design',target:'pool'});
    const actor=start.actors.find(a=>a.id==='a:design')!;
    const late=projectActor(actor,10);
    let continuous=actor;
    for(let i=0;i<300;i++)continuous=projectActor(continuous,1/30);
    expect(continuous.point.x).toBeCloseTo(late.point.x,7);
    expect(continuous.point.y).toBeCloseTo(late.point.y,7);
    expect(actor.point).not.toEqual(late.point);
  });
  it('survives a process restart using only the persisted JSON snapshot',()=>{
    const first=advanceScene(null,rooms(),1000000,{personId:'a:design',target:'coffee'});
    const restart=advanceScene(JSON.parse(JSON.stringify(first)),undefined,1010000);
    expect(restart).toEqual(advanceScene(first,undefined,1010000));
    expect(restart.overrides['a:design']).toBe('coffee');
  });
  it('removes an ambient override when real work arrives',()=>{
    const first=advanceScene(null,rooms(),1000000,{personId:'a:design',target:'pool'});
    const busy=rooms();busy[0].desks.find(d=>d.role==='design')!.state='working';
    const next=advanceScene(first,busy,1100000);
    expect(next.overrides['a:design']).toBeUndefined();
    expect(next.actors.find(a=>a.id==='a:design')?.destination.key).toBe('desk:a:design');
  });
  it('filters unauthorized companies without changing anyone else’s seat or room location',()=>{
    const scene=advanceScene(null,rooms(),1000000);
    const filtered=visibleSnapshot({scene,revision:1,serverTime:1000000},new Set(['b']));
    expect(filtered.scene.world.suites).toEqual(scene.world.suites.filter(s=>s.room.companyId==='b'));
    expect(filtered.scene.actors).toEqual(scene.actors.filter(a=>a.id.startsWith('b:')));
    expect(JSON.stringify(filtered)).not.toContain('"companyId":"a"');
    expect(filtered.scene.overrides).toEqual({});
  });
  it('keeps human names visible while filtering their reporting links, including nested room data',()=>{
    const all=rooms();
    all.unshift({kind:'management',companyId:'management',name:'Management',relationship:'internal',color:'#6eae83',description:'Humans',waiting:0,working:0,screens:[],desks:[{human:true,employeeId:'human1',name:'Ryan',role:'operations',state:'idle',says:'Human teammate',waiting:0,jobs:2,reports:[{companyId:'a',companyName:'Secret company',role:'marketing',name:'Secret employee'},{companyId:'b',companyName:'B',role:'design',name:'Morgan'}]}]});
    const scene=advanceScene(null,all,1000000);
    const filtered=visibleSnapshot({scene,revision:1,serverTime:1000000},new Set(['b']));
    const human=filtered.scene.world.people.find(p=>p.desk.human)!;
    expect(human.desk.name).toBe('Ryan');expect(human.desk.jobs).toBe(1);
    expect(human.desk.reports).toHaveLength(1);expect(human.room.desks[0].reports).toHaveLength(1);
    expect(filtered.scene.actors.find(a=>a.id===human.id)?.point).toEqual(scene.actors.find(a=>a.id===human.id)?.point);
    expect(JSON.stringify(filtered)).not.toContain('Secret');
  });
});
