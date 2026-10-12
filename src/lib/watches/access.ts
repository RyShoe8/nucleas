import { isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';

export const WATCHES_FORBIDDEN = 'Content watches are available to managers and administrators.';
/** Watches read mailboxes, so only managers and administrators use them. */
export const canUseWatches = (viewer: CompanyViewer) => isCompanyManager(viewer);
