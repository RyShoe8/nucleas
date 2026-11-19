import type { z } from 'zod';
import type { Types } from 'mongoose';

/**
 * Capability contracts. The AI and UI ask for capabilities (`analytics.traffic.read`), never
 * provider endpoints; each capability binds to a provider adapter that is plain deterministic code.
 */

export type CapabilityRisk =
  | 'read'
  | 'low_write'
  | 'reversible_write'
  | 'communication'
  | 'spend'
  | 'production'
  | 'destructive'
  | 'security';

export type ApprovalPolicy = 'auto' | 'required';

export type InvocationStatus =
  | 'pending_approval'
  | 'running'
  | 'succeeded'
  | 'verified'
  | 'uncertain'
  | 'failed'
  | 'needs_setup'
  | 'plan_limited'
  | 'needs_reauth'
  | 'denied'
  | 'cancelled';

/** Terminal outcomes an adapter may signal instead of a result. */
export class CapabilityError extends Error {
  constructor(
    readonly code: 'uncertain' | 'needs_setup' | 'plan_limited' | 'needs_reauth' | 'failed',
    message: string
  ) {
    super(message);
    this.name = 'CapabilityError';
  }
}

export interface ProviderAccess {
  provider: string;
  connectionId: Types.ObjectId;
  /** Decrypted credential. Adapter-only; never logged, returned or put in model context. */
  credential: string;
  configuration?: unknown;
  /** The company's pinned resource (GA4 property, GSC site, ...), when the capability needs one. */
  resource?: { externalId: string; label?: string; resourceType?: string };
  /** The company websites this connection is assigned to (Setup), canonical hosts; empty when none are chosen. */
  sites?: string[];
}

export interface CapabilityRunContext {
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  companyDomain?: string;
  /** All of the company's websites (canonical hosts, main one first). */
  companyWebsites?: string[];
  access: ProviderAccess;
  /** Clock for date windows, shared with callers (e.g. the metric sync) so both agree on 'yesterday'. */
  now: Date;
  idempotencyKey?: string;
  invocationId?: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Units consumed at the provider (e.g. Ahrefs API units), reported by the adapter. */
  reportUnits: (units: number) => void;
}

export interface CapabilityResult<O> {
  output: O;
  /** Provider resource created/affected, recorded on the receipt and as an ExternalResource for writes. */
  resource?: { resourceType: string; externalId: string; label?: string; externalUrl?: string };
  /** Short human-readable description of what happened. */
  summary: string;
}

export interface CapabilityDefinition<I = unknown, O = unknown> {
  id: string;
  version: number;
  title: string;
  domain: string;
  kind: 'read' | 'write';
  risk: CapabilityRisk;
  approval: ApprovalPolicy;
  provider: string;
  /** Output contains sensitive data (bank balances, recordings); AI access is governed by data-sharing policy. */
  sensitive?: boolean;
  /** Resource type that must be pinned for the company (ExternalResource.resourceType). */
  /** Accepted kinds in order of preference (a newer kind first, an older one still honoured). */
  requiresResource?: string | string[];
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  /**
   * Extra arguments the AI may pass besides the company (JSON Schema properties). Every value is still checked by
   * `input`; without this, AI callers can only pass `days`.
   */
  toolParameters?: Record<string, { type: 'string' | 'integer' | 'number' | 'boolean'; description: string; enum?: string[]; required?: boolean }>;
  /** What the tool is for, shown to the AI instead of the generic description. */
  toolDescription?: string;
  /** Reads: seconds a successful identical result may be reused instead of calling the provider again. */
  cacheSeconds?: number;
  /** Explicit UTF-8 output limit, capped at 2,000,000 bytes; overflow fails the receipt. */
  maxOutputBytes?: number;
  /** Adapter guarantees retries with the same key cannot repeat the external write. */
  idempotent?: boolean;
  run: (ctx: CapabilityRunContext, input: I) => Promise<CapabilityResult<O>>;
  /** Writes: read the provider back and confirm the desired state exists. */
  verify?: (ctx: CapabilityRunContext, input: I, result: CapabilityResult<O>) => Promise<boolean>;
}
