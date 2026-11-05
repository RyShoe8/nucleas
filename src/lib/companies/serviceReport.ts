import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const series = z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: count })).length(90)
  .refine(rows => rows.every((row, i) => !i || row.date > rows[i - 1].date), 'Dates must be unique and ordered');
export const serviceReportSchema = z.object({
  version: z.literal(1), businessModel: z.literal('service'), customerDefinition: z.literal('first_completed_service'),
  timezone: z.string().min(1).max(80), generatedAt: z.string().datetime(),
  leads: series, bookings: series, customers: series, customersTotal: count,
  bookingStatuses: z.object({ pending: count, confirmed: count, completed: count, cancelled: count }),
});
export type ServiceReport = z.infer<typeof serviceReportSchema>;
