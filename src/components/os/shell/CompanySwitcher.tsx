'use client';

import ActionMenu from '@/components/ui/ActionMenu';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useOsCompanies } from '../modules/CompaniesModule';

/** Top-bar company picker. Opens (or focuses) the Company window for the chosen company. */
export default function CompanySwitcher() {
    const wm = useWindowManager();
    const { companies } = useOsCompanies();
    const active = wm.windows.find((w) => w.moduleId === 'company' && w.id === wm.activeWindowId);
    const label = active?.payload?.companyName ?? 'All companies';

    const items =
        companies === null
            ? [{ label: 'Loading…', disabled: true }]
            : [
                  { label: 'Today (all businesses)', onClick: () => wm.open('today') },
                  { label: 'All companies', onClick: () => wm.open('companies') },
                  ...companies.map((c) => ({
                      label: c.name,
                      icon: (
                          <span
                              aria-hidden
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: c.color ?? '#64748b' }}
                          />
                      ),
                      onClick: () => wm.open('company', { payload: { companyId: c.id, companyName: c.name } }),
                  })),
              ];

    return (
        <ActionMenu
            align="left"
            width="w-64"
            menuClassName="shadow-2xl max-h-[70vh] overflow-y-auto"
            items={items}
            trigger={({ isOpen, toggle }) => (
                <button
                    type="button"
                    onClick={toggle}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    className="h-8 px-2 rounded-md hover:bg-background-card border border-transparent hover:border-border text-xs text-text-secondary flex items-center gap-1 max-w-[220px]"
                >
                    <span className="truncate">{label}</span>
                    <span aria-hidden>▾</span>
                </button>
            )}
        />
    );
}
