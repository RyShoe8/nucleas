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

/** A question another screen wants Ask to answer. Taken once by the Ask window. */
let pendingAsk: { id: string; text: string } | null = null;
const askListeners = new Set<() => void>();

export function askNucleas(text: string, focus?: AssistantFocus): void {
  if (focus) setAssistantFocus(focus);
  pendingAsk = { id: `${Date.now()}:${text.length}`, text };
  askListeners.forEach((l) => l());
}

export function takePendingAsk(): { id: string; text: string } | null {
  const ask = pendingAsk;
  pendingAsk = null;
  return ask;
}

export function subscribePendingAsk(listener: () => void): () => void {
  askListeners.add(listener);
  return () => {
    askListeners.delete(listener);
  };
}
