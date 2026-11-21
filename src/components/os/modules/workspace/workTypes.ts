import type { JobView as LegacyJobView } from '../jobs/JobCard';
import type { JobView as CanonicalJobView } from '@/lib/jobs/jobs';
/** Additive ownership fields; old typed editors continue accepting the same job representation. */
export type JobView = LegacyJobView & Pick<CanonicalJobView, 'assignedMemberId' | 'ownerName' | 'workAgreement'>;
