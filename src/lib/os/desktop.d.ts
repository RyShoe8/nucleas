export {};
declare global {
    interface Window {
        nucleasDesktop?: {
            showLauncher?: () => Promise<void>;
            openModule: (moduleId: string, payload?: Record<string, string>) => Promise<void>;
            /** The main Nucleas window asked this window to start listening. Returns a function that stops listening for it. */
            onVoiceStart?: (callback: () => void) => () => void;
            /** The Office (main window) only: start voice in Ask, read and follow the app's version and update state. */
            startVoice?: () => Promise<void>;
            desktopState?: () => Promise<{ version: string; update: { phase: string; text: string } }>;
            onDesktopState?: (callback: (state: { version: string; update: { phase: string; text: string } }) => void) => () => void;
            checkUpdate?: () => Promise<void>;
            installUpdate?: () => Promise<void>;
        };
    }
}
