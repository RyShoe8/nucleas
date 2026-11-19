import { requireAdminUser } from '@/lib/blog/requireAdmin';

export async function requireAdminInsights() {
  return requireAdminUser();
}
