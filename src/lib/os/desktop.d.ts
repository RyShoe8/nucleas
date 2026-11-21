export {};
declare global {
    interface Window {
        nucleasDesktop?: {
            showLauncher?: () => Promise<void>;
            captureState?: (active: boolean) => Promise<void>;
            openModule: (moduleId: string, payload?: Record<string, string>) => Promise<void>;
            /** The main Nucleas window asked this window to start listening. Returns a function that stops listening for it. */
            onVoiceStart?: (callback: () => void) => () => void;
            /** Only the main Ask window may read/accept taskbar questions, after sign-in and history load. */
            pendingTaskbarAsk?: () => Promise<{ id: string; text: string } | null>;
            acceptTaskbarAsk?: (id: string) => Promise<boolean>;
            onTaskbarAsk?: (callback: () => void) => () => void;
            /** The Office (main window) only: start voice in Ask, read and follow the app's version and update state. */
            startVoice?: () => Promise<void>;
            desktopState?: () => Promise<{ version: string; update: { phase: string; text: string }; taskbar?:{enabled:boolean;supported:boolean;mode:string;detail:string} }>;
            onDesktopState?: (callback: (state: { version: string; update: { phase: string; text: string }; taskbar?:{enabled:boolean;supported:boolean;mode:string;detail:string} }) => void) => () => void;
            enableTaskbar?:()=>Promise<void>;
            checkUpdate?: () => Promise<void>;
            installUpdate?: () => Promise<void>;
        };
    }
}
