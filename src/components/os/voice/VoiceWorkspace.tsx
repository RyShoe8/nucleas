'use client';
import { createContext, useContext, useLayoutEffect } from 'react';
import type { OsVoiceScope } from '@/lib/voice/osVoiceIntent';

export const VoiceWorkspaceContext = createContext<(scope: OsVoiceScope, priority: number) => () => void>(() => () => {});
/** Activity-hidden editors unregister so the microphone follows the visible work. */
export function useVoiceWorkspace(scope: OsVoiceScope, priority = 10, enabled = true) {
    const register = useContext(VoiceWorkspaceContext);
    const { moduleId, companyId, companyName, section } = scope;
    useLayoutEffect(() => enabled ? register({ moduleId, companyId, companyName, section }, priority) : undefined, [register, priority, enabled, moduleId, companyId, companyName, section]);
}
