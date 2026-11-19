'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import GoogleSignInButton from '@/components/ui/GoogleSignInButton';
import RecaptchaNotice from '@/components/recaptcha/RecaptchaNotice';
import { useRecaptcha } from '@/hooks/useRecaptcha';
import { RECAPTCHA_ACTIONS } from '@/lib/recaptcha/actions';
import { persistSelectedPlanId } from '@/lib/billing/selectedPlanStorage';
import {
  getPasswordRuleStatus,
  PASSWORD_REQUIREMENTS_MESSAGE,
  validatePasswordStrength,
} from '@/lib/auth/passwordPolicy';

interface InvitationData {
  email: string;
  role: string;
  invitedBy: {
    name?: string;
    email: string;
  };
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitationToken = searchParams.get('token');
  const planId = searchParams.get('plan');
  const billingInterval = searchParams.get('interval') === 'year' ? 'year' : 'month';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingInvitation, setLoadingInvitation] = useState(false);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const { executeRecaptcha, isEnabled: recaptchaEnabled, ready: recaptchaReady, loadError: recaptchaLoadError } = useRecaptcha();

  // Load invitation details if token is present
  useEffect(() => {
    if (planId) {
      persistSelectedPlanId(planId, billingInterval);
    }
  }, [planId, billingInterval]);

  useEffect(() => {
    if (invitationToken) {
      setLoadingInvitation(true);
      fetch(`/api/invitations/${invitationToken}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.error) {
            setError(data.error);
          } else {
            setInvitation({
              email: data.email,
              role: data.role,
              invitedBy: data.invitedBy,
            });
            setEmail(data.email); // Pre-fill email
          }
        })
        .catch(() => {
          // Error loading invitation
          setError('Failed to load invitation details');
        })
        .finally(() => {
          setLoadingInvitation(false);
        });
    }
  }, [invitationToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);

    try {
      const recaptchaToken = await executeRecaptcha(RECAPTCHA_ACTIONS.register);
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          invitationToken: invitationToken || undefined,
          recaptchaToken,
        }),
      });

      let data: {
        error?: string;
        needsEmailVerification?: boolean;
        user?: { organizationSetupComplete?: boolean };
      } = {};
      try {
        data = await response.json();
      } catch {
        setError('Registration failed. Please try again.');
        return;
      }

      if (!response.ok) {
        setError(data.error || 'Registration failed');
        return;
      }

      if (data.needsEmailVerification) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }

      // Check if user needs to set up organization
      const userData = data.user;
      if (!userData?.organizationSetupComplete) {
        router.push('/setup-organization');
      } else {
        router.push('/');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const passwordRules = getPasswordRuleStatus(password);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-text-primary">
            {invitation ? 'Accept Invitation' : 'Create your account'}
          </h2>
          {!invitation && (
            <p className="mt-3 text-center text-sm text-text-secondary">
              New registrations require approval from a Nucleas platform administrator before sign-in.
            </p>
          )}
          {invitation && (
            <div className="mt-4 bg-primary-light border border-primary/20 rounded-lg p-4">
              <p className="text-sm text-primary-dark">
                <strong>{invitation.invitedBy.name || invitation.invitedBy.email}</strong> has invited you to join as a{' '}
                <strong>{invitation.role}</strong>.
              </p>
            </div>
          )}
        </div>
        {loadingInvitation ? (
          <div className="text-center py-8 text-text-secondary">Loading invitation...</div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-error-light border border-error/30 text-error px-4 py-3 rounded-lg">
              {error}
            </div>
          )}
          {recaptchaLoadError && !error && (
            <div className="bg-error-light border border-error/30 text-error px-4 py-3 rounded-lg">
              {recaptchaLoadError}
            </div>
          )}
          <div className="space-y-4">
            <Input
              label="Name (optional)"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={!!invitation} // Disable email if from invitation
            />
            <div>
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <p className="mt-1.5 text-xs text-text-muted">{PASSWORD_REQUIREMENTS_MESSAGE}</p>
              {password.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-text-muted">
                  <li className={passwordRules.minLength ? 'text-success' : undefined}>
                    {passwordRules.minLength ? '✓' : '○'} 8–128 characters
                  </li>
                  <li className={passwordRules.hasDigit ? 'text-success' : undefined}>
                    {passwordRules.hasDigit ? '✓' : '○'} Includes a number
                  </li>
                  <li className={passwordRules.hasSpecial ? 'text-success' : undefined}>
                    {passwordRules.hasSpecial ? '✓' : '○'} Includes a special character
                  </li>
                </ul>
              )}
            </div>
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || Boolean(recaptchaLoadError) || (recaptchaEnabled && !recaptchaReady)}
            >
              {loading
                ? 'Creating account...'
                : recaptchaLoadError
                  ? 'Security check unavailable'
                  : recaptchaEnabled && !recaptchaReady
                    ? 'Loading security check…'
                    : 'Create account'}
            </Button>
            <RecaptchaNotice className="text-xs text-text-muted text-center" />
          </div>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-background text-text-secondary">Or continue with</span>
            </div>
          </div>

          <GoogleSignInButton invitationToken={invitationToken} />

          <div className="text-center">
            <Link
              href="/login"
              className="text-sm text-primary hover:text-primary-hover transition-colors"
            >
              Already have an account? Sign in
            </Link>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center text-text-secondary">Loading...</div>
      </div>
    }>
      <RegisterForm />
    </Suspense>
  );
}
