'use client';

import type { ThreadMessage, ThreadSummary } from './types';

/** AI help for one conversation: filled in by the AI stage. */
export default function MailAiTools({}: { thread: ThreadSummary; messages: ThreadMessage[]; draftInto: (text: string) => void }) {
    return null;
}
