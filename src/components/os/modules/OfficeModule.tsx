'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {useModuleRegistry} from '@/hooks/os/useModuleRegistry';
import {useWindowManager} from '@/hooks/os/useWindowManager';
import {useOsAuth} from '@/hooks/os/useOsAuth';
import OfficeBuilding from './office/OfficeBuilding';
import type {Desk,Room} from './office/officeState';

type DesktopState={version:string;update:{phase:string;text:string}};
function useDesktop(){
    const desktop=useSyncExternalStore(()=>()=>{},()=>typeof window!=='undefined'?window.nucleasDesktop??null:null,()=>null);
    const [state,setState]=useState<DesktopState|null>(null);
    useEffect(()=>{
        if(!desktop?.desktopState)return;
        void desktop.desktopState().then(setState).catch(()=>undefined);
        return desktop.onDesktopState?.(setState);
    },[desktop]);
    return {desktop,state};
}

export function AppsSelector(){
    const wm=useWindowManager(),auth=useOsAuth();
    const modules=useModuleRegistry();
    const admin=auth.isAdmin||auth.role==='Administrator';
    // Company and brand voice need a company payload; those open from the Companies workspace.
    const apps=modules.filter(m=>!['office','company','brand-voice','voice'].includes(m.id)
        &&(m.permissions!=='admin'||admin)&&(m.permissions!=='manager'||admin||auth.isManagerOrAdmin))
        .sort((a,b)=>a.title.localeCompare(b.title));
    return <label className="w-24 shrink-0 sm:w-40"><span className="sr-only">Open a work area</span>
        <select aria-label="Open a work area" className="ui-control h-11 w-full cursor-pointer pr-8" value="" onChange={event=>{if(event.target.value)wm.open(event.target.value);}}>
            <option value="" disabled>Apps</option>
            {apps.map(app=><option key={app.id} value={app.id}>{app.title}</option>)}
        </select>
    </label>;
}

export default function OfficeModule(){
    const wm=useWindowManager();
    const {desktop,state:desktopState}=useDesktop();
    const [voiceError,setVoiceError]=useState<string|null>(null);
    const openRoom=(room:Room)=>wm.open('company',{payload:{companyId:room.companyId,companyName:room.name}});
    const openDesk=(room:Room,desk:Desk)=>wm.open('team',{payload:{companyId:room.companyId,companyName:room.name,role:desk.role,...(desk.jobId?{jobId:desk.jobId}:{})}});
    const startVoice=async()=>{
        setVoiceError(null);
        if(desktop?.startVoice){try{await desktop.startVoice();}catch{setVoiceError('Could not start voice. Open Ask and try again.');}}
        else wm.open('assistant');
    };
    return <div className="touch-comfort h-full overflow-y-auto text-text-primary">
        <div className="sticky top-0 z-20 space-y-2 border-b border-border bg-background-card/95 px-3 py-2 backdrop-blur">
            <div className="flex items-center gap-2">
                <button type="button" onClick={()=>wm.open('assistant')} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-primary/5">
                    <span aria-hidden="true" className="text-primary">✦</span><span className="min-w-0 flex-1"><strong className="block text-sm">Ask Nucleas</strong><span className="block truncate text-[11px] text-text-secondary">Give your team an outcome.</span></span><span aria-hidden="true">↗</span>
                </button>
                <button type="button" onClick={()=>void startVoice()} className="ui-button h-11 w-11 justify-center" aria-label="Talk to Nucleas">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 11a7 7 0 01-14 0M12 18v4M8 22h8M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"/></svg>
                </button>
                <AppsSelector/>
            </div>
            {voiceError&&<p role="alert" className="text-xs text-red-400">{voiceError}</p>}
        </div>
        <div className="space-y-3 p-3">
            <OfficeBuilding onOpenRoom={openRoom} onOpenDesk={openDesk}/>
            {desktopState&&<button type="button" className="text-[11px] text-text-secondary underline" onClick={()=>void(desktopState.update.phase==='ready'?desktop?.installUpdate?.():desktop?.checkUpdate?.())}>Nucleas {desktopState.version} · {desktopState.update.text}</button>}
        </div>
    </div>;
}
