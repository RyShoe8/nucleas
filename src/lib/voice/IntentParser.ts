/**
 * IntentParser: Rule-based intent extraction from voice transcript.
 * Maps natural language to structured intents for the VoiceExecutor.
 */

type IntentType =
    | 'OS_NAVIGATE'
    | 'ASK_NUCLEAS'
    | 'NAVIGATE'
    | 'SET_TIMEFRAME'
    | 'FILTER_PHASE'
    | 'SWITCH_LENS'
    | 'SWITCH_VIEW'
    | 'TOGGLE_FILTER'
    | 'OPEN_ENTITY'
    | 'CREATE_CONTENT'
    | 'COMPLETE_TASK'
    | 'PUBLISH_CONTENT'
    | 'EDIT_ENTITY'
    | 'DELETE_ENTITY'
    | 'MARK_COMPLETE'
    | 'UPDATE_PROJECT_DESCRIPTION'
    | 'RUN_COMMAND'
    | 'ADD_TASK'
    | 'BATCH_ADD_TASKS'
    | 'RENAME_PROJECT'
    | 'RENAME_TASK'
    | 'SET_PROJECT_STATUS'
    | 'SET_TASK_STATUS'
    | 'OPEN_TASK'
    | 'ASSIGN_PROJECT'
    | 'ASSIGN_TASK'
    | 'UNKNOWN';

export interface ParsedIntent {
    type: IntentType;
    confidence: number; // 0-1
    slots: Record<string, string>;
    rawTranscript: string;
}

/** Separator for BATCH_ADD_TASKS `titlesJoined` slot (unlikely in natural titles). */
const BATCH_TASK_TITLES_DELIM = '\u001f';

export function joinBatchTaskTitles(titles: string[]): string {
    return titles.map((t) => t.split(BATCH_TASK_TITLES_DELIM).join('')).join(BATCH_TASK_TITLES_DELIM);
}

export function splitBatchTaskTitles(joined: string): string[] {
    return joined.split(BATCH_TASK_TITLES_DELIM).map((t) => t.trim()).filter(Boolean);
}

interface PatternRule {
    type: IntentType;
    patterns: RegExp[];
    extractSlots: (match: RegExpMatchArray) => Record<string, string>;
}

