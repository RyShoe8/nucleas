'use client';
import { useEffect, useRef, useState } from 'react';
import { type Actor, type World } from './officeSimulation';
import {projectActor} from '@/lib/office/timeline';
import type {SharedOfficeFrame} from './useSharedOffice';
import { drawOfficeRig, loadOfficeRigs } from './officeRig';

/** One capped frame loop for the whole building. Positions update DOM transforms, never React per frame. */
export function useOfficeWorld(world:World, enabled:boolean, shared:SharedOfficeFrame|null) {
    const nodes=useRef(new Map<string,HTMLButtonElement>());
    const latest=useRef(shared);
    useEffect(()=>{latest.current=shared;},[shared]);
    const [snapshot,setSnapshot]=useState<Actor[]>([]);
    const [rigReady,setRigReady]=useState(false);
    useEffect(()=>{let cancelled=false;void loadOfficeRigs().then(()=>{if(!cancelled)setRigReady(true);}).catch(()=>{});return()=>{cancelled=true;};},[]);
    useEffect(()=>{
        let frame=0,last=0,published=0;
        const visible=new Set<string>();
        const observer=new IntersectionObserver(entries=>{for(const entry of entries){const id=(entry.target as HTMLElement).dataset.person;if(id){if(entry.isIntersecting)visible.add(id);else visible.delete(id);}}},{rootMargin:'100px'});
        for(const [id,node] of nodes.current){node.dataset.person=id;observer.observe(node);}
        const canvases=new Map([...nodes.current].map(([id,node])=>[id,node.querySelector('canvas')]));
        const people=new Map(world.people.map(p=>[p.id,p]));
        const paint=()=>{
            const shared=latest.current;
            if(!shared)return [];
            // Extrapolate only the persisted route, never invent a local next activity.
            // If disconnected, stop after ten seconds instead of running a private office.
            const now=shared.snapshot.serverTime+Math.min(10000,Math.max(0,performance.now()-shared.receivedAt));
            const actors=shared.snapshot.scene.actors.map(actor=>projectActor(actor,Math.max(0,(now-shared.snapshot.scene.at)/1000)));
            for(const actor of actors) {
                const id=actor.id;
                const node=nodes.current.get(id);
                if(!node) continue;
                node.style.transform=`translate3d(${actor.point.x-44}px,${actor.point.y-82}px,0)`;
                node.style.zIndex=String(actor.arrived&&actor.destination.depth!==undefined?actor.destination.depth:Math.round(actor.point.y)+100);
                node.dataset.walking=String(!actor.arrived);
                node.style.setProperty('--facing',String(actor.facing));
                const canvas=canvases.get(id),person=people.get(id);
                if(rigReady&&canvas&&person&&(visible.has(id)||!enabled)) {
                    node.dataset.rig=String(drawOfficeRig(canvas,person.desk.role,actor,person.desk.state==='working',now/1000));
                }
            }
            return actors;
        };
        if(!enabled) {
            // Reduced motion displays current shared positions without animating travel.
            setSnapshot(paint());return()=>observer.disconnect();
        }
        const tick=(time:number)=>{
            frame=requestAnimationFrame(tick);
            if(last && time-last<1000/30) return;
            last=time;
            const actors=paint();
            if(time-published>500) {setSnapshot(actors);published=time;}
        };
        frame=requestAnimationFrame(tick);
        return ()=>{cancelAnimationFrame(frame);observer.disconnect();};
    },[world,enabled,shared?.snapshot.revision,rigReady]);
    return {nodes,snapshot};
}
