import { describe, it, expect } from 'vitest';
import { serviceReportSchema } from './serviceReport';
describe('service report contract', () => {
  const series = Array.from({ length: 90 }, (_, i) => ({ date: new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10), value: 0 }));
  const report = { version: 1, businessModel: 'service', customerDefinition: 'first_completed_service', timezone: 'America/Chicago', generatedAt: '2026-11-04T12:00:00.000Z', leads: series, bookings: series, customers: series, customersTotal: 0, bookingStatuses: { pending: 0, confirmed: 0, completed: 0, cancelled: 0 } };
  it('rejects payment-based customer counts, duplicate dates and invalid counts', () => {
    expect(serviceReportSchema.safeParse(report).success).toBe(true);
    expect(serviceReportSchema.safeParse({ ...report, customerDefinition: 'first_payment' }).success).toBe(false);
    expect(serviceReportSchema.safeParse({ ...report, customersTotal: -1 }).success).toBe(false);
    expect(serviceReportSchema.safeParse({ ...report, leads: Array(90).fill(series[0]) }).success).toBe(false);
  });
  it('strips unexpected personal data before persistence', () => {
    expect(serviceReportSchema.parse({ ...report, emails: ['private@example.com'] })).not.toHaveProperty('emails');
  });
});