function cleanProjectSlot(input: string | undefined): string {
    if (!input) return '';
    return input
        .replace(/^\s*(?:called|named)\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanTaskSlot(input: string | undefined): string {
    if (!input) return '';
    let value = input
        .replace(/^\s*(?:called|named)\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    // If STT leaked "project called X called Y", prefer the explicit task after last "called".
    if (/\bproject\s+called\b/i.test(value) && /\bcalled\b/i.test(value)) {
        const pieces = value.split(/\bcalled\b/i).map((p) => p.trim()).filter(Boolean);
        if (pieces.length > 1) value = pieces[pieces.length - 1];
    }

    // Remove obvious trailing command echoes.
    value = value
        .replace(/\b(?:add|create)\s+(?:a\s+)?task\s*$/i, '')
        .replace(/\bto\s+(?:the\s+)?project\s+.+$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    return value;
}

function splitSpokenTaskBatch(input: string): string[] {
    const text = cleanTaskSlot(input);
    if (!text) return [];
    const series = /^(.*?\D)\s+(\d+(?:\s+(?:and\s+)?\d+)+)$/i.exec(text);
    if (series) {
        const base = cleanTaskSlot(series[1]);
        const nums = series[2]
            .replace(/\band\b/gi, ' ')
            .split(/\s+/)
            .filter((n) => /^\d+$/.test(n));
        if (base && nums.length >= 2) return nums.map((n) => `${base} ${n}`);
    }
    const commaParts = text.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
    if (commaParts.length > 1) {
        const out: string[] = [];
        for (const part of commaParts) {
            out.push(...part.split(/\s+\band\b\s+/i).map((s) => s.trim()).filter(Boolean));
        }
        return out;
    }
    return [text];
}

const rules: PatternRule[] = [
    // Navigation
    {
        type: 'NAVIGATE',
        patterns: [
            /(?:go to|open|navigate to|show me)\s+(workspace|assets|employees|team|admin)/i,
        ],
        extractSlots: (m) => {
            let place = m[1].toLowerCase();
            if (place === 'team') place = 'employees';
            return { place };
        },
    },

    // Set timeframe
    {
        type: 'SET_TIMEFRAME',
        patterns: [
            /(?:show|switch to|view)\s+(today|this week|weekly|this month|monthly|this quarter|quarterly|this year|yearly)/i,
            /^(today|weekly|monthly|quarterly|yearly)$/i,
        ],
        extractSlots: (m) => {
            const raw = m[1].toLowerCase();
            const map: Record<string, string> = {
                'today': 'today',
                'this week': 'weekly',
                'weekly': 'weekly',
                'this month': 'monthly',
                'monthly': 'monthly',
                'this quarter': 'quarterly',
                'quarterly': 'quarterly',
                'this year': 'yearly',
                'yearly': 'yearly',
            };
            return { timeframe: map[raw] || raw };
        },
    },

    // Filter phase
    {
        type: 'FILTER_PHASE',
        patterns: [
            /(?:filter to|show|switch to)\s+(plan|build|run|schedule|all)/i,
            /^(plan|build|run|schedule|all)\s*(?:phase)?$/i,
        ],
        extractSlots: (m) => {
            const raw = m[1].toLowerCase();
            const phase =
                raw === 'schedule' ? 'Schedule' : raw.charAt(0).toUpperCase() + raw.slice(1);
            return { phase };
        },
    },

    // Switch lens
    {
        type: 'SWITCH_LENS',
        patterns: [
            /(?:show|switch to|view)\s+(schedule|projects|capacity)/i,
        ],
        extractSlots: (m) => ({ lens: m[1].toLowerCase() }),
    },

    // Switch calendar/agenda
    {
        type: 'SWITCH_VIEW',
        patterns: [
            /(?:switch to|show|view)\s+(calendar|agenda)/i,
        ],
        extractSlots: (m) => ({ mode: m[1].toLowerCase() }),
    },

    // Toggle filters
    {
        type: 'TOGGLE_FILTER',
        patterns: [
            /(?:show|hide)\s+(tasks|content|only my assignments)/i,
            /show only my (?:assignments|work)/i,
        ],
        extractSlots: (m) => {
            const raw = m[1]?.toLowerCase() || 'my assignments';
            if (raw.includes('my')) return { filter: 'myAssignments', action: 'show' };
            const action = m[0].toLowerCase().startsWith('hide') ? 'hide' : 'show';
            return { filter: raw, action };
        },
    },

    // Open entity
    {
        type: 'OPEN_ENTITY',
        patterns: [
            /(?:open|show|view)\s+project\s+(.+)/i,
            /(?:open|show|view)\s+content\s+(.+)/i,
            /(?:open|show|view)\s+asset\s+(.+)/i,
        ],
        extractSlots: (m) => {
            const fullMatch = m[0].toLowerCase();
            let entityType = 'project';
            if (fullMatch.includes('content')) entityType = 'content';
            if (fullMatch.includes('asset')) entityType = 'asset';
            return { entityType, name: m[1].trim() };
        },
    },

    // Open task (inspector + task focus)
    {
        type: 'OPEN_TASK',
        patterns: [
            /(?:open|show|view)\s+task\s+(.+?)(?:\s+in\s+(?:the\s+)?(?:project\s+)?(.+))?$/i,
        ],
        extractSlots: (m) => ({
            name: m[1].trim(),
            context: m[2]?.trim() ?? '',
        }),
    },

    // Batch add + assign (LLM fallback hardening for compound utterances)
    {
        type: 'BATCH_ADD_TASKS',
        patterns: [
            /^(?:create|add)\s+(?:the\s+)?tasks?\s+(.+?)\s+(?:in|for)\s+(?:the\s+)?(?:project\s+)?(.+?)\s+and\s+assign\s+(?:them|all)\s+to\s+(.+)$/i,
        ],
        extractSlots: (m) => ({
            titlesJoined: joinBatchTaskTitles(splitSpokenTaskBatch(m[1] ?? '')),
            projectName: cleanProjectSlot(m[2]),
            employeeName: m[3]?.trim() ?? '',
        }),
    },

    // Add task to project
    {
        type: 'ADD_TASK',
        patterns: [
            /^(?:add|create)\s+(?:a\s+)?(?:new\s+)?task\s+under\s+(.+?)\s+(?:called|named)\s+(.+)$/i,
            /^(?:add|create)\s+(?:a\s+)?task\s+(.+?)\s+to\s+(?:the\s+)?project\s+(.+)$/i,
            /^(?:add|create)\s+(?:a\s+)?task\s+to\s+(?:the\s+)?project\s+(.+?)\s+(?:called|named)\s+(.+)$/i,
            /^(?:add|create)\s+(?:a\s+)?task\s+(?:called|named)\s+(.+?)\s+(?:for|in)\s+(?:the\s+)?project\s+(.+)$/i,
            /^(?:add|create)\s+(?:a\s+)?task\s+for\s+(?:the\s+)?project\s+(.+?)\s+(?:called|named)\s+(.+)$/i,
        ],
        extractSlots: (m) => {
            const raw = m[0].toLowerCase();
            // add … task under PROJECT called TASK
            if (/task\s+under\s+.+\s+(?:called|named)/i.test(raw)) {
                return {
                    projectName: cleanProjectSlot(m[1]),
                    taskName: cleanTaskSlot(m[2]),
                };
            }
            // add task to project X called Y
            if (/task\s+to\s+(?:the\s+)?project/i.test(raw)) {
                return {
                    projectName: cleanProjectSlot(m[1]),
                    taskName: cleanTaskSlot(m[2]),
                };
            }
            // add task called Y for project X   OR   add task Y to project X
            return {
                taskName: cleanTaskSlot(m[1]),
                projectName: cleanProjectSlot(m[2]),
            };
        },
    },

    // Rename project
    {
        type: 'RENAME_PROJECT',
        patterns: [
            /(?:rename|change\s+the\s+name\s+of)\s+(?:the\s+)?(?:project\s+)?(.+?)\s+to\s+(.+)/i,
        ],
        extractSlots: (m) => ({ fromName: m[1].trim(), toName: m[2].trim() }),
    },

    // Rename task
    {
        type: 'RENAME_TASK',
        patterns: [
            /(?:rename|change\s+the\s+name\s+of)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+to\s+(.+?)(?:\s+in\s+(?:the\s+)?(?:project\s+)?(.+))?$/i,
        ],
        extractSlots: (m) => ({
            fromName: m[1].trim(),
            toName: m[2].trim(),
            context: m[3]?.trim() ?? '',
        }),
    },

    // Set project status
    {
        type: 'SET_PROJECT_STATUS',
        patterns: [
            /(?:set|change)\s+(?:the\s+)?(?:project\s+)?(.+?)\s+status\s+to\s+(.+)/i,
        ],
        extractSlots: (m) => ({ projectName: m[1].trim(), status: m[2].trim() }),
    },

    // Set task status
    {
        type: 'SET_TASK_STATUS',
        patterns: [
            /(?:set|change)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+status\s+to\s+(.+?)(?:\s+in\s+(?:the\s+)?(?:project\s+)?(.+))?$/i,
        ],
        extractSlots: (m) => ({
            taskName: m[1].trim(),
            status: m[2].trim(),
            context: m[3]?.trim() ?? '',
        }),
    },

    // Assign project to employee
    {
        type: 'ASSIGN_PROJECT',
        patterns: [
            /(?:assign)\s+(?:the\s+)?project\s+(.+?)\s+to\s+(.+)/i,
        ],
        extractSlots: (m) => ({ projectName: m[1].trim(), employeeName: m[2].trim() }),
    },

    // Assign task to employee
    {
        type: 'ASSIGN_TASK',
        patterns: [
            /(?:assign)\s+(?:the\s+)?task\s+(.+?)\s+to\s+(.+?)(?:\s+in\s+(?:the\s+)?(?:project\s+)?(.+))?$/i,
        ],
        extractSlots: (m) => ({
            taskName: m[1].trim(),
            employeeName: m[2].trim(),
            context: m[3]?.trim() ?? '',
        }),
    },

    // Create content
    {
        type: 'CREATE_CONTENT',
        patterns: [
            /(?:create|add|new|schedule)\s+(?:a\s+)?(?:content|post)\s*(?::?\s*(.+))?/i,
            /(?:create|add|schedule)\s+(?:a\s+)?(\w+)\s+post\s+(.+)/i,
        ],
        extractSlots: (m) => {
            const slots: Record<string, string> = {};
            if (m[2]) {
                // "create LinkedIn post Title"
                slots.channel = m[1];
                slots.title = m[2].trim();
            } else if (m[1]) {
                slots.title = m[1].trim();
            }
            return slots;
        },
    },

    // Delete entity
    {
        type: 'DELETE_ENTITY',
        patterns: [
            /(?:delete|remove)\s+(project|content|task)\s+(.+)/i,
        ],
        extractSlots: (m) => ({
            entityType: m[1].toLowerCase(),
            name: m[2].trim(),
        }),
    },

    // Update project description
    {
        type: 'UPDATE_PROJECT_DESCRIPTION',
        patterns: [
            /(?:update|change|set)\s+(?:the\s+)?(.+?)\s+description\s+to\s+(?:say\s+)?(.+)/i,
        ],
        extractSlots: (m) => ({
            name: m[1]?.trim(),
            description: m[2]?.trim(),
        }),
    },

    // Complete Task
    {
        type: 'COMPLETE_TASK',
        patterns: [
            // "mark the project [Name] as complete" -> context = project name, name = 'project'
            /(?:mark|set)\s+(?:the\s+)?project\s+(.+?)\s+as\s+(?:complete|done|finished)/i,
            /(?:make|mark)\s+(?:the\s+)?(?:task(?:s)?\s+)?(.+?)\s+(?:for|in|on)\s+(?:the\s+)?(?:project\s+)?(.+?)\s+(?:complete|done|finished)\s*$/i,
            /(?:mark|set|complete|finish)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:for|in|on)\s+(.+?)(?:\s+as\s+(?:complete|done|finished))?/i,
            /(?:mark|set)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+as\s+(?:complete|done|finished)/i,
            /(?:complete|finish)\s+(?:the\s+)?(?:task\s+)?(.+)/i,
            /(?:make|mark)\s+(?:the\s+)?(?:task(?:s)?\s+)?(.+?)\s+(?:complete|done|finished)\s*$/i,
        ],
        extractSlots: (m) => {
            // Single group: "mark project X as complete" -> name='project', context=X
            if (m[2] === undefined) return { name: 'project', context: m[1]?.trim() ?? '' };
            return { name: m[1]?.trim(), context: m[2]?.trim() };
        },
    },

    // Publish Content
    {
        type: 'PUBLISH_CONTENT',
        patterns: [
            /(?:publish|post|go live with)\s+(?:the\s+)?(.+)/i,
            /mark\s+(?:the\s+)?(.+?)\s+as\s+published/i,
        ],
        extractSlots: (m) => ({
            name: m[1].trim(),
        }),
    },

    // Run command by id (for actions that map 1:1 to CommandRegistry)
    {
        type: 'RUN_COMMAND',
        patterns: [
            /(?:go to|open|show|view)\s+schedule/i,
            /(?:go to|open|show|view)\s+projects?/i,
            /(?:go to|open|show|view)\s+(?:capacity|team|employees)/i,
            /(?:go to|open|show|view)\s+(?:calendar|month|week)/i,
            /(?:go to|open|show|view)\s+agenda/i,
            /(?:show|hide)\s+tasks/i,
            /(?:show|hide)\s+content/i,
            /(?:filter|show)\s+(?:channel\s+)?(?:to\s+)?(all channels|linkedin|x\b|twitter|instagram|tiktok|email|article|video|reddit|bluesky|other)/i,
            /(?:go to|open|show|view)\s+(?:workspace|assets|employees|admin|plan|build|run)\b/i,
            /(?:create|new|add)\s+(?:a\s+)?project/i,
            /(?:close|cancel|dismiss)\s*(?:modal|inspector|panel)?\s*$/i,
            /^close\s*$/i,
            /^cancel\s*$/i,
        ],
        extractSlots: (m) => {
            const raw = m[0].toLowerCase();
            if (/\bschedule\b/.test(raw)) return { commandId: 'nav-schedule' };
            if (/\bprojects?\b/.test(raw)) return { commandId: 'nav-projects' };
            if (/\b(capacity|team|employees)\b/.test(raw)) return { commandId: 'nav-capacity' };
            if (/\b(calendar|month|week)\b/.test(raw)) return { commandId: 'view-calendar' };
            if (/\bagenda\b/.test(raw)) return { commandId: 'view-agenda' };
            if (/\bshow\b.*\btasks\b/.test(raw)) return { commandId: 'show-tasks' };
            if (/\bhide\b.*\btasks\b/.test(raw)) return { commandId: 'hide-tasks' };
            if (/\bshow\b.*\bcontent\b/.test(raw)) return { commandId: 'show-content' };
            if (/\bhide\b.*\bcontent\b/.test(raw)) return { commandId: 'hide-content' };
            const chMatch = raw.match(
                /(all channels|linkedin|x\b|twitter|instagram|tiktok|email|article|video|reddit|bluesky|other)/
            );
            if (chMatch) {
                const c = chMatch[1];
                if (c.includes('all')) return { commandId: 'filter-channel-all' };
                if (c.includes('linkedin')) return { commandId: 'filter-channel-linkedin' };
                if (c === 'x' || c.includes('twitter')) return { commandId: 'filter-channel-x' };
                if (c.includes('instagram')) return { commandId: 'filter-channel-instagram' };
                if (c.includes('tiktok')) return { commandId: 'filter-channel-tiktok' };
                if (c.includes('email')) return { commandId: 'filter-channel-email' };
                if (c.includes('article')) return { commandId: 'filter-channel-article' };
                if (c.includes('video')) return { commandId: 'filter-channel-video' };
                if (c.includes('reddit')) return { commandId: 'filter-channel-reddit' };
                if (c.includes('bluesky')) return { commandId: 'filter-channel-bluesky' };
                if (c.includes('other')) return { commandId: 'filter-channel-other' };
            }
            if (/\bworkspace\b/.test(raw)) return { commandId: 'nav-workspace' };
            if (/\bassets\b/.test(raw)) return { commandId: 'nav-assets' };
            if (/\bemployees\b/.test(raw)) return { commandId: 'nav-employees-page' };
            if (/\badmin\b/.test(raw)) return { commandId: 'nav-admin' };
            if (/\bplan\b/.test(raw) && !/\bproject\b/.test(raw)) return { commandId: 'nav-plan' };
            if (/\bbuild\b/.test(raw)) return { commandId: 'nav-build' };
            if (/\brun\b/.test(raw)) return { commandId: 'nav-run' };
            if (/\b(create|new|add)\s+(?:a\s+)?project\b/.test(raw)) return { commandId: 'create-project' };
            if (/\b(close|cancel|dismiss)\b/.test(raw)) return { commandId: 'close-inspector' };
            return { commandId: '' };
        },
    },
];

export function parseIntent(transcript: string): ParsedIntent {
    const normalize = (s: string) => s.toLowerCase()
        .replace(/\b(the|task|item|a|an|please|can|you|ready|mark)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const cleaned = normalize(transcript);

    if (!cleaned) {
        return { type: 'UNKNOWN', confidence: 0, slots: {}, rawTranscript: transcript };
    }

    for (const rule of rules) {
        for (const pattern of rule.patterns) {
            const match = transcript.match(pattern) || cleaned.match(pattern);
            if (match) {
                const intent = {
                    type: rule.type,
                    confidence: 0.9,
                    slots: rule.extractSlots(match),
                    rawTranscript: transcript,
                };
                return intent;
            }
        }
    }

    return { type: 'UNKNOWN', confidence: 0, slots: {}, rawTranscript: transcript };
}
