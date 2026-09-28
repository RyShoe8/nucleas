/**
 * IDE chat works like Ask: Orchestrated (the AI engine picks every model at a cost level) or
 * Direct (one chosen provider model).
 */
export const ideChatModes = [
  { id: 'orchestrated' as const, label: 'Orchestrated' },
  { id: 'direct' as const, label: 'Direct' },
] as const;

export type IdeChatMode = (typeof ideChatModes)[number]['id'];

/** Mode ids from before orchestration: AI Team roles and the older Plan/Build/Research tabs. */
export const LEGACY_IDE_MODES = ['marketing', 'product', 'support', 'engineering', 'researcher', 'plan', 'build', 'research'] as const;

export function isIdeChatMode(value: string): value is IdeChatMode {
  return ideChatModes.some((item) => item.id === value);
}

export function isIdeOrchestratedMode(value: string): value is 'orchestrated' {
  return value === 'orchestrated';
}

export function isIdeDirectMode(value: string): value is 'direct' {
  return value === 'direct';
}

/** Accepts current ids; every legacy id becomes Orchestrated. */
export function normalizeIdeChatMode(value: string): IdeChatMode | null {
  if (isIdeChatMode(value)) return value;
  if ((LEGACY_IDE_MODES as readonly string[]).includes(value)) return 'orchestrated';
  return null;
}

/** Stored mode values that belong to a mode (Orchestrated includes transcripts and rules from legacy tabs). */
export function storedModeValues(mode: IdeChatMode): string[] {
  return mode === 'direct' ? ['direct'] : ['orchestrated', ...LEGACY_IDE_MODES];
}

/** Modes to match when loading task rules. */
export function taskRuleModeQueryValues(mode: IdeChatMode): string[] {
  return ['all', ...storedModeValues(mode)];
}
