import type { GatewayError } from '@nucleas/ai-core/gateway';

/** Actionable copy for company-credential chat admission failures. */
export function companyChatAdmissionMessage(code: GatewayError['code']): string {
  switch (code) {
    case 'configuration':
      return 'Enable Remote connection and Processing in Admin → AI Settings. Paid models also need a positive reservation within org/project budget ceilings.';
    case 'rate_limit':
      return 'Shared AI request limit or spacing was hit (Admin → AI Settings → Minimum seconds between attempts / daily limit). Wait and retry, or raise those limits.';
    case 'unavailable':
      return 'The free model stayed busy with other work for too long. Try again shortly.';
    case 'credentials':
      return 'Company credential authentication was rejected.';
    case 'cancelled':
      return 'The chat request was cancelled before completion.';
    default:
      return 'Chat could not be admitted.';
  }
}
