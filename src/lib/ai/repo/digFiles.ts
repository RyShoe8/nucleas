/**
 * Which files the repository dig shows a model first. One function, used by the dig itself and by the
 * replay evaluation, so what is measured is what runs.
 */
import { buildEvidencePack, type EvidencePack } from './evidencePack';
import { snapshotCandidates } from './digSelect';

export interface DigSelection {
  /** Files to show, in order: the data files and the files that assemble them, then the best keyword matches. */
  paths: string[];
  pack: EvidencePack | null;
  /** Line to centre each traced file's excerpt on. */
  focus: Map<string, number | undefined>;
}

export function selectDigFiles(files: Map<string, string>, userText: string, query: string, maxFiles: number): DigSelection {
  // Tracing is an aid: if it fails, the keyword ranking still runs.
  let pack: EvidencePack | null = null;
  try { pack = buildEvidencePack(files, userText); } catch { pack = null; }
  const scope = pack?.scope.size ? pack.scope : undefined;
  const ranked = snapshotCandidates({ files }, query, maxFiles, { scope });
  const focus = new Map((pack?.focus ?? []).map((f) => [f.file, f.line] as const));
  return { paths: [...new Set([...focus.keys(), ...ranked])].slice(0, maxFiles), pack, focus };
}
