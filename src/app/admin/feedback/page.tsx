'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

interface Submission {
  id: string;
  type: string;
  subject: string;
  message: string;
  name: string;
  email: string;
  userId: string | null;
  organizationId: string | null;
  source: string;
  pageUrl: string | null;
  status: string;
  createdAt: string;
}

export default function AdminFeedbackPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '200');
      const res = await fetch(`/api/admin/feedback?${params.toString()}`);
      if (res.status === 403) {
        setError('Access denied. Admin privileges required.');
        return;
      }
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setSubmissions(data.submissions || []);
      setTotal(data.total ?? 0);
    } catch {
      setError('Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: string, status: 'new' | 'done') => {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading && submissions.length === 0 && !error) {
    return (
      <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-[100px] py-8">
        <div className="max-w-7xl mx-auto text-text-secondary">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-[100px] py-8">
        <div className="max-w-7xl mx-auto">
          <Card className="p-6">
            <div className="bg-error-light border border-error/30 text-error px-4 py-3 rounded-lg">{error}</div>
            <Button onClick={() => router.push('/')} className="mt-4">
              Go back
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 lg:px-[100px] py-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-1">Feedback</h1>
            <p className="text-text-secondary">Bug reports, feature requests, and contact form submissions</p>
          </div>
          <p className="text-sm text-text-secondary">{total} total</p>
        </div>

        <Card className="p-4 mb-4 flex flex-wrap gap-3 items-center">
          <label className="text-sm text-text-secondary">
            Type{' '}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="ml-1 rounded border border-border bg-background-card text-text-primary px-2 py-1 text-sm"
            >
              <option value="">All</option>
              <option value="Bug">Bug</option>
              <option value="Feature Request">Feature request</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label className="text-sm text-text-secondary">
            Status{' '}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="ml-1 rounded border border-border bg-background-card text-text-primary px-2 py-1 text-sm"
            >
              <option value="">All</option>
              <option value="new">New</option>
              <option value="done">Done</option>
            </select>
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        </Card>

        <div className="space-y-3">
          {submissions.length === 0 ? (
            <Card className="p-8 text-center text-text-secondary">No submissions match filters.</Card>
          ) : (
            submissions.map((s) => {
              const expanded = expandedId === s.id;
              const preview = s.message.length > 120 ? `${s.message.slice(0, 120)}…` : s.message;
              return (
                <Card key={s.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary mb-1">
                        <time dateTime={s.createdAt}>{new Date(s.createdAt).toLocaleString()}</time>
                        <span className="px-2 py-0.5 rounded bg-muted text-text-primary text-xs">{s.type}</span>
                        <span className="px-2 py-0.5 rounded bg-border text-xs capitalize">{s.source}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            s.status === 'done' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <h2 className="font-semibold text-text-primary truncate">{s.subject}</h2>
                      <p className="text-sm text-text-secondary mt-1">
                        {s.name} · {s.email}
                        {s.organizationId && <span className="ml-2">· org {s.organizationId}</span>}
                      </p>
                      {s.pageUrl && (
                        <a
                          href={s.pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline break-all"
                        >
                          {s.pageUrl}
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {s.status === 'new' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={updatingId === s.id}
                          onClick={() => void setStatus(s.id, 'done')}
                        >
                          Mark done
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={updatingId === s.id}
                          onClick={() => void setStatus(s.id, 'new')}
                        >
                          Reopen
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="secondary" onClick={() => setExpandedId(expanded ? null : s.id)}>
                        {expanded ? 'Hide' : 'Message'}
                      </Button>
                    </div>
                  </div>
                  {!expanded && <p className="text-sm text-text-primary mt-2 whitespace-pre-wrap">{preview}</p>}
                  {expanded && (
                    <pre className="mt-3 p-3 rounded-lg bg-muted text-sm text-text-primary whitespace-pre-wrap font-sans border border-border">
                      {s.message}
                    </pre>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
