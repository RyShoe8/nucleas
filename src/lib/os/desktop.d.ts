export {};
declare global {
    interface Window {
        nucleasDesktop?: {
            showLauncher?: () => Promise<void>;
            openModule: (moduleId: string, payload?: Record<string, string>) => Promise<void>;
            /** The main Nucleas window asked this window to start listening. Returns a function that stops listening for it. */
            onVoiceStart?: (callback: () => void) => () => void;
        };
    }
}
