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
  | 'failed'
  | 'needs_setup'
  | 'plan_limited'
  | 'needs_reauth'
  | 'denied'
  | 'cancelled';

/** Terminal outcomes an adapter may signal instead of a result. */
export class CapabilityError extends Error {
  constructor(
    readonly code: 'needs_setup' | 'plan_limited' | 'needs_reauth' | 'failed',
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
  /** The company's pinned resource (GA4 property, GSC site, ...), when the capability needs one. */
  resource?: { externalId: string; label?: string };
}

export interface CapabilityRunContext {
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  companyDomain?: string;
  access: ProviderAccess;
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
  requiresResource?: string;
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  /** Reads: seconds a successful identical result may be reused instead of calling the provider again. */
  cacheSeconds?: number;
  run: (ctx: CapabilityRunContext, input: I) => Promise<CapabilityResult<O>>;
  /** Writes: read the provider back and confirm the desired state exists. */
  verify?: (ctx: CapabilityRunContext, input: I, result: CapabilityResult<O>) => Promise<boolean>;
}
