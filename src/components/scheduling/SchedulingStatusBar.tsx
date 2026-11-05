'use client';

import Button from '@/components/ui/Button';
import type { CalendarStatus } from '@/hooks/scheduling/useSchedulingCalendar';

interface SchedulingStatusBarProps {
  calendar: CalendarStatus | null;
  syncing: boolean;
  onSync: () => void;
  flashMessage?: string | null;
  onDismissFlash?: () => void;
  className?: string;
}

function formatLastSync(syncedAt: string | null | undefined): string {
  if (!syncedAt) return 'Never synced';
  return new Date(syncedAt).toLocaleString();
}

export default function SchedulingStatusBar({
  calendar,
  syncing,
  onSync,
  flashMessage,
  onDismissFlash,
  className = '',
}: SchedulingStatusBarProps) {
  return (
    <div
      className={`rounded-lg border border-border bg-background-card px-4 py-2.5 text-sm text-text-primary space-y-1.5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          {calendar?.connected ? (
            <>
              <span className="font-medium text-primary shrink-0">Connected</span>
              <span className="text-text-muted shrink-0">·</span>
              <span className="text-text-secondary truncate">
                Last sync: {formatLastSync(calendar.syncedAt)}
              </span>
            </>
          ) : (
            <>
              <span className="text-text-secondary">Google Calendar not connected.</span>
              <a
                href="/api/scheduling/google/connect"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium hover:underline shrink-0"
              >
                Connect Calendar
              </a>
            </>
          )}
        </div>
        {calendar?.connected ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onSync}
            disabled={syncing}
            className="shrink-0"
          >
            {syncing ? 'Syncing…' : 'Sync meetings'}
          </Button>
        ) : null}
      </div>
      {flashMessage ? (
        <div className="flex items-start justify-between gap-2 pt-0.5 border-t border-border/60">
          <span className="text-text-secondary">{flashMessage}</span>
          {onDismissFlash ? (
            <button
              type="button"
              className="text-text-muted hover:text-text-primary text-xs shrink-0"
              onClick={onDismissFlash}
              aria-label="Dismiss message"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
