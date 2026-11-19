const PROTECTED_PLATFORM_STACK_SLUGS = ['tech', 'marketing', 'socials'] as const;

export function isProtectedPlatformStackSlug(slug: string): boolean {
  return (PROTECTED_PLATFORM_STACK_SLUGS as readonly string[]).includes(slug);
}
