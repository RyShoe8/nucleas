'use client';

import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import type { ParsedIntent } from '@/lib/voice/IntentParser';
import type { PendingIntentConfirmation } from '@/components/intent/IntentConfirmationContext';

export type { PendingIntentConfirmation };

function intentNeedsProject(intent: ParsedIntent): boolean {
  if (intent.type === 'ADD_TASK' || intent.type === 'BATCH_ADD_TASKS') {
    return !intent.slots.projectId?.trim() && !intent.slots.projectName?.trim();
  }
  if (intent.type === 'CREATE_CONTENT') {
    return !intent.slots.projectId?.trim() && !intent.slots.project_name?.trim();
  }
  return false;
}

function formatContextSummary(ctx: PendingIntentConfirmation['contextSnapshot']): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.view.lens === 'os') return [ctx.os?.companyName || 'All companies', ctx.os?.section || ctx.os?.moduleId].filter(Boolean).join(' · ');
  if (ctx.projectName) parts.push(`Project: ${ctx.projectName}`);
  else if (ctx.projectId) parts.push(`Project id: ${ctx.projectId}`);
  if (ctx.phase) parts.push(`Phase: ${ctx.phase}`);
  parts.push(`Lens: ${ctx.view.lens}`);
  parts.push(`Page: ${ctx.view.pathname}`);
  parts.push(`Today (local): ${ctx.referenceDate}`);
  return parts.join(' · ');
}

interface VoiceIntentConfirmModalProps {
  open: boolean;
  pending: PendingIntentConfirmation | null;
  onConfirm: () => void;
  onCancel: () => void;
  onPatchSlots: (partial: Record<string, string>) => void;
}

export default function VoiceIntentConfirmModal({
  open,
  pending,
  onConfirm,
  onCancel,
  onPatchSlots,
}: VoiceIntentConfirmModalProps) {
  if (!pending) return null;

  const needProject = intentNeedsProject(pending.intent);
  const projects = pending.contextSnapshot?.projects ?? [];
  const summary = pending.intent.type === 'OS_NAVIGATE'
    ? [pending.intent.slots.companyQuery || pending.intent.slots.companyName, pending.intent.slots.section || pending.intent.slots.tool || pending.intent.slots.moduleId, pending.intent.slots.period ? `${pending.intent.slots.period} days` : ''].filter(Boolean).join(' · ')
    : formatContextSummary(pending.contextSnapshot);

  const selectedProjectId = pending.intent.slots.projectId?.trim() ?? '';

  const canConfirm = !needProject || (!!selectedProjectId && projects.length > 0);
  const os = ['OS_NAVIGATE', 'ASK_NUCLEAS'].includes(pending.intent.type);
  const asking = pending.intent.type === 'ASK_NUCLEAS';

  return (
    <Modal isOpen={open} onClose={onCancel} title={os ? asking ? 'Send to Ask Nucleas' : 'Open workspace' : 'Confirm action'} maxWidth="md" appearance={os ? 'theme' : 'light'} stackAboveOverlays>
      <div className="space-y-4">
        {!os && <p className="text-sm text-text-secondary">
          Source:{' '}
          <span className="text-text-primary font-medium">
            {pending.parseSource} ({pending.origin})
          </span>
        </p>}
        {summary && (
          <div>
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">
              {os ? 'Workspace' : 'Current context'}
            </p>
            <p className="text-sm text-text-primary">{summary}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">
            {pending.origin === 'voice' ? 'Transcript' : 'Your command'}
          </p>
          {asking ? <textarea aria-label="Your request" className="ui-control min-h-28 w-full text-base" value={pending.intent.slots.text ?? pending.sourceText} onChange={e => onPatchSlots({ text: e.target.value })} /> : <p className="text-sm text-text-primary italic break-words">&ldquo;{pending.sourceText}&rdquo;</p>}
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-text-secondary">Command details</summary>
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">Parsed intent</p>
          <pre className="text-xs bg-background-secondary border border-border rounded-lg p-3 overflow-x-auto max-h-48 text-text-primary">
            {JSON.stringify({ type: pending.intent.type, slots: pending.intent.slots }, null, 2)}
          </pre>
        </details>
        {asking && <p className="text-sm text-text-secondary">Uses your current Ask mode and model level. Work agreements and external changes still follow their normal review steps.</p>}

        {needProject && projects.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Select a project (required)
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                const id = e.target.value;
                const p = projects.find((x) => x.id === id);
                if (pending.intent.type === 'ADD_TASK' || pending.intent.type === 'BATCH_ADD_TASKS') {
                  onPatchSlots({ projectId: id, projectName: p?.name ?? '' });
                } else if (pending.intent.type === 'CREATE_CONTENT') {
                  onPatchSlots({
                    projectId: id,
                    project_name: p?.name ?? '',
                  });
                }
              }}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background-card text-text-primary text-sm"
            >
              <option value="">Choose project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {needProject && projects.length === 0 && (
          <p className="text-sm text-error">No projects available — create a project first.</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={onConfirm} disabled={!canConfirm || (asking && !pending.intent.slots.text?.trim())}>
            {os ? asking ? 'Send request' : 'Open' : 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
