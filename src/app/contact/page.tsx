'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import MarketingPageHeader from '@/components/home/MarketingPageHeader';
import RecaptchaNotice from '@/components/recaptcha/RecaptchaNotice';
import { useRecaptcha } from '@/hooks/useRecaptcha';
import { RECAPTCHA_ACTIONS } from '@/lib/recaptcha/actions';

function ContactForm() {
  const searchParams = useSearchParams();
  const presetType = searchParams.get('type') || '';
  const presetSubject = searchParams.get('subject') || '';

  const [type, setType] = useState(presetType || 'Other');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState(presetSubject);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const { executeRecaptcha } = useRecaptcha();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const recaptchaToken = await executeRecaptcha(RECAPTCHA_ACTIONS.contactSubmit);
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, email, subject, message, recaptchaToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send message. Please try again.');
        return;
      }

      setSuccess(true);
      setName('');
      setEmail('');
      setSubject(presetSubject);
      setMessage('');
      setType(presetType || 'Other');
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <MarketingPageHeader
        badge="Support"
        title="Contact Us"
        subtitle="Have a question, found a bug, or want to request a feature? We'd love to hear from you."
        showCta={false}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <Card className="p-8 md:p-10 rounded-2xl">
          {success ? (
            <div className="text-center py-8">
              <div className="mb-4">
                <svg className="w-16 h-16 mx-auto text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-text-primary mb-2">Message Sent!</h2>
              <p className="text-text-secondary mb-6">
                Thank you for contacting us. We&apos;ll get back to you as soon as possible.
              </p>
              <Button onClick={() => setSuccess(false)}>Send Another Message</Button>
            </div>
          ) : (
            <>
              <h2 className="sr-only">Send us a message</h2>
              <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="bg-error-light border border-error/30 text-error px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <Select
                label="Type of Contact"
                value={type}
                onChange={(e) => setType(e.target.value)}
                required
                options={[
                  { value: 'Bug', label: 'Bug Report' },
                  { value: 'Feature Request', label: 'Feature Request' },
                  { value: 'Enterprise', label: 'Enterprise' },
                  { value: 'Other', label: 'Other' },
                ]}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label="Name" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
                <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>

              <Input
                label="Subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                placeholder="Brief description of your message"
              />

              <div>
                <label htmlFor="message" className="block text-sm font-medium text-text-primary mb-2">
                  Message
                </label>
                <textarea
                  id="message"
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg bg-background-card text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Please provide details about your bug report, feature request, or inquiry..."
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send Message'}
              </Button>
              <RecaptchaNotice className="text-xs text-text-muted text-center" />
            </form>
            </>
          )}
        </Card>

        <div className="mt-8 text-center text-text-secondary">
          <p>
            Prefer to email us directly?{' '}
            <a href="mailto:theteam@nucleas.app" className="text-primary hover:text-primary-hover transition-colors font-medium">
              theteam@nucleas.app
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ContactPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center text-text-secondary">Loading...</div>
      </div>
    }>
      <ContactForm />
    </Suspense>
  );
}
