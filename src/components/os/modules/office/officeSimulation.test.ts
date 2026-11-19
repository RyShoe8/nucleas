import {describe,it,expect} from 'vitest';
import {makeWorld,chooseDestinations,moveActor,routeBetween,amenityDestination,type Actor} from './officeSimulation';
import {buildOffice} from './officeState';
const rooms=()=>buildOffice({companies:[{id:'owned',name:'PlayBound',relationship:'owned'},{id:'client',name:'Client',relationship:'client'}],jobs:[],activity:[],today:[]});
describe('connected office simulation',()=>{
  it('keeps company locations stable when urgency changes their input order',()=>{
    const a=rooms(),b=[...a].reverse();
    expect(makeWorld(a).suites).toEqual(makeWorld(b).suites);
    const world=makeWorld(a);
    expect(world.suites[0].w).toBeGreaterThan(world.suites[1].w);
  });
  it('uses doorways and bounded movement without teleporting',()=>{
    const world=makeWorld(rooms()),person=world.people[0],pool=amenityDestination('pool',0);
    expect(routeBetween(person.home,pool)).toContainEqual(world.suites[0].door);
    let actor:Actor={id:person.id,point:person.home.point,destination:person.home,route:[],arrived:true,facing:1};
    for(let tick=0;tick<2000;tick++) {
      const next=moveActor(actor,pool,.1);
      expect(Math.hypot(next.point.x-actor.point.x,next.point.y-actor.point.y)).toBeLessThanOrEqual(5.80001);
      actor=next;if(actor.arrived)break;
    }
    expect(actor.point).toEqual(pool.point);expect(actor.arrived).toBe(true);
  });
  it('keeps working and waiting employees out of ambient breaks',()=>{
    const world=makeWorld(rooms());world.people[0].desk.state='working';world.people[1].desk.state='waiting';
    const destinations=chooseDestinations(world,300,{[world.people[0].id]:'pool',[world.people[1].id]:'coffee'});
    expect(destinations.get(world.people[0].id)).toBe(world.people[0].home);
    expect(destinations.get(world.people[1].id)).toBe(world.people[1].home);
  });
  it('places pairs at a desk and three collaborators in the conference room',()=>{
    const world=makeWorld(rooms()),people=world.people.slice(0,3);
    const group={id:'job',title:'Campaign',members:people.map(p=>p.desk.role),host:people[0].desk.role};
    for(const person of people.slice(0,2)){person.desk.collaboration=group;person.desk.state='working';}
    let places=chooseDestinations(world,0);
    expect(places.get(people[1].id)?.key).toContain('consult:');
    people[2].desk.collaboration=group;people[2].desk.state='working';
    places=chooseDestinations(world,0);
    for(const person of people)expect(places.get(person.id)?.amenity).toBe('conference');
    expect(new Set(people.map(p=>places.get(p.id)?.key)).size).toBe(3);
  });
  it('does not change the destination prematurely when work arrives during a walk',()=>{
    const p=makeWorld(rooms()).people[0],pool=amenityDestination('pool',0);
    const start:Actor={id:p.id,point:p.home.point,destination:p.home,route:[],arrived:true,facing:1};
    const moving=moveActor(start,pool,.1),interrupted=moveActor(moving,p.home,.1);
    expect(interrupted.destination.key).toBe(pool.key);expect(interrupted.pending?.key).toBe(p.home.key);
  });
  it('shares three distinct couch seats between gaming and relaxing, away from the TV',()=>{
    const world=makeWorld(rooms());
    const visitors=world.people.slice(0,4);
    const places=chooseDestinations(world,0,Object.fromEntries(visitors.map((p,i)=>[p.id,i===1?'couch':'gaming'])));
    const seated=visitors.map(p=>places.get(p.id)!).filter(d=>d.view==='rear');
    expect(seated).toHaveLength(3);
    expect(new Set(seated.map(d=>`${d.point.x}:${d.point.y}`)).size).toBe(3);
    for(const seat of seated) {expect(seat.point.y).toBeGreaterThan(400);expect(seat.depth).toBe(475);}
    expect(places.get(visitors[3].id)).toBe(visitors[3].home);
  });
  it('supports simultaneous shared amenities and gives explicit visits priority over ambient breaks',()=>{
    const world=makeWorld(rooms()),people=world.people.slice(-6);
    const requests=['pool','pool','coffee','coffee','water','water'] as const;
    const places=chooseDestinations(world,300,Object.fromEntries(people.map((p,i)=>[p.id,requests[i]])));
    expect(people.map(p=>places.get(p.id)?.amenity)).toEqual(requests);
    expect(new Set(people.map(p=>places.get(p.id)?.key)).size).toBe(6);
    expect(new Set(people.map(p=>JSON.stringify(places.get(p.id)?.point))).size).toBe(6);
  });
});
