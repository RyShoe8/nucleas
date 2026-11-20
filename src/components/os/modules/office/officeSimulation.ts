import type { Desk, Room } from './officeState';
import { CHARACTER_ROLES } from './characters';
import { AMENITIES, type Amenity } from './officeActivities';

export type Point = { x: number; y: number };
export type Suite = { room: Room; x: number; y: number; w: number; h: number; door: Point; lane: number };
export type Destination = { key: string; point: Point; exit: Point[]; pose: 'idle' | 'seated' | 'pool' | 'coffee'; label: string; amenity?: Amenity; collaboration?: boolean; view?: 'rear'; depth?: number };
export type Person = { id: string; room: Room; desk: Desk; home: Destination };
export type World = { width: number; height: number; suites: Suite[]; people: Person[]; layoutVersion?: number };
export const personId = (company: string, role: string) => `${company}:${role}`;
export const SPINE = 90;
export const OFFICE_LAYOUT_VERSION = 2;
export const AMENITY_POSITION: Record<Amenity, Point & { size: number }> = {
    conference: { x: 285, y: 320, size: 230 }, projector: { x: 285, y: 140, size: 150 },
    pool: { x: 770, y: 340, size: 195 }, gaming: { x: 1100, y: 230, size: 170 },
    couch: { x: 1100, y: 385, size: 230 }, coffee: { x: 755, y: 135, size: 135 },
    water: { x: 950, y: 150, size: 100 }, plant: { x: 1200, y: 140, size: 95 }, reception: { x: 480, y: 577, size: 105 },
};

export function makeWorld(rooms: Room[]): World {
    const owned = rooms.filter(r => r.relationship !== 'client').sort((a,b) => Number(b.kind==='management')-Number(a.kind==='management')||a.companyId.localeCompare(b.companyId));
    const clients = rooms.filter(r => r.relationship === 'client').sort((a,b) => a.companyId.localeCompare(b.companyId));
    // The commons occupies the first two bays. Companies fill a compact grid, with
    // the client wing alongside it; every row joins the same circulation aisle.
    const humanCount=owned.find(r=>r.kind==='management')?.desks.length??0;
    const humanColumns=Math.max(3,Math.min(5,Math.ceil(Math.sqrt(humanCount*1.5))));
    const firstHeight=Math.max(575,Math.ceil(humanCount/humanColumns)*140+220);
    const minimum=owned.some(r=>r.kind==='management')?3:2;
    const candidates=Array.from({length:Math.max(1,Math.min(6,owned.length+2)-minimum+1)},(_,i)=>{
      const columns=i+minimum,ownedRows=Math.ceil((owned.length+2)/columns),lastUsed=(owned.length+2)%columns||columns;
      const lastCapacity=Math.floor((columns-lastUsed)*740/440),perClientRow=Math.floor(columns*740/440);
      const rows=ownedRows+Math.ceil(Math.max(0,clients.length-lastCapacity)/perClientRow);
      const width=150+columns*740,height=firstHeight+90+(rows-1)*530;
      const unused=Math.max(0,(rows*columns-owned.length-2)*740-clients.length*440)/(rows*columns*740);
      const score=Math.abs(Math.log((width*.86+height*.12)/(height*.9)/1.8))+unused*.7;
      return {columns,ownedRows,lastUsed,lastCapacity,perClientRow,score};
    });
    const {columns,ownedRows,lastUsed,lastCapacity,perClientRow}=candidates.sort((a,b)=>a.score-b.score)[0];
    const rowY = (row:number) => row === 0 ? 30 : firstHeight+90 + (row - 1) * 530;
    const rowHeight = (row:number) => row === 0 ? firstHeight : 475;
    const suites: Suite[] = [...owned.map((room, index): Suite => {
        const slot=index+2,row=Math.floor(slot/columns),x=150+(slot%columns)*740,y=rowY(row),h=rowHeight(row);
        return {room,x,y,w:680,h,door:{x:x+680,y:y+h-35},lane:x+650};
    }), ...clients.map((room,index): Suite => {
        const inLast=index<lastCapacity,tail=index-lastCapacity,row=inLast?ownedRows-1:ownedRows+Math.floor(tail/perClientRow),x=inLast?150+lastUsed*740+index*440:150+(tail%perClientRow)*440,y=rowY(row),h=rowHeight(row);
        return {room,x,y,w:380,h,door:{x,y:y+h-35},lane:x+22};
    })];
    const people = suites.flatMap(suite => (suite.room.kind==='management'?suite.room.desks:CHARACTER_ROLES.map(role=>suite.room.desks.find(d=>d.role===role)).filter((d):d is Desk=>Boolean(d))).flatMap((desk,index) => {
        if (!desk) return [];
        const role=desk.role;
        const client = suite.room.relationship === 'client';
        const point = desk.human?{x:suite.x+75+(index%humanColumns)*(560/humanColumns),y:suite.y+160+Math.floor(index/humanColumns)*140}:{x:suite.x+(client?80:125)+(index%3)*(client?100:190),y:suite.y+160+Math.floor(index/3)*165};
        const hallX=client?suite.x-30:suite.x+suite.w+30,hallY=suite.y+suite.h+30;
        const id=desk.human?`human:${desk.employeeId}`:personId(suite.room.companyId,role);
        return [{ id, room:suite.room,desk,home:{key:`desk:${id}`,point,pose:desk.human||desk.state==='working'?'seated':'idle',label:desk.says ?? (desk.state==='waiting'?'Needs your review':desk.state==='away'?'No work assigned':'Available'), exit:[{x:point.x,y:point.y+34},{x:suite.lane,y:point.y+34},{x:suite.lane,y:suite.door.y},suite.door,{x:hallX,y:suite.door.y},{x:hallX,y:hallY},{x:SPINE,y:hallY}]} as Destination }];
    }));
    return {width:Math.max(1320,...suites.map(s=>s.x+s.w+60)),height:Math.max(640,...suites.map(s=>s.y+s.h+60)),suites,people,layoutVersion:OFFICE_LAYOUT_VERSION};
}

