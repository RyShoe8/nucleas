import { createHash } from 'crypto';
import { Types } from 'mongoose';

/** Synthetic project id that carries Ask Nucleas runs and spend (same approach as IDE Free Chat). */
export function assistantLedgerProjectId(organizationId: string): Types.ObjectId {
  return new Types.ObjectId(createHash('sha256').update(`nucleas-os-assistant:v1:${organizationId}`).digest('hex').slice(0, 24));
}
