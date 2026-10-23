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

const errorMessages: Record<string, string> = {
  oauth_not_configured: 'Google OAuth is not configured. Please contact support or use email/password to sign in.',
  oauth_error: 'An error occurred during Google sign-in. Please try again.',
  token_exchange_failed: 'Failed to authenticate with Google. Please try again.',
  failed_to_get_user_info: 'Failed to retrieve user information from Google. Please try again.',
  no_email: 'No email address found in your Google account.',
  email_mismatch: 'The email address associated with your Google account does not match the invitation.',
  no_code: 'No authorization code received from Google.',
  registration_rejected: 'This registration was not approved. Contact Nucleas support if you believe this is an error.',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { executeRecaptcha, isEnabled: recaptchaEnabled, ready: recaptchaReady, loadError: recaptchaLoadError } = useRecaptcha();

  // Check for error in URL params
  useEffect(() => {
    const urlError = searchParams.get('error');
    if (urlError) {
      setError(errorMessages[urlError] || 'An error occurred. Please try again.');
      // Clear the error from URL
      router.replace('/login', { scroll: false });
    }
  }, [searchParams, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const recaptchaToken = await executeRecaptcha(RECAPTCHA_ACTIONS.login);
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, recaptchaToken }),
      });

      let data: { error?: string; needsEmailVerification?: boolean; awaitingApproval?: boolean; user?: { organizationSetupComplete?: boolean } } = {};
      try {
        data = await response.json();
      } catch {
        setError('Login failed. Please try again.');
        return;
      }

      if (!response.ok) {
        if (data.awaitingApproval) {
          router.push('/pending-approval');
          return;
        }
        if (data.needsEmailVerification) {
          router.push(`/verify-email?email=${encodeURIComponent(email)}`);
          return;
        }
        setError(data.error || 'Login failed');
        return;
      }

      // Check if user needs to set up organization
      if (data.user && !data.user.organizationSetupComplete) {
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-text-primary">
            Sign in to Nucleas
          </h2>
        </div>
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
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || Boolean(recaptchaLoadError) || (recaptchaEnabled && !recaptchaReady)}
            >
              {loading
                ? 'Signing in...'
                : recaptchaLoadError
                  ? 'Security check unavailable'
                  : recaptchaEnabled && !recaptchaReady
                    ? 'Loading security check…'
                    : 'Sign in'}
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

          <GoogleSignInButton />

          <div className="text-center">
            <Link
              href="/register"
              className="text-sm text-primary hover:text-primary-hover transition-colors"
            >
              Don&apos;t have an account? Register
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center text-text-secondary">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
