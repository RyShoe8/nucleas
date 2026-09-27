/**
 * Which company the Ask Nucleas window is focused on. A tiny shared store so "Ask Nucleas" from a
 * company window re-focuses the one assistant window instead of opening one per company.
 */

export interface AssistantFocus {
  companyId: string;
  companyName: string;
}

let current: AssistantFocus | null = null;
const listeners = new Set<() => void>();

export function getAssistantFocus(): AssistantFocus | null {
  return current;
}

export function setAssistantFocus(focus: AssistantFocus | null): void {
  current = focus;
  listeners.forEach((l) => l());
}

export function subscribeAssistantFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
