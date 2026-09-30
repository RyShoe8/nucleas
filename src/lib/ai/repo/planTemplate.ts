/**
 * A fill-in-the-blanks plan for a model that could not produce the plan format on its own.
 * Small models follow "replace the <...> parts of this JSON" far more reliably than a description of
 * the schema, and the facts Nucleas already traced (the path, quotable lines) come pre-filled and
 * checkable, so the model only has to choose and explain.
 */
import type { EvidencePack } from './evidencePack';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function planTemplate(pack: EvidencePack | null): string {
  const path = (pack?.chains[0]?.hops ?? []).slice(0, 8).map((hop) => ({
    file: hop.file,
    ...(hop.via ? { line: hop.via.line } : {}),
    note: '<what this file does on the way>',
  }));
  const seen = new Set<string>();
  const evidence = (pack?.termLines ?? [])
    .filter((row) => (seen.has(`${row.file}:${row.line}`) ? false : (seen.add(`${row.file}:${row.line}`), true)))
    .slice(0, 6)
    .map((row) => ({ file: row.file, line: row.line, quote: clip(row.text.trim(), 160) }));
  const target = pack?.chains[0]?.target ?? '<file to change>';
  return JSON.stringify({
    title: '<short title>',
    summary: '<one sentence: what changes and why>',
    symptom: '<what the user sees>',
    path: path.length ? path : [{ file: '<page or route file>', line: 1, note: '<what it does on the way>' }],
    rootCause: {
      explanation: '1. <how the page gets its data> 2. <where the wrong item is produced, citing a quote below> 3. <why it shows up twice or wrongly>',
      evidence: evidence.length ? evidence : [{ file: '<file>', line: 1, quote: '<exact line of code>' }],
    },
    filesToChange: [target],
    walkthrough: `<function name in the file to change> with the change applied: <what it now outputs>`,
    expectedResult: '<what the user will see, and which file:line renders it>',
    sideEffects: ['<other file that reads the changed code, and whether it is affected>'],
    unverified: ['<data you could not confirm, such as database contents>'],
    outOfScope: ['<what you are not changing, and why>'],
    steps: ['Edit <file> to <specific change>'],
  }, null, 1);
}

/** The correction request for a reply that contained no usable plan at all. */
export function planTemplateRequest(userText: string, pack: EvidencePack | null): string {
  return [
    userText, '',
    'Your previous reply did not contain the required plan JSON. Return ONLY the JSON block below inside a ```nucleas-plan fence, with every <...> part replaced.',
    'Keep only the evidence items that really support the root cause (delete the others) and copy their quotes exactly. Change file paths only to files you have seen in the evidence. Write no other prose.',
    '', '```nucleas-plan', planTemplate(pack), '```',
  ].join('\n');
}
