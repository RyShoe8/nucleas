'use client';
import { useVoiceWorkspace } from '../voice/VoiceWorkspace';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {useTitleSlot} from '@/lib/os/titleSlot';
import {useModuleRegistry} from '@/hooks/os/useModuleRegistry';
import {useWindowManager} from '@/hooks/os/useWindowManager';
import {useOsAuth} from '@/hooks/os/useOsAuth';
import OfficeBuilding from './office/OfficeBuilding';
import type {Desk,Room} from './office/officeState';

type DesktopState={version:string;update:{phase:string;text:string};taskbar?:{enabled:boolean;supported:boolean;mode:string;detail:string}};
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

export function AppsSelector({onOpen}:{onOpen?:()=>void}={}){
    const wm=useWindowManager(),auth=useOsAuth();
    const modules=useModuleRegistry();
    const admin=auth.isAdmin||auth.role==='Administrator';
    // Company and brand voice need a company payload; those open from the Companies workspace.
    const apps=modules.filter(m=>!m.launcherHidden&&!['office','company','brand-voice','voice'].includes(m.id)
        &&(m.permissions!=='admin'||admin)&&(m.permissions!=='manager'||admin||auth.isManagerOrAdmin))
        .sort((a,b)=>a.title.localeCompare(b.title));
    return <label className="w-20 shrink-0 sm:w-32"><span className="sr-only">Open a work area</span>
        <select aria-label="Open a work area" className="ui-control h-8 w-full cursor-pointer pr-5 text-xs" value="" onChange={event=>{if(event.target.value){onOpen?.();wm.open(event.target.value);}}}>
            <option value="" disabled>Apps</option>
            {apps.map(app=><option key={app.id} value={app.id}>{app.title}</option>)}
        </select>
    </label>;
}

export default function OfficeModule({onNavigate,windowId='web-office'}:{onNavigate?:()=>void;windowId?:string}){
    useVoiceWorkspace({ moduleId: 'office', companyId: '', companyName: '' });
    const wm=useWindowManager();
    const open=(...args:Parameters<typeof wm.open>)=>{onNavigate?.();return wm.open(...args);};
    const {desktop,state:desktopState}=useDesktop();
    const [voiceError,setVoiceError]=useState<string|null>(null);
    const titleSlot=useTitleSlot(windowId);
    const openRoom=(room:Room)=>open('company',{payload:{companyId:room.companyId,companyName:room.name}});
    const openDesk=(room:Room,desk:Desk)=>open(desk.instanceId?'work':'team',{payload:{companyId:room.companyId,companyName:room.name,role:desk.role,...(desk.instanceId?{assignedMemberId:desk.instanceId,ownerKind:'additional'}:{}),...(desk.jobId?{jobId:desk.jobId}:{})}});
    const startVoice=async()=>{
        setVoiceError(null);
        if(desktop?.startVoice){try{await desktop.startVoice();}catch{setVoiceError('Could not start voice. Open Ask and try again.');}}
        else open('assistant');
    };
    const controls=<div className="flex min-w-0 items-center gap-1 sm:gap-2" style={{WebkitAppRegion:'no-drag'} as React.CSSProperties}>
                <button type="button" aria-label="Ask Nucleas" onClick={()=>open('assistant')} className="ui-button h-8 whitespace-nowrap px-2 text-xs">
                    <span aria-hidden="true">✦</span><span className="sm:hidden">Ask</span><span className="hidden sm:inline">Ask Nucleas</span>
                </button>
                <button type="button" onClick={()=>void startVoice()} className="ui-button h-8 w-8 justify-center p-1" aria-label="Talk to Nucleas">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 11a7 7 0 01-14 0M12 18v4M8 22h8M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"/></svg>
                </button>
                <AppsSelector onOpen={onNavigate}/>
            </div>;
    return <div className="touch-comfort relative h-full min-h-0 overflow-hidden text-text-primary">
        {titleSlot&&createPortal(controls,titleSlot)}
        {voiceError&&<p role="alert" className="absolute left-3 top-3 z-20 rounded bg-background-card p-2 text-xs text-red-400">{voiceError}</p>}
        <div className="h-full">
            <OfficeBuilding onOpenRoom={openRoom} onOpenDesk={openDesk}/>
            {desktopState&&<div className="absolute bottom-1 left-3 flex gap-3 text-[9px] text-text-secondary"><button type="button" className="underline" onClick={()=>void(desktopState.update.phase==='ready'?desktop?.installUpdate?.():desktop?.checkUpdate?.())}>Nucleas {desktopState.version} · {desktopState.update.text}</button>{desktopState.taskbar?.supported&&<button type="button" title={desktopState.taskbar.detail} className="underline" onClick={()=>void desktop?.enableTaskbar?.()}>{desktopState.taskbar.mode==='taskbar'?'Taskbar connected':desktopState.taskbar.mode==='edge'?'Quick bar · retry taskbar':'Show Nucleas taskbar'}</button>}</div>}
        </div>
    </div>;
}
