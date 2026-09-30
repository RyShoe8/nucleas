import { isCompanyManager, type CompanyViewer } from '@/lib/companies/companyProfile';

export const MAIL_FORBIDDEN = 'Mail is available to managers and administrators.';
export const canUseMail = (viewer: CompanyViewer) => isCompanyManager(viewer);