export function amenityDestination(amenity: Amenity, slot: number): Destination {
    const pos=AMENITY_POSITION[amenity];
    let point: Point;
    if(amenity==='conference') point={x:210+(slot%3)*75,y:slot<3?290:385};
    else if(amenity==='pool') point={x:slot%2?865:675,y:slot%2?370:390};
    else if(amenity==='gaming'||amenity==='couch') point={x:1055+slot*45,y:440-slot*15};
    else if(amenity==='coffee') point={x:730+slot*65,y:205};
    else if(amenity==='water') point={x:930+slot*55,y:218};
    else point={x:pos.x,y:pos.y+60};
    const left=amenity==='conference'||amenity==='projector';
    const door={x:left?530:980,y:520};
    const sofa=amenity==='gaming'||amenity==='couch';
    const exit=sofa ? [{x:1220,y:point.y},{x:1220,y:490},{x:980,y:490},door,{x:980,y:580},{x:SPINE,y:580}] : amenity==='reception' ? [{x:SPINE,y:577}] : amenity==='conference' ? [
        {x:point.x,y:slot<3?240:440},{x:545,y:slot<3?240:440},{x:545,y:470},{x:door.x,y:470},door,{x:door.x,y:580},{x:SPINE,y:580},
    ] : [
        {x:point.x,y:amenity==='pool'?455:point.y+35}, {x:left?545:925,y:amenity==='pool'?455:point.y+35}, {x:left?545:925,y:470}, {x:door.x,y:470},door,{x:door.x,y:580},{x:SPINE,y:580},
    ];
    return {key:`${amenity}:${slot}`,point,exit,amenity,pose:amenity==='pool'?'pool':amenity==='coffee'||amenity==='water'?'coffee':amenity==='conference'||sofa?'seated':'idle',label:AMENITIES[amenity].action,...(sofa?{view:'rear' as const,depth:475}:{})};
}

/** Exit via a room's aisle and door; every inter-room route uses the same central spine. */
export function routeBetween(from: Destination,to: Destination): Point[] {
    if(from.key===to.key || (from.point.x===to.point.x&&from.point.y===to.point.y)) return [];
    // Join at the nearest shared aisle, rather than leaving and re-entering the same room.
    const join=from.exit.findIndex(p=>to.exit.some(q=>q.x===p.x&&q.y===p.y));
    const other=join<0?-1:to.exit.findIndex(p=>p.x===from.exit[join].x&&p.y===from.exit[join].y);
    const points=join<0?[...from.exit,...[...to.exit].reverse(),to.point]:[...from.exit.slice(0,join+1),...to.exit.slice(0,other).reverse(),to.point];
    return points.filter((p,i)=>!i||p.x!==points[i-1].x||p.y!==points[i-1].y);
}
const hash=(value:string)=>[...value].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0);

