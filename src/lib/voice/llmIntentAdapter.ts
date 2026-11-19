import { joinBatchTaskTitles, type ParsedIntent } from '@/lib/voice/IntentParser';

type VoiceLlmRawIntent = {
  action?: string;
  slots?: Record<string, unknown> | null;
  entity?: string | null;
  title?: string | null;
  titles?: unknown;
  task_titles?: unknown;
  tasks?: unknown;
  taskName?: string | null;
  employeeName?: string | null;
  assignee?: string | null;
  assigned_to?: string | null;
  channel?: string | null;
  date?: string | null;
  notes?: string | null;
  project?: string | null;
  projectName?: string | null;
  project_name?: string | null;
  projectId?: string | null;
  employee_name?: string | null;
  status?: string | null;
  context?: string | null;
  mode?: string | null;
  lens?: string | null;
  phase?: string | null;
  timeframe?: string | null;
  filter?: string | null;
  toggle_action?: string | null;
  entity_type?: string | null;
  command_id?: string | null;
  navigation_target?: string | null;
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return String(v);
  const t = v.trim();
  return t.length ? t : null;
}

function pick(...vals: unknown[]): string {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return '';
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function readField(o: VoiceLlmRawIntent, ...keys: string[]): unknown {
  const top = o as Record<string, unknown>;
  const nested = obj(o.slots);
  for (const key of keys) {
    if (key in top) {
      const v = top[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    if (nested && key in nested) {
      const v = nested[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
  }
  return null;
}

function splitInlineTaskList(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  // "blog and newsletter 10 11 and 12" -> ["blog and newsletter 10", ...]
  const series = /^(.*?\D)\s+(\d+(?:\s+(?:and\s+)?\d+)+)$/i.exec(text);
  if (series) {
    const base = series[1].trim();
    const nums = series[2]
      .replace(/\band\b/gi, ' ')
      .split(/\s+/)
      .filter((n) => /^\d+$/.test(n));
    if (base && nums.length >= 2) return nums.map((n) => `${base} ${n}`);
  }
  const commaParts = text.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    const out: string[] = [];
    for (const part of commaParts) {
      out.push(...part.split(/\s+\band\b\s+/i).map((s) => s.trim()).filter(Boolean));
    }
    return out.length ? out : [text];
  }
  return [text];
}

function titleFromObjectItem(item: unknown): string | null {
  const o = obj(item);
  if (!o) return str(item);
  return pick(o.title, o.name, o.task, o.taskName, o.text, o.label);
}

function titlesFromLlmArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = titleFromObjectItem(item);
    if (s) out.push(s);
  }
  return out;
}

/** Ordered task titles for create_task: prefers titles[] then title/notes. */
function collectCreateTaskTitles(o: VoiceLlmRawIntent): string[] {
  const fromArr = titlesFromLlmArray(
    readField(o, 'titles', 'task_titles', 'tasks')
  );
  if (fromArr.length > 0) return fromArr;
  const one = pick(
    readField(o, 'title', 'taskName', 'task_name', 'name'),
    readField(o, 'notes')
  );
  if (!one) return [];
  return splitInlineTaskList(one);
}

function collectCreateTaskProject(o: VoiceLlmRawIntent): { projectName: string; projectId: string } {
  return {
    projectName: pick(readField(o, 'project_name', 'projectName', 'project')),
    projectId: pick(readField(o, 'projectId', 'project_id')),
  };
}

function collectCreateTaskEmployee(o: VoiceLlmRawIntent): string {
  return pick(readField(o, 'employee_name', 'employeeName', 'assignee', 'assigned_to'));
}

export function rescueCreateTaskIntent(raw: unknown, rawTranscript: string): ParsedIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as VoiceLlmRawIntent;
  const action = str(readField(o, 'action'))?.toLowerCase();
  if (action !== 'create_task') return null;
  const titles = collectCreateTaskTitles(o);
  if (titles.length === 0) return null;
  const { projectName, projectId } = collectCreateTaskProject(o);
  const employeeName = collectCreateTaskEmployee(o);
  const useBatch = titles.length > 1 || !!employeeName;
  if (useBatch) {
    return {
      type: 'BATCH_ADD_TASKS',
      confidence: 0.85,
      slots: {
        titlesJoined: joinBatchTaskTitles(titles),
        projectName,
        projectId,
        employeeName,
      },
      rawTranscript,
    };
  }
  return {
    type: 'ADD_TASK',
    confidence: 0.85,
    slots: { taskName: titles[0], projectName, projectId },
    rawTranscript,
  };
}

/** Map navigation_target → ParsedIntent (aligned with WorkspaceShell handleIntent + CommandRegistry). */
function navigationTargetToParsedIntent(targetRaw: string, rawTranscript: string): ParsedIntent | null {
  const key = targetRaw.toLowerCase().replace(/\s+/g, '_');

  type NavPlace = 'workspace' | 'assets' | 'employees' | 'employee' | 'team' | 'admin';
  const placeMap: Record<string, NavPlace> = {
    workspace: 'workspace',
    assets: 'assets',
    employees: 'employees',
    employee: 'employees',
    team: 'employees',
    admin: 'admin',
  };
  if (placeMap[key]) {
    return { type: 'NAVIGATE', confidence: 0.95, slots: { place: placeMap[key] }, rawTranscript };
  }

  if (key === 'schedule' || key === 'calendar_view') {
    return { type: 'RUN_COMMAND', confidence: 0.95, slots: { commandId: 'nav-schedule' }, rawTranscript };
  }
  if (key === 'projects' || key === 'project_list') {
    return { type: 'RUN_COMMAND', confidence: 0.95, slots: { commandId: 'nav-projects' }, rawTranscript };
  }
  if (key === 'capacity' || key === 'team_capacity') {
    return { type: 'RUN_COMMAND', confidence: 0.95, slots: { commandId: 'nav-capacity' }, rawTranscript };
  }
  if (key === 'calendar') {
    return { type: 'RUN_COMMAND', confidence: 0.95, slots: { commandId: 'view-calendar' }, rawTranscript };
  }
  if (key === 'agenda') {
    return { type: 'RUN_COMMAND', confidence: 0.95, slots: { commandId: 'view-agenda' }, rawTranscript };
  }
  if (key === 'plan') {
    return { type: 'RUN_COMMAND', confidence: 0.95, slots: { commandId: 'nav-plan' }, rawTranscript };
  }
  if (key === 'build') {
    return { type: 'RUN_COMMAND', confidence: 0.95, slots: { commandId: 'nav-build' }, rawTranscript };
  }
  if (key === 'run') {
    return { type: 'RUN_COMMAND', confidence: 0.95, slots: { commandId: 'nav-run' }, rawTranscript };
  }

  return null;
}

export function voiceLlmIntentToParsedIntent(raw: unknown, rawTranscript: string): ParsedIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as VoiceLlmRawIntent;
  const action = str(o.action)?.toLowerCase();

  if (!action || action === 'unknown') return null;

  if (action === 'create_task') {
    const rescue = rescueCreateTaskIntent(raw, rawTranscript);
    return rescue;
  }

  if (action === 'assign_task') {
    const taskName = str(o.title) || str(o.notes);
    const employeeName = str(o.employee_name);
    if (!taskName || !employeeName) return null;
    const context = str(o.project_name) || '';
    return {
      type: 'ASSIGN_TASK',
      confidence: 0.9,
      slots: { taskName, employeeName, context },
      rawTranscript,
    };
  }

  if (action === 'assign_project') {
    const projectName = str(o.project_name);
    const employeeName = str(o.employee_name);
    if (!projectName || !employeeName) return null;
    return {
      type: 'ASSIGN_PROJECT',
      confidence: 0.9,
      slots: { projectName, employeeName },
      rawTranscript,
    };
  }

  if (action === 'create_content') {
    return {
      type: 'CREATE_CONTENT',
      confidence: 0.9,
      slots: {
        title: str(o.title) || '',
        channel: str(o.channel) || '',
        date: str(o.date) || '',
        notes: str(o.notes) || '',
        project_name: str(o.project_name) || '',
        projectId: str(o.projectId) || '',
      },
      rawTranscript,
    };
  }

  if (action === 'open_task') {
    const name = pick(o.title, o.notes);
    if (!name) return null;
    return {
      type: 'OPEN_TASK',
      confidence: 0.9,
      slots: { name, context: pick(o.context, o.project_name) },
      rawTranscript,
    };
  }

  if (action === 'open_entity') {
    const entityType = pick(o.entity_type, o.entity, 'project').toLowerCase();
    const normalized =
      entityType === 'task' || entityType === 'content' || entityType === 'asset' ? entityType : 'project';
    const name = pick(o.title, o.project_name, o.notes);
    if (!name) return null;
    return {
      type: 'OPEN_ENTITY',
      confidence: 0.9,
      slots: { entityType: normalized, name },
      rawTranscript,
    };
  }

  if (action === 'complete_task') {
    const name = pick(o.title, o.notes);
    if (!name) return null;
    return {
      type: 'COMPLETE_TASK',
      confidence: 0.9,
      slots: { name, context: pick(o.context, o.project_name) },
      rawTranscript,
    };
  }

  if (action === 'delete_entity') {
    const entityType = pick(o.entity_type, o.entity, 'task').toLowerCase();
    const normalized = entityType === 'project' || entityType === 'content' || entityType === 'task' ? entityType : 'task';
    const name = pick(o.title, o.notes);
    if (!name) return null;
    return {
      type: 'DELETE_ENTITY',
      confidence: 0.9,
      slots: { entityType: normalized, name },
      rawTranscript,
    };
  }

  if (action === 'set_task_status') {
    const taskName = pick(o.title, o.notes);
    const status = pick(o.status, o.notes);
    if (!taskName || !status) return null;
    return {
      type: 'SET_TASK_STATUS',
      confidence: 0.9,
      slots: { taskName, status, context: pick(o.context, o.project_name) },
      rawTranscript,
    };
  }

  if (action === 'set_project_status') {
    const projectName = pick(o.project_name, o.title);
    const status = pick(o.status, o.notes);
    if (!projectName || !status) return null;
    return {
      type: 'SET_PROJECT_STATUS',
      confidence: 0.9,
      slots: { projectName, status },
      rawTranscript,
    };
  }

  if (action === 'switch_lens') {
    const lens = pick(o.lens, o.navigation_target).toLowerCase();
    if (!lens) return null;
    return {
      type: 'SWITCH_LENS',
      confidence: 0.9,
      slots: { lens },
      rawTranscript,
    };
  }

  if (action === 'switch_view') {
    const mode = pick(o.mode, o.navigation_target).toLowerCase();
    if (!mode) return null;
    return {
      type: 'SWITCH_VIEW',
      confidence: 0.9,
      slots: { mode },
      rawTranscript,
    };
  }

  if (action === 'filter_phase') {
    const phaseRaw = pick(o.phase, o.navigation_target);
    if (!phaseRaw) return null;
    const p = phaseRaw.toLowerCase();
    const phase =
      p === 'plan'
        ? 'Plan'
        : p === 'build'
          ? 'Build'
          : p === 'run'
            ? 'Run'
            : p === 'schedule'
              ? 'Schedule'
              : p === 'all'
                ? 'All'
                : phaseRaw;
    return {
      type: 'FILTER_PHASE',
      confidence: 0.9,
      slots: { phase },
      rawTranscript,
    };
  }

  if (action === 'set_timeframe') {
    const timeframe = pick(o.timeframe, o.navigation_target).toLowerCase();
    if (!timeframe) return null;
    return {
      type: 'SET_TIMEFRAME',
      confidence: 0.9,
      slots: { timeframe },
      rawTranscript,
    };
  }

  if (action === 'toggle_filter') {
    const filterRaw = pick(o.filter, o.notes).toLowerCase();
    const actionRaw = pick(o.toggle_action).toLowerCase();
    const filter =
      filterRaw.includes('my') ? 'myAssignments' : filterRaw.includes('content') ? 'content' : 'tasks';
    const toggle = actionRaw === 'hide' ? 'hide' : 'show';
    return {
      type: 'TOGGLE_FILTER',
      confidence: 0.9,
      slots: { filter, action: toggle },
      rawTranscript,
    };
  }

  if (action === 'update_project_description') {
    const name = pick(o.project_name, o.title);
    const description = pick(o.notes);
    if (!name || !description) return null;
    return {
      type: 'UPDATE_PROJECT_DESCRIPTION',
      confidence: 0.9,
      slots: { name, description },
      rawTranscript,
    };
  }

  if (action === 'run_command') {
    const commandId = pick(o.command_id);
    if (!commandId) return null;
    return {
      type: 'RUN_COMMAND',
      confidence: 0.9,
      slots: { commandId },
      rawTranscript,
    };
  }

  if (action === 'navigate') {
    const nav = str(o.navigation_target);
    if (!nav) return null;
    const mapped = navigationTargetToParsedIntent(nav, rawTranscript);
    return mapped;
  }

  return null;
}
