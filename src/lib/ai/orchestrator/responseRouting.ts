/**
 * What makes a request a job rather than something to answer in the chat: it repeats, keeps watching, or does something
 * outside the conversation. Asking for information is none of these, however much research it takes.
 */
const REPEATS = /\b(?:every|each)\s+(?:\d+\s+)?(?:day|week|month|year|morning|evening|night|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend|\w+\s+(?:days|weeks|months|hours))\b|\b(?:daily|weekly|monthly|hourly|quarterly|nightly|recurring|regularly|ongoing|on a schedule|from now on|going forward)\b|\b(?:schedule|automate|automatically)\b/i;
const WATCHES = /\bkeep\s+(?:an eye|checking|watching|monitoring|tracking|updating)\b|\b(?:monitor|watch for|alert me|notify me|let me know when|whenever)\b/i;
const ACTS = /\b(?:add|import|save|upload|put|load)\b[^.?!]{0,80}?\b(?:to|into|in)\s+(?:(?:the|our|my|their|its)\s+)?(?:[\w.-]+\s+){0,3}(?:catalog|catalogue|site|website|admin|database|store|listings?)\b|\b(?:publish|send|email|outreach|submit|contact|reach out|post (?:it |this |them )?(?:to|on)|(?:earn|build|get)\b[^.?!]{0,30}\b(?:backlinks?|links?))\b/i;
/** "What should I post?" and "How much did we earn?" ask for information, whatever words they use. */
const QUESTION = /\?\s*$|^\s*(?:what|how|who|whom|which|why|when|where|is|are|was|were|does|did|can|could|should|would|will)\b/i;
const ASKS_FOR_JOB = /\b(?:create|make|set up|start|open|add|design|schedule)\s+(?:\w+\s+){0,3}jobs?\b|\bas an? (?:\w+\s+)?job\b/i;

/** True when the text asks for an answer or advice rather than for work to be set up: "what should we do to…", "how do we…". */
export function isQuestion(text: string): boolean {
  return QUESTION.test(text.trim()) && !requestNeedsJob(text);
}

/** True when a request belongs in a job. Checked in code, so a model cannot turn a question into something awaiting approval. */
export function requestNeedsJob(text: string): boolean {
  return [REPEATS, WATCHES, ASKS_FOR_JOB].some((pattern) => pattern.test(text)) || (ACTS.test(text) && !QUESTION.test(text));
}
