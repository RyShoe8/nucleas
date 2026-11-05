export {};
declare global {
    interface Window {
        nucleasDesktop?: { showLauncher?: () => Promise<void>; openModule: (moduleId: string, payload?: Record<string, string>) => Promise<void> };
    }
}
