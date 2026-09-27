import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import { IntegrationConnection, IntegrationSecret } from '@/lib/models/Integration';
import { BusinessEvent } from '@/lib/models/BusinessEvent';
import { openSecret, sealSecret, secretHint } from '@/lib/security/secretBox';
import { getCompanyProfile, isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';

/**
 * Signed first-party events from a company's own platform ("Signup events" integration).
 *
 * Request: POST /api/webhooks/company-events/<connectionId>
 *   X-Nucleas-Timestamp: <unix seconds>
 *   X-Nucleas-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 *   { "type": "user.signed_up", "userId": "<your internal id>", "occurredAt": "<ISO, optional>" }
 */

export const EVENTS_PROVIDER = 'signups';
export const SUPPORTED_EVENT_TYPES = ['user.signed_up'] as const;
const MAX_SKEW_SECONDS = 300;

const eventSchema = z
  .object({
    type: z.enum(SUPPORTED_EVENT_TYPES),
    userId: z.string().min(1).max(200),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

function subjectHash(companyId: Types.ObjectId, userId: string): string {
  return createHash('sha256').update(`${companyId}:${userId}`).digest('hex');
}

export type SetupResult = { ok: true; url: string; secret: string } | { ok: false; status: 400 | 403 | 404; error: string };

/** Generates (or rotates) the signing secret. The secret is returned once and stored encrypted. */
export async function setUpCompanyEvents(viewer: CompanyViewer, connectionId: string, baseUrl: string): Promise<SetupResult> {
  if (!isCompanyManager(viewer)) return { ok: false, status: 403, error: 'Only managers can set this up.' };
  if (!Types.ObjectId.isValid(connectionId)) return { ok: false, status: 404, error: 'Integration not found.' };
  const connection = await IntegrationConnection.findOne({ _id: connectionId, organizationId: viewer.organizationId, provider: EVENTS_PROVIDER })
    .select('companyId secretId')
    .lean<{ _id: Types.ObjectId; companyId?: Types.ObjectId; secretId?: Types.ObjectId }>();
  if (!connection?.companyId || !(await getCompanyProfile(viewer, String(connection.companyId)))) {
    return { ok: false, status: 404, error: 'Integration not found.' };
  }

  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  const sealed = sealSecret(`integration:${EVENTS_PROVIDER}`, secret);
  let secretId = connection.secretId;
  if (secretId) {
    await IntegrationSecret.updateOne({ _id: secretId, organizationId: viewer.organizationId }, { $set: { sealed, hint: secretHint(secret), rotatedAt: new Date() } });
  } else {
    secretId = (await IntegrationSecret.create({ organizationId: viewer.organizationId, provider: EVENTS_PROVIDER, sealed, hint: secretHint(secret), createdByUserId: new Types.ObjectId(viewer.userId) }))._id;
  }
  await IntegrationConnection.updateOne(
    { _id: connection._id },
    {
      $set: { status: 'connected', secretId, credentialHint: secretHint(secret), accountLabel: 'Webhook', connectedByUserId: new Types.ObjectId(viewer.userId), lastVerifiedAt: new Date() },
      $unset: { lastError: '' },
      $inc: { revision: 1 },
    }
  );
  return { ok: true, url: `${baseUrl.replace(/\/$/, '')}/api/webhooks/company-events/${connection._id}`, secret };
}

export type ReceiveResult = { status: 200 | 202 | 400 | 401 | 404; body: Record<string, unknown> };

/** Verifies and records one event. Duplicate deliveries of the same subject/type are accepted and ignored. */
export async function receiveCompanyEvent(
  connectionId: string,
  headers: { timestamp: string | null; signature: string | null },
  rawBody: string,
  now = new Date()
): Promise<ReceiveResult> {
  if (!Types.ObjectId.isValid(connectionId)) return { status: 404, body: { error: 'Unknown endpoint' } };
  const connection = await IntegrationConnection.findOne({ _id: connectionId, provider: EVENTS_PROVIDER, status: 'connected' })
    .select('organizationId companyId secretId')
    .lean<{ organizationId: Types.ObjectId; companyId?: Types.ObjectId; secretId?: Types.ObjectId }>();
  if (!connection?.companyId || !connection.secretId) return { status: 404, body: { error: 'Unknown endpoint' } };

  const ts = Number(headers.timestamp);
  if (!headers.timestamp || !Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { status: 401, body: { error: 'Missing or stale timestamp' } };
  }
  const secretDoc = await IntegrationSecret.findOne({ _id: connection.secretId }).select('+sealed').lean<{ sealed: string }>();
  if (!secretDoc) return { status: 404, body: { error: 'Unknown endpoint' } };
  const expected = Buffer.from(signPayload(openSecret(`integration:${EVENTS_PROVIDER}`, secretDoc.sealed), headers.timestamp, rawBody));
  const actual = Buffer.from(headers.signature ?? '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { status: 401, body: { error: 'Invalid signature' } };

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Body must be JSON' } };
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues.map((i) => i.message).join('; ') } };

  const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : now;
  try {
    await BusinessEvent.create({
      organizationId: connection.organizationId,
      companyId: connection.companyId,
      source: EVENTS_PROVIDER,
      type: parsed.data.type,
      subjectHash: subjectHash(connection.companyId, parsed.data.userId),
      occurredAt,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return { status: 200, body: { ok: true, duplicate: true } };
    throw err;
  }
  return { status: 202, body: { ok: true } };
}

/** Daily counts of an event type over the given dates (UTC). */
export async function dailyEventCounts(companyId: Types.ObjectId, type: string, dates: string[]): Promise<{ date: string; value: number }[]> {
  if (dates.length === 0) return [];
  const rows = await BusinessEvent.aggregate<{ _id: string; n: number }>([
    {
      $match: {
        companyId,
        type,
        occurredAt: { $gte: new Date(`${dates[0]}T00:00:00Z`), $lt: new Date(new Date(`${dates.at(-1)}T00:00:00Z`).getTime() + 86_400_000) },
      },
    },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } }, n: { $sum: 1 } } },
  ]);
  const byDate = new Map(rows.map((r) => [r._id, r.n]));
  return dates.map((date) => ({ date, value: byDate.get(date) ?? 0 }));
}
