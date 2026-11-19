'use client';
import { useEffect, useRef, useState } from 'react';
import { chooseDestinations, moveActor, type Actor, type World } from './officeSimulation';
import type { Amenity } from './officeActivities';
import { drawOfficeRig, loadOfficeRigs } from './officeRig';

/** One capped frame loop for the whole building. Positions update DOM transforms, never React per frame. */
export function useOfficeWorld(world:World, enabled:boolean, overrides:Record<string,Amenity|'desk'>) {
    const nodes=useRef(new Map<string,HTMLButtonElement>());
    const actors=useRef(new Map<string,Actor>());
    const elapsed=useRef(0);
    const [snapshot,setSnapshot]=useState<Actor[]>([]);
    const [rigReady,setRigReady]=useState(false);
    useEffect(()=>{let cancelled=false;void loadOfficeRigs().then(()=>{if(!cancelled)setRigReady(true);}).catch(()=>{});return()=>{cancelled=true;};},[]);
    useEffect(()=>{
        const ids=new Set(world.people.map(p=>p.id));
        for(const id of actors.current.keys()) if(!ids.has(id)) actors.current.delete(id);
        for(const p of world.people) if(!actors.current.has(p.id)) actors.current.set(p.id,{id:p.id,point:p.home.point,destination:p.home,route:[],arrived:true,facing:1});
        let frame=0,last=0,published=0,planned=-10;
        let destinations=chooseDestinations(world,elapsed.current,overrides);
        const visible=new Set<string>();
        const observer=new IntersectionObserver(entries=>{for(const entry of entries){const id=(entry.target as HTMLElement).dataset.person;if(id){if(entry.isIntersecting)visible.add(id);else visible.delete(id);}}},{rootMargin:'100px'});
        for(const [id,node] of nodes.current){node.dataset.person=id;observer.observe(node);}
        const canvases=new Map([...nodes.current].map(([id,node])=>[id,node.querySelector('canvas')]));
        const people=new Map(world.people.map(p=>[p.id,p]));
        const paint=()=>{
            for(const [id,actor] of actors.current) {
                const node=nodes.current.get(id);
                if(!node) continue;
                node.style.transform=`translate3d(${actor.point.x-44}px,${actor.point.y-82}px,0)`;
                node.style.zIndex=String(Math.round(actor.point.y)+100);
                node.dataset.walking=String(!actor.arrived);
                node.style.setProperty('--facing',String(actor.facing));
                const canvas=canvases.get(id),person=people.get(id);
                if(rigReady&&canvas&&person&&(visible.has(id)||!enabled)) {
                    node.dataset.rig=String(drawOfficeRig(canvas,person.desk.role,actor,person.desk.state==='working',elapsed.current));
                }
            }
        };
        if(!enabled) {
            // Freeze travel and ambient life, but preserve truthful work/pose labels at stations.
            for(const p of world.people) {
                const actor=actors.current.get(p.id)!;
                if(actor.arrived&&actor.destination.key===p.home.key) actors.current.set(p.id,{...actor,destination:p.home});
            }
            paint();setSnapshot([...actors.current.values()]);return()=>observer.disconnect();
        }
        const tick=(time:number)=>{
            frame=requestAnimationFrame(tick);
            if(last && time-last<1000/30) return;
            const delta=last?Math.min((time-last)/1000,.1):0;
            last=time;elapsed.current+=delta;
            if(elapsed.current-planned>1) {destinations=chooseDestinations(world,elapsed.current,overrides);planned=elapsed.current;}
            for(const [id,actor] of actors.current) {
                const destination=destinations.get(id);
                if(destination) actors.current.set(id,moveActor(actor,destination,delta));
            }
            paint();
            if(time-published>500) {setSnapshot([...actors.current.values()]);published=time;}
        };
        frame=requestAnimationFrame(tick);
        return ()=>{cancelAnimationFrame(frame);observer.disconnect();};
    },[world,enabled,overrides,rigReady]);
    return {nodes,snapshot};
}
