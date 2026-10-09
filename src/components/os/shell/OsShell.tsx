'use client';

import { type ReactNode } from 'react';
import TopBar from './TopBar';
import WindowsTray from './WindowsTray';
import ModuleCanvas from './ModuleCanvas';
import IntegrationNotice from './IntegrationNotice';

interface OsShellProps {
    children?: ReactNode;
}

export default function OsShell({ children }: OsShellProps) {
    return (
        <div className="fixed inset-0 flex flex-col bg-background text-text-primary overflow-hidden">
            <TopBar />
            {/* Keep window focus ordering inside the desktop, below shell navigation. */}
            <div className="relative z-0 isolate flex-1 min-h-0">
                <ModuleCanvas />
                <IntegrationNotice />
                {children ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="pointer-events-auto">{children}</div>
                    </div>
                ) : null}
            </div>
            <WindowsTray />
        </div>
    );
}
