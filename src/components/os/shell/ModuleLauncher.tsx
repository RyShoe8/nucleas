'use client';

import { useModuleRegistry } from '@/hooks/os/useModuleRegistry';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import ActionMenu from '@/components/ui/ActionMenu';
import { useOsAuth } from '@/hooks/os/useOsAuth';

export default function ModuleLauncher() {
    const modules = useModuleRegistry();
    const wm = useWindowManager();
    const auth = useOsAuth();
    const isAdmin = auth.isAdmin || auth.role === 'Administrator';
    const canSee = (permission: string) =>
        permission === 'admin' ? isAdmin : permission === 'manager' ? isAdmin || auth.isManagerOrAdmin : true;
    const visible = modules.filter((m) => !m.launcherHidden && canSee(m.permissions));

    const items =
        visible.length === 0
            ? [{ label: 'No modules registered.', disabled: true }]
            : visible.map((m) => ({
                  label: m.title,
                  icon: (
                      <span className="text-base" aria-hidden>
                          {m.icon}
                      </span>
                  ),
                  onClick: () => wm.open(m.id),
              }));

    return (
        <ActionMenu
            align="right"
            width="w-64"
            menuClassName="shadow-2xl"
            header={
                <div className="px-3 py-2 text-xs text-text-secondary uppercase tracking-wider border-b border-border">
                    Open module
                </div>
            }
            items={items}
            trigger={({ isOpen, toggle }) => (
                <button
                    type="button"
                    onClick={toggle}
                    className="px-3 h-8 rounded-md bg-background-elevated hover:bg-background-card border border-border text-sm flex items-center gap-2 text-text-primary"
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                >
                    <span aria-hidden className="text-primary">
                        ＋
                    </span>
                    <span>Modules</span>
                </button>
            )}
        />
    );
}
