export {};
declare global {
    interface Window {
        nucleasDesktop?: { openModule: (moduleId: string, payload?: Record<string, string>) => Promise<void> };
    }
}
