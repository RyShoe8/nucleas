'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import Dropdown from '@/components/ui/Dropdown';
import Modal from '@/components/ui/Modal';
import ProfileModal from '@/components/ProfileModal';
import OrganizationModal from '@/components/OrganizationModal';
import { useOsAuth } from '@/hooks/os/useOsAuth';

export default function OsAccountMenu() {
    const { refetch, ...auth } = useOsAuth();
    const wm = useWindowManager();
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showOrganizationModal, setShowOrganizationModal] = useState(false);

    const refreshUser = useCallback(() => {
        refetch();
    }, [refetch]);

    const handleLogout = useCallback(async () => {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                signal: AbortSignal.timeout(8000),
            });
        } catch {
            // still leave even if logout request fails/times out
        }
        window.location.assign('/login');
    }, []);

    const handleAdmin = useCallback(() => {
        wm.open('ai-budgets');
    }, [wm]);

    const initials = auth.name
        ? auth.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)
        : auth.email?.[0]?.toUpperCase() ?? 'U';

    const dropdownItems = [
        {
            label: 'Profile',
            onClick: () => setShowProfileModal(true),
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                </svg>
            ),
        },
        {
            label: 'Workspace settings',
            onClick: () => setShowOrganizationModal(true),
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                </svg>
            ),
        },
        ...(auth.isAdmin
            ? [
                  {
                      label: 'AI budgets',
                      onClick: handleAdmin,
                      icon: (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                              <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                              />
                              <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                          </svg>
                      ),
                  },
              ]
            : []),
        {
            label: 'Logout',
            onClick: handleLogout,
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                </svg>
            ),
        },
    ];

    const trigger = (
        <span className="flex min-h-10 min-w-10 items-center justify-center gap-2 px-1.5 py-1 sm:min-h-0 sm:min-w-0 rounded-md hover:bg-background-elevated border border-transparent hover:border-border">
            {auth.profilePicture ? (
                <Image
                    src={auth.profilePicture}
                    alt=""
                    width={28}
                    height={28}
                    className="w-7 h-7 rounded-full object-cover"
                    unoptimized
                />
            ) : (
                <span className="w-7 h-7 rounded-full bg-primary text-nucleas-ink flex items-center justify-center text-xs font-medium">
                    {initials}
                </span>
            )}
            <span className="hidden sm:inline text-xs text-text-secondary max-w-[120px] truncate">
                {auth.name ?? auth.email ?? 'Account'}
            </span>
        </span>
    );

    if (auth.loading) {
        return (
            <span className="w-7 h-7 rounded-full bg-background-elevated animate-pulse" aria-hidden />
        );
    }

    return (
        <>
            <Dropdown trigger={trigger} items={dropdownItems} align="right" />

            {showProfileModal && (
                <Modal
                    isOpen
                    onClose={() => setShowProfileModal(false)}
                    title="Profile"
                    maxWidth="md"
                    stackAboveOverlays
                >
                    <ProfileModal
                        onUpdate={refreshUser}
                        onClose={() => setShowProfileModal(false)}
                    />
                </Modal>
            )}

            {showOrganizationModal && (
                <Modal
                    isOpen
                    onClose={() => setShowOrganizationModal(false)}
                    title="Workspace settings"
                    maxWidth="md"
                    stackAboveOverlays
                >
                    <OrganizationModal
                        onUpdate={refreshUser}
                        onClose={() => setShowOrganizationModal(false)}
                    />
                </Modal>
            )}
        </>
    );
}
