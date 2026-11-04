'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function OrganizationSetupCheck({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    const checkSetup = async () => {
      // Skip check for auth pages, setup page, admin/billing, and public pages
      if (
        pathname === '/' ||
        pathname === '/desktop/connect' ||
        pathname?.startsWith('/login') ||
        pathname?.startsWith('/register') ||
        pathname === '/setup-organization' ||
        pathname?.startsWith('/admin') ||
        pathname?.startsWith('/billing') ||
        pathname === '/about' ||
        pathname === '/contact' ||
        pathname === '/terms' ||
        pathname === '/privacy' ||
        pathname === '/pricing' ||
        pathname === '/book-call' ||
        pathname === '/features' ||
        pathname?.startsWith('/features/') ||
        pathname?.startsWith('/blog') ||
        pathname?.startsWith('/recording/controls')
      ) {
        setChecking(false);
        setNeedsSetup(false);
        return;
      }

      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          if (data && !data.organizationSetupComplete) {
            setNeedsSetup(true);
          } else {
            setNeedsSetup(false);
          }
        }
      } catch {
        // Error checking organization setup
      } finally {
        setChecking(false);
      }
    };

    setChecking(true);
    checkSetup();
  }, [pathname]);

  useEffect(() => {
    if (!checking && needsSetup) {
      router.push('/setup-organization');
    }
  }, [checking, needsSetup, router]);

  if (checking || needsSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-text-secondary">Loading...</div>
      </div>
    );
  }

  return <>{children}</>;
}
