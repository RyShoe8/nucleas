'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import OrganizationModal from '@/components/OrganizationModal';
import { peekSelectedPlanId } from '@/lib/billing/selectedPlanStorage';

export default function SetupOrganizationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isSetup, setIsSetup] = useState(false);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const data = await response.json();
          if (data && data.organizationSetupComplete) {
            setIsSetup(true);
            router.push('/');
          } else if (data) {
            setLoading(false);
          } else {
            // No user data, redirect to login
            router.push('/login');
          }
        } else {
          router.push('/login');
        }
      } catch {
        // Error checking setup
        router.push('/login');
      }
    };
    checkSetup();
  }, [router]);

  const handleComplete = () => {
    setIsSetup(true);
    const planId = peekSelectedPlanId();
    if (planId) {
      router.push(`/billing?plan=${encodeURIComponent(planId)}`);
      return;
    }
    router.push('/');
  };

  if (loading || isSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-text-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-text-primary mb-2">Set up your workspace</h1>
          <p className="text-text-secondary">
            Give your workspace a name to get started. You can update these settings later.
          </p>
        </div>
        <div className="bg-background-card rounded-lg shadow-lg border border-border p-6">
          <h2 className="text-2xl font-bold text-text-primary mb-4">Workspace settings</h2>
          <OrganizationModal onUpdate={handleComplete} onClose={() => router.push('/login')} isSetup />
        </div>
      </div>
    </div>
  );
}