/** Real work wins. Only live consultations occupy collaboration spaces; idle life is explicitly ambient. */
export function chooseDestinations(world:World, elapsedSeconds:number, overrides:Record<string,Amenity|'desk'>={}):Map<string,Destination> {
    const result=new Map<string,Destination>();
    const occupied=new Map<Amenity,number>();
    let sofaSeats=0;
    const meetingGroups=new Set<string>();
    for(const p of world.people) {
        const group=p.desk.collaboration;
        if(!group || p.desk.state==='waiting') continue;
        const participants=world.people.filter(other=>other.room.companyId===p.room.companyId && other.desk.collaboration?.id===group.id && other.desk.state!=='waiting');
        if(participants.length>=3) {
            if(meetingGroups.size && !meetingGroups.has(group.id)) continue;
            meetingGroups.add(group.id);
            const slot=occupied.get('conference')??0;
            if(slot>=6) continue;
            result.set(p.id,{...amenityDestination('conference',slot),label:`Team meeting: ${group.title}`,collaboration:true});
            occupied.set('conference',slot+1);
        } else if(participants.length===2) {
            const host=participants.find(other=>other.desk.role===group.host)??participants[0];
            result.set(p.id,{...host.home,key:`consult:${group.id}:${p.id}`,point:{x:host.home.point.x+(p.id===host.id?0:55),y:host.home.point.y},pose:p.id===host.id?'seated':'idle',label:`Discussing: ${group.title}`,collaboration:true});
        }
    }
    // Explicit visits reserve seats first, so ambient occupants cannot silently override a request.
    const visitors=[...world.people].sort((a,b)=>Number(Boolean(overrides[b.id]))-Number(Boolean(overrides[a.id])));
    for(const p of visitors) {
        if(result.has(p.id)) continue;
        if(p.desk.human){result.set(p.id,p.home);continue;}
        if(p.desk.state==='working'||p.desk.state==='waiting') {result.set(p.id,p.home);continue;}
        const preference=overrides[p.id];
        const seed=hash(p.id);
        // Stagger arrivals and rotate long breaks without a permanent crowd of every employee.
        const epoch=Math.floor(elapsedSeconds/150);
        const eligible=elapsedSeconds>8+seed%22 && (seed+epoch)%3===0;
        const ambient: Amenity[]=['pool','pool','coffee','water','gaming','couch'];
        const amenity=preference && preference!=='desk' ? preference : preference==='desk'||!eligible ? null : ambient[((seed>>>4)+epoch)%ambient.length];
        const sofa=amenity==='gaming'||amenity==='couch';
        const slot=sofa?sofaSeats:amenity?(occupied.get(amenity)??0):0;
        if(amenity && slot<AMENITIES[amenity].capacity) {
            result.set(p.id,amenityDestination(amenity,slot)); occupied.set(amenity,slot+1);if(sofa)sofaSeats++;
        } else result.set(p.id,p.home);
    }
    return result;
}

export type Actor = { id:string; point:Point; destination:Destination; route:Point[]; arrived:boolean; facing:number; pending?:Destination };
export function moveActor(actor:Actor, destination:Destination, seconds:number):Actor {
    if(actor.arrived&&actor.destination.key===destination.key&&!actor.pending) return actor.destination===destination?actor:{...actor,destination};
    let next={...actor,point:{...actor.point},route:[...actor.route]};
    if(destination.key===next.destination.key) next.destination=destination;
    // Finish the current aisle safely before accepting a new target; never jump across furniture.
    if(destination.key!==next.destination.key) {
        if(!next.arrived) next.pending=destination;
        else {next.route=routeBetween(next.destination,destination);next.destination=destination;next.arrived=!next.route.length;next.pending=undefined;}
    } else next.pending=undefined;
    let distance=Math.min(seconds,.25)*58;
    while(distance>0 && next.route.length) {
        const target=next.route[0],dx=target.x-next.point.x,dy=target.y-next.point.y,length=Math.hypot(dx,dy);
        if(Math.abs(dx)>1) next.facing=dx<0?-1:1;
        if(length<=distance) {next.point=target;next.route.shift();distance-=length;}
        else {next.point={x:next.point.x+dx/length*distance,y:next.point.y+dy/length*distance};distance=0;}
    }
    next.arrived=next.route.length===0;
    if(next.arrived && next.pending) { const pending=next.pending; next={...next,destination:pending,route:routeBetween(next.destination,pending),pending:undefined,arrived:false}; }
    return next;
}

export function officeTheme(room:Pick<Room,'name'|'description'|'domain'>):{label:string; objects:string[]} {
    const text=`${room.description??''} ${room.name} ${room.domain??''}`.toLowerCase();
    if(/management|human team/.test(text)) return {label:'Team leadership',objects:['books','chart','globe']};
    if(/casino|gambl|betting/.test(text)) return {label:'Odds & discovery',objects:['trophy','chart','globe']};
    if(/game|gaming|sports|playbound/.test(text)) return {label:'Play & community',objects:['controller','trophy','arcade']};
    if(/bank|payment|finance|pay\b/.test(text)) return {label:'Commerce & payments',objects:['chart','globe','safe']};
    if(/media|marketing|creative|design|content|cinema|demo/.test(text)) return {label:'Creative studio',objects:['camera','palette','books']};
    if(/home|property|hearth|gutter|construction|service/.test(text)) return {label:'Places & services',objects:['house','tools','plant']};
    if(/email|signature|tailnote/.test(text)) return {label:'Identity & correspondence',objects:['mail','palette','books']};
    if(/software|app|nucleas|platform/.test(text)) return {label:'Product studio',objects:['laptop','chart','globe']};
    return {label:'Company studio',objects:['books','globe','plant']};
}

/** Stable per-company finishes: adding staff never changes the company's identity. */
export function studioStyle(room:Room) {
    const seed=hash(room.companyId+room.name),theme=officeTheme(room);
    const finishes=[['#8b9d8b','#4c776a','#c9af7d'],['#ae9d80','#627b71','#dec6a0'],['#718e86','#375f58','#b3bf9c'],['#b6b69b','#7b8b67','#cbb78c']];
    const [floor,rug,trim]=finishes[seed%finishes.length];
    return {seed,floor,rug,trim,theme};
}
