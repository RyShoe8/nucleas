'use client';
import { useSyncExternalStore } from 'react';
const subscribe=(notify:()=>void)=>{document.addEventListener('visibilitychange',notify);return()=>document.removeEventListener('visibilitychange',notify);};
/** Hidden Activity trees keep draft state, but React disconnects their effects and subscriptions. */
export function usePageVisible(){return useSyncExternalStore(subscribe,()=>!document.hidden,()=>true);}
