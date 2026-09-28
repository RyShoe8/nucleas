export type MobileNavNode = {
  id: string;
  label: string;
  icon?: string;
  href?: string;
  action?: string;
  children?: MobileNavNode[];
  dynamic?: 'projects' | 'clients';
  requiresManager?: boolean;
  requiresAdmin?: boolean;
};

export const MOBILE_NAV_ROOT: MobileNavNode[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    icon: '🗂️',
    children: [
      {
        id: 'ws-lenses',
        label: 'Views',
        icon: '👁️',
        children: [
          { id: 'lens-schedule', label: 'Projects / Schedule', action: 'onLensSelect:schedule' },
          { id: 'lens-agenda', label: 'Agenda', action: 'onLensSelect:agenda' },
          { id: 'lens-clients', label: 'Clients', action: 'onLensSelect:clients' },
          { id: 'lens-capacity', label: 'Capacity', action: 'onLensSelect:capacity' },
        ],
      },
      {
        id: 'ws-phases',
        label: 'Phases',
        icon: '⚡',
        children: [
          { id: 'phase-all', label: 'All phases', action: 'onPhaseSelect:All' },
          { id: 'phase-plan', label: 'Plan', action: 'onPhaseSelect:Plan' },
          { id: 'phase-build', label: 'Build', action: 'onPhaseSelect:Build' },
          { id: 'phase-run', label: 'Run', action: 'onPhaseSelect:Run' },
          { id: 'phase-schedule', label: 'Schedule', action: 'onPhaseSelect:Schedule' },
        ],
      },
      {
        id: 'ws-create',
        label: 'Create',
        icon: '➕',
        children: [
          { id: 'create-project', label: 'Project', action: 'onCreateProject', requiresManager: true },
          { id: 'create-client', label: 'Client', action: 'onCreateClient', requiresManager: true },
          { id: 'create-task', label: 'Task', action: 'onCreateTask' },
          { id: 'create-content', label: 'Content', action: 'onCreateContent' },
          { id: 'create-meeting', label: 'Meeting', action: 'onCreateMeeting' },
          { id: 'create-screenshot', label: 'Screenshot', action: 'onCreateScreenshot' },
          { id: 'create-recording', label: 'Recording', action: 'onCreateRecord' },
        ],
      },
      {
        id: 'ws-open',
        label: 'Open project or client',
        icon: '📂',
        children: [
          { id: 'dyn-projects', label: 'Projects', dynamic: 'projects' },
          { id: 'dyn-clients', label: 'Clients', dynamic: 'clients' },
        ],
      },
      { id: 'go-workspace', label: 'Go to workspace', icon: '🗂️', href: '/workspace' },
      { id: 'go-ide', label: 'IDE', icon: '🤖', href: '/ide' },
      { id: 'go-ai-attention', label: 'AI needs attention', href: '/workspace/ai-attention' },
    ],
  },
  {
    id: 'app-pages',
    label: 'App',
    icon: '📱',
    children: [
      { id: 'page-workspace', label: 'Workspace', href: '/workspace' },
      { id: 'page-ide', label: 'IDE', href: '/ide' },
      { id: 'page-plan', label: 'Plan', href: '/plan' },
      { id: 'page-build', label: 'Build', href: '/build' },
      { id: 'page-run', label: 'Run', href: '/run' },
      { id: 'page-assets', label: 'Assets', href: '/assets' },
      { id: 'page-employees', label: 'Team', href: '/employees' },
      { id: 'page-billing', label: 'Billing', href: '/billing' },
      { id: 'page-admin', label: 'Admin', href: '/admin', requiresAdmin: true },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: '⚡',
    children: [
      { id: 'tools-index', label: 'All free tools', href: '/tools' },
      { id: 'tools-screenshot', label: 'Screenshot tool', href: '/tools/screenshot' },
      { id: 'tools-recording', label: 'Screen recorder', action: 'onCreateRecord' },
    ],
  },
];

export function resolveNavNodes(
  nodes: MobileNavNode[],
  opts: { isManagerOrAdmin: boolean; isPlatformAdmin: boolean }
): MobileNavNode[] {
  return nodes
    .filter((n) => {
      if (n.requiresAdmin && !opts.isPlatformAdmin) return false;
      if (n.requiresManager && !opts.isManagerOrAdmin) return false;
      return true;
    })
    .map((n) => ({
      ...n,
      children: n.children ? resolveNavNodes(n.children, opts) : undefined,
    }));
}
