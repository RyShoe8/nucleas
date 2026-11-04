'use client';

import {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { usePwaInstall } from '@/hooks/os/usePwaInstall';
import {
    clearInstallReminders,
    isInstallDismissed,
    isRunningAsInstalledPwa,
    markInstallDismissed,
    markInstallEngaged,
    markPwaInstalled,
} from '@/lib/os/pwaInstall';
import OsInstallModal from './OsInstallModal';

interface OsInstallContextValue {
    openInstallModal: (onClose?: () => void) => void | Promise<void>;
    openDesktopAppModal: (onClose?: () => void) => void | Promise<void>;
    isInstalled: boolean;
    showInstallButton: boolean;
    showOpenDesktopButton: boolean;
}

const OsInstallContext = createContext<OsInstallContextValue | null>(null);

export function useOsInstall(): OsInstallContextValue {
    const ctx = useContext(OsInstallContext);
    if (!ctx) {
        throw new Error('useOsInstall must be used within OsInstallProvider');
    }
    return ctx;
}

export function OsInstallProvider({ children }: { children: ReactNode }) {
    const {
        isOsHost,
        isRunningAsPwa,
        installedRelatedApp,
        isRunningInBrowserTab: inBrowserTab,
        installCheckPending,
        canPrompt,
        promptInstall,
        refreshInstalled,
        swStatus,
        swErrorMessage,
        swControlled,
        manifestOk,
        manifestLinkHref,
        manifestOriginMismatch,
        installabilityHint,
    } = usePwaInstall();
    const [modalOpen, setModalOpen] = useState(false);
    const [modalAlreadyInstalled, setModalAlreadyInstalled] = useState(false);
    const onCloseRef = useRef<(() => void) | null>(null);

    const closeModal = useCallback(() => {
        setModalOpen(false);
        setModalAlreadyInstalled(false);
        const cb = onCloseRef.current;
        onCloseRef.current = null;
        cb?.();
    }, []);

    const openInstallModal = useCallback(
        async (onClose?: () => void) => {
            if (isRunningAsInstalledPwa()) {
                onClose?.();
                return;
            }
            const related = await refreshInstalled();
            onCloseRef.current = onClose ?? null;
            setModalAlreadyInstalled(related);
            setModalOpen(true);
        },
        [refreshInstalled]
    );

    const openDesktopAppModal = useCallback(
        async (onClose?: () => void) => {
            await refreshInstalled();
            if (isRunningAsInstalledPwa()) {
                onClose?.();
                return;
            }
            onCloseRef.current = onClose ?? null;
            setModalAlreadyInstalled(true);
            setModalOpen(true);
        },
        [refreshInstalled]
    );

    const handleInstall = useCallback(async (): Promise<boolean> => {
        markInstallEngaged();
        if (!canPrompt) return false;
        return promptInstall();
    }, [canPrompt, promptInstall]);

    const handleDismiss = useCallback(() => {
        markInstallEngaged();
        markInstallDismissed();
    }, []);

    const handleConfirmMenuInstall = useCallback(() => {
        const confirmed = window.confirm(
            'Only continue if you installed Nucleas OS from your browser menu (⋮ → Install Nucleas OS) and can open it from Start or the taskbar.\n\nThis does not install the app by itself.'
        );
        if (!confirmed) return;
        markPwaInstalled();
        markInstallEngaged();
        void refreshInstalled();
        closeModal();
    }, [closeModal, refreshInstalled]);

    const handleResetReminders = useCallback(() => {
        clearInstallReminders();
    }, []);

    const showInstallButton =
        isOsHost && !isRunningAsPwa && inBrowserTab && !installCheckPending && !installedRelatedApp;
    const showOpenDesktopButton =
        isOsHost && !isRunningAsPwa && inBrowserTab && !installCheckPending && installedRelatedApp;

    const showMenuInstallConfirm =
        inBrowserTab && !modalAlreadyInstalled && !installedRelatedApp && !canPrompt;

    return (
        <OsInstallContext.Provider
            value={{
                openInstallModal,
                openDesktopAppModal,
                isInstalled: isRunningAsPwa,
                showInstallButton,
                showOpenDesktopButton,
            }}
        >
            {children}
            <OsInstallModal
                isOpen={modalOpen}
                onClose={closeModal}
                canPrompt={canPrompt}
                isAlreadyInstalled={modalAlreadyInstalled || isRunningAsPwa}
                showMenuInstallConfirm={showMenuInstallConfirm}
                swStatus={swStatus}
                swErrorMessage={swErrorMessage}
                swControlled={swControlled}
                manifestOk={manifestOk}
                manifestLinkHref={manifestLinkHref}
                manifestOriginMismatch={manifestOriginMismatch}
                installDismissed={isInstallDismissed()}
                installabilityHint={installabilityHint}
                onInstall={handleInstall}
                onDismiss={handleDismiss}
                onConfirmMenuInstall={handleConfirmMenuInstall}
                onResetReminders={handleResetReminders}
            />
        </OsInstallContext.Provider>
    );
}
