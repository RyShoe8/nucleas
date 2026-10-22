/** Recipient/account restrictions exclude an offer from public deal feeds. A greeting or delivery address does not. */
export function recipientOnlyOffer(text: string): boolean {
  const value = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  return [
    /\bexclusive\s+(?:offer|deal|promotion|bonus)\s+(?:is\s+)?(?:for|to)\s*:?\s*[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
    /\b(?:offer|deal|promotion|bonus)\b[^.!?]{0,90}\b(?:only available|available only|only valid|valid only|exclusive|restricted|limited)\s+(?:for|to)\s*:?\s*(?:you\b|your\s+(?:email|account)\b|the\s+(?:recipient|account holder)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i,
    /\b(?:offer|deal|promotion|bonus)\b[^.!?]{0,90}\b(?:for\s+your\s+(?:account|email)\s+only|for\s+you\s+only|only\s+for\s+you|personal\s+(?:and\s+)?non[- ]transferable)/i,
    /\b(?:only|solely)\s+(?:the\s+)?(?:recipient|intended recipient|named account holder)\s+(?:is eligible|can (?:claim|redeem)|may (?:claim|redeem))/i,
  ].some((pattern) => pattern.test(value));
}

export function recipientOnlyItem(item: { subject?: string | null; text?: string | null; summary?: string | null; keyPoints?: { text?: string | null }[] | null }): boolean {
  return [item.subject, item.text, item.summary, ...(item.keyPoints ?? []).map((point) => point.text)].some((text) => Boolean(text && recipientOnlyOffer(text)));
}
