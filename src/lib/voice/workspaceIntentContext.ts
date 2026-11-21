import type { IProject } from '@/lib/models/Project';

/**
 * Client-built context for intent parsing (voice + command palette).
 * `projects` is for confirmation UI only — omit from `/api/parse-intent` body.
 */
type WorkspaceIntentViewContext = {
  lens: string;
  pathname: string;
};

type WorkspaceProjectOption = {
  id: string;
  name: string;
};

export type WorkspaceIntentContextPayload = {
  os?: import('./osVoiceIntent').OsVoiceScope;
  projectId: string | null;
  projectName: string | null;
  phase: string | null;
  view: WorkspaceIntentViewContext;
  /** Local calendar "today" for resolving relative dates (YYYY-MM-DD). */
  referenceDate: string;
  /** For project picker in confirmation modal only */
  projects?: WorkspaceProjectOption[];
};

function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildWorkspaceIntentContext(opts: {
  pathname: string;
  phase: string | null;
  lens: string;
  inspectorFocus: string | null;
  allProjects: IProject[];
}): WorkspaceIntentContextPayload {
  let projectId: string | null = null;
  let projectName: string | null = null;
  const focus = opts.inspectorFocus;
  const match = focus?.match(/^project:(.+)$/);
  if (match) {
    const id = match[1];
    const p = opts.allProjects.find((x) => x._id.toString() === id);
    if (p) {
      projectId = id;
      projectName = p.name;
    }
  }

  const projects: WorkspaceProjectOption[] = opts.allProjects.map((p) => ({
    id: p._id.toString(),
    name: p.name,
  }));

  return {
    projectId,
    projectName,
    phase: opts.phase,
    view: {
      lens: opts.lens,
      pathname: opts.pathname,
    },
    referenceDate: localTodayIso(),
    projects,
  };
}
