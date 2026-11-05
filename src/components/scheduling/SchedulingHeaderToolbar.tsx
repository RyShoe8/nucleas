'use client';

import Button from '@/components/ui/Button';
import ActionMenu from '@/components/ui/ActionMenu';
import type { CalendarStatus } from '@/hooks/scheduling/useSchedulingCalendar';

interface SchedulingHeaderToolbarProps {
  calendar: CalendarStatus | null;
  onSetAvailability: () => void;
  onDisconnect?: () => void;
  className?: string;
}

export default function SchedulingHeaderToolbar({
  calendar,
  onSetAvailability,
  onDisconnect,
  className = '',
}: SchedulingHeaderToolbarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 min-w-0 ${className}`}>
      {!calendar?.connected ? (
        <a
          href="/api/scheduling/google/connect"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Connect Calendar
        </a>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={onSetAvailability}
        className="shrink-0"
      >
        Availability
      </Button>
      {calendar?.connected && onDisconnect ? (
        <ActionMenu
          align="right"
          width="w-44"
          trigger={({ toggle }) => (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={toggle}
              className="shrink-0 px-2.5"
              aria-label="More scheduling options"
            >
              ⋯
            </Button>
          )}
          items={[{ label: 'Disconnect calendar', onClick: onDisconnect }]}
        />
      ) : null}
    </div>
  );
}
