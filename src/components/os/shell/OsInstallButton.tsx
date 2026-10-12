'use client';

import { useOsInstall } from './OsInstallProvider';

export default function OsInstallButton() {
    const {
        isInstalled,
        showInstallButton,
        showOpenDesktopButton,
        openInstallModal,
        openDesktopAppModal,
    } = useOsInstall();

    if (isInstalled) return null;

    if (showOpenDesktopButton) {
        return (
            <button
                type="button"
                onClick={() => openDesktopAppModal()}
                title="Nucleas OS is installed — open from your taskbar or Start menu."
                className="text-xs px-2.5 py-2.5 sm:py-1 rounded border border-border text-text-secondary hover:bg-background-elevated hover:text-text-primary transition-colors"
            >
                Open desktop app
            </button>
        );
    }

    if (!showInstallButton) return null;

    return (
        <button
            type="button"
            onClick={() => openInstallModal()}
            title="Install for chromeless pop-out windows on Windows."
            className="text-xs px-2.5 py-2.5 sm:py-1 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
        >
            Install app
        </button>
    );
}
