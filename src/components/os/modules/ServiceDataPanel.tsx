'use client';
import { useEffect, useState } from 'react';
import type { ServiceReport } from '@/lib/companies/serviceReport';
import { useOsAuth } from '@/hooks/os/useOsAuth';

export default function ServiceDataPanel({ companyId, setup = false, onEnabled }: { companyId: string; setup?: boolean; onEnabled?: (enabled: boolean) => void }) {
  const auth = useOsAuth();
  const [report, setReport] = useState<ServiceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setReport(null); onEnabled?.(false);
    fetch(`/api/os/companies/${companyId}/service-data`, { signal: controller.signal }).then(r => r.json()).then(body => {
      if (!controller.signal.aborted) { setReport(body.report ?? null); onEnabled?.(Boolean(body.report)); }
    }).catch(() => {});
    return () => controller.abort();
  }, [companyId, onEnabled]);
  async function refresh() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/os/companies/${companyId}/service-data`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setReport(body.report); onEnabled?.(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Sync failed.'); }
    finally { setBusy(false); }
  }
  if (!setup && !report) return null;
  const sum = (rows: ServiceReport['leads']) => rows.slice(-8, -1).reduce((total, row) => total + row.value, 0);
  return <section className="rounded-xl border border-border p-3 space-y-2">
    <div className="flex items-center justify-between"><h3 className="font-medium">Service business</h3>
      {auth.isManagerOrAdmin && <button disabled={busy} onClick={refresh} className="text-sm px-3 py-1 rounded border border-border disabled:opacity-50">{busy ? 'Loading…' : report ? 'Refresh service data' : 'Connect service data'}</button>}
    </div>
    {report ? <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[['New leads', sum(report.leads)], ['Bookings created', sum(report.bookings)], ['New customers', sum(report.customers)], ['Customers total', report.customersTotal]].map(([label, value]) => <div key={label}><p className="text-xs text-text-secondary">{label}</p><strong className="text-xl">{Number(value).toLocaleString()}</strong></div>)}</div>
      <p className="text-xs text-text-secondary">Last 7 completed days ({report.timezone}); customers total is all time. A customer has completed their first service. Cancelled bookings are excluded.</p>
      <p className="text-xs text-text-secondary">Bookings: {report.bookingStatuses.pending} pending · {report.bookingStatuses.confirmed} confirmed · {report.bookingStatuses.completed} completed · {report.bookingStatuses.cancelled} cancelled</p>
      <p className="text-xs text-text-secondary">Updated {new Date(report.generatedAt).toLocaleString()}. Refresh to pull current admin data.</p>
    </> : <p className="text-sm text-text-secondary">Pull leads, bookings and customers from the connected admin account. The site must support Nucleas service reporting. Customers count after their first completed service.</p>}
    {error && <p className="text-sm text-amber-400">{error}</p>}
  </section>;
}
