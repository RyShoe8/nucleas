'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { IdeRunActivity } from '@/lib/ide/idePlan';
import type { IdeDioramaDesk } from '@/lib/ide/ideChatThreadCache';

type Props = {
  activity: IdeRunActivity;
};

const FLOOR = '#d8e4f0';
const FLOOR_LINE = '#b8c8dc';
const WALL_A = '#91ad98';
const WALL_B = '#6eb8c8';
const DESK = '#e4ebe0';
const CHAIR = '#528769';
const SKIN = '#e8c4a8';

/** Readable isometric workstation on shared floor. */
function IsoDesk({
  desk,
  busy,
  reducedMotion,
  style,
}: {
  desk: IdeDioramaDesk;
  busy: boolean;
  reducedMotion: boolean;
  style: CSSProperties;
}) {
  const typing = busy && (desk.status === 'active' || desk.active) && !reducedMotion;
  const done = desk.status === 'done';
  return (
    <div className="absolute flex flex-col items-center" style={style}>
      <p
        className="mb-0.5 max-w-[9rem] truncate rounded bg-white/90 px-1.5 font-mono text-[11px] font-semibold leading-tight text-[#203b3b] shadow-sm"
        title={desk.modelLabel}
      >
        {desk.modelLabel}
      </p>
      {desk.activityLabel ? (
        <p
          className={`mb-1 max-w-[9rem] line-clamp-2 rounded px-1.5 py-0.5 font-mono text-sm font-semibold leading-snug shadow-sm ${
            typing
              ? 'bg-[#14242a]/90 text-[#a8e8f0]'
              : done
                ? 'bg-[#14242a]/80 text-[#8fd4a8]'
                : 'bg-[#14242a]/75 text-[#e3eee8]'
          }`}
          title={desk.activityLabel}
        >
          {desk.activityLabel}
        </p>
      ) : null}
      <div className="relative h-[3.75rem] w-[5.25rem]" style={{ imageRendering: 'pixelated' }}>
        {/* Chair back */}
        <div
          className="absolute bottom-1 left-[0.35rem] h-5 w-3 rounded-t-sm border border-[#3d6955]"
          style={{ background: CHAIR, transform: 'skewY(-8deg)' }}
        />
        {/* Desk top */}
        <div
          className="absolute bottom-4 left-2 right-1 h-3.5 border border-[#bed1c4]"
          style={{ background: DESK, transform: 'skewX(-22deg)' }}
        />
        {/* Desk legs */}
        <div className="absolute bottom-1 left-3 h-3 w-1 bg-[#a1b5a7]" />
        <div className="absolute bottom-1 right-2 h-3 w-1 bg-[#a1b5a7]" />
        {/* Figure */}
        <div
          className="absolute bottom-[1.35rem] left-[0.55rem] h-2 w-2 rounded-sm"
          style={{ background: SKIN }}
        />
        <div
          className={`absolute bottom-2 left-1.5 h-3 w-2.5 rounded-sm ${typing ? 'animate-pulse' : ''}`}
          style={{ background: CHAIR }}
        />
        {typing ? (
          <>
            <div
              className="absolute bottom-[1.15rem] left-[1.35rem] h-0.5 w-2 origin-left animate-bounce"
              style={{ background: SKIN }}
            />
            <div
              className="absolute bottom-[1.15rem] left-[1.85rem] h-0.5 w-2 origin-left animate-bounce [animation-delay:120ms]"
              style={{ background: SKIN }}
            />
          </>
        ) : null}
        {/* Monitor */}
        <div className="absolute bottom-[1.65rem] left-[2.1rem] w-8 border-2 border-[#203b3b] bg-[#14242a] p-0.5">
          <div
            className={`relative h-4 overflow-hidden ${
              typing
                ? 'bg-[#00c2e0]'
                : done
                  ? 'bg-[#3d9b6a]'
                  : desk.active
                    ? 'bg-[#008fa6]'
                    : 'bg-[#4a6080]'
            }`}
          >
            {typing ? (
              <div className="absolute inset-x-0.5 top-0.5 space-y-0.5">
                <div className="h-0.5 animate-pulse bg-white/90" />
                <div className="h-0.5 w-4/5 animate-pulse bg-white/70 [animation-delay:100ms]" />
                <div className="h-0.5 w-3/5 animate-pulse bg-white/60 [animation-delay:200ms]" />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-[7px] text-white/80">
                {done ? 'ok' : desk.active ? '…' : 'z'}
              </div>
            )}
          </div>
        </div>
        <div className="absolute bottom-[1.45rem] left-[3.4rem] h-1 w-1.5 bg-[#203b3b]" />
      </div>
    </div>
  );
}

function deskPositions(count: number): CSSProperties[] {
  if (count <= 1) {
    return [{ left: '38%', bottom: '10%' }];
  }
  if (count === 2) {
    return [
      { left: '18%', bottom: '14%' },
      { left: '48%', bottom: '8%' },
    ];
  }
  return [
    { left: '8%', bottom: '18%' },
    { left: '34%', bottom: '8%' },
    { left: '58%', bottom: '16%' },
  ];
}

/** Full-bleed isometric Nucleas Office — client-only, zero model usage. */
export default function IdeRunScene({ activity }: Props) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const desks =
    activity.desks && activity.desks.length > 0
      ? activity.desks
      : [{ role: 'direct' as const, modelLabel: 'Model', active: activity.busy, status: activity.busy ? ('active' as const) : ('idle' as const) }];
  const positions = deskPositions(desks.length);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return (
    <div
      className="relative h-36 shrink-0 overflow-hidden border-t border-[#547b65]"
      style={{
        imageRendering: 'pixelated',
        background: 'linear-gradient(180deg, #c4d8cb 0%, #b0c8d8 42%, #d8e4f0 42%, #c8d4e4 100%)',
      }}
      aria-live="polite"
    >
      {/* Back wall tiles */}
      <div
        className="absolute inset-x-0 top-0 h-[42%]"
        style={{
          background: `repeating-linear-gradient(90deg, ${WALL_A} 0 14px, ${WALL_B} 14px 28px)`,
        }}
      />
      <div
        className="absolute inset-x-0 top-[42%] h-px bg-[#446b59]/80"
        aria-hidden
      />

      {/* Side wall */}
      <div
        className="absolute left-0 top-0 h-[42%] w-[14%] border-r-2 border-[#446b59]"
        style={{
          background: `repeating-linear-gradient(180deg, ${WALL_A} 0 10px, #6c987c 10px 20px)`,
          clipPath: 'polygon(0 0, 100% 6%, 100% 100%, 0 94%)',
        }}
      />

      {/* NUCLEAS OFFICE sign */}
      <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded border-2 border-[#203b3b] bg-[#14242a] px-2 py-0.5 shadow">
        <p className="font-mono text-[10px] font-bold tracking-wide">
          <span className="text-[#9dcdb6]">NUCLEAS</span>{' '}
          <span className="text-[#00c2e0]">OFFICE</span>
        </p>
      </div>

      {/* Isometric floor */}
      <div
        className="absolute inset-x-[-8%] bottom-0 h-[62%]"
        style={{
          backgroundColor: FLOOR,
          backgroundImage: `
            linear-gradient(30deg, ${FLOOR_LINE} 1px, transparent 1px),
            linear-gradient(150deg, ${FLOOR_LINE} 1px, transparent 1px)
          `,
          backgroundSize: '20px 12px',
          transform: 'perspective(280px) rotateX(52deg)',
          transformOrigin: '50% 100%',
          borderTop: '2px solid #8a9ab0',
        }}
      />

      {/* Cabinets */}
      <div className="absolute bottom-[26%] left-[3%] z-[1] h-9 w-4 border border-[#547b65] bg-[#d0e0d4]">
        <div className="absolute inset-x-0.5 top-1 h-px bg-[#547b65]/60" />
        <div className="absolute inset-x-0.5 top-3 h-px bg-[#547b65]/60" />
        <div className="absolute inset-x-0.5 top-5 h-px bg-[#547b65]/60" />
      </div>
      {/* Plant */}
      <div className="absolute bottom-[28%] left-[9%] z-[1]">
        <div className="mx-auto h-1.5 w-2.5 rounded-sm bg-white" />
        <div className="mx-auto -mt-0.5 h-4 w-3 rounded-t-md bg-[#3d9b6a]" />
      </div>
      {/* Water cooler */}
      <div className="absolute bottom-[30%] right-[18%] z-[1] flex flex-col items-center">
        <div className="h-3 w-2.5 rounded-t-full bg-[#5ec8f0]" />
        <div className="h-4 w-3 border border-[#6a8aa0] bg-[#e8f0f8]" />
      </div>
      {/* Whiteboard */}
      <div className="absolute right-[4%] top-[12%] z-[1] h-8 w-12 border-2 border-[#203b3b] bg-white">
        <div className="absolute left-1 top-1 h-2 w-3 rounded-sm bg-[#528769]/70" />
        <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#00c2e0]/80" />
        <div className="absolute inset-x-1 bottom-1 h-1 bg-[#91ad98]/50" />
      </div>

      {desks.map((desk, index) => (
        <IsoDesk
          key={`${desk.role}-${desk.modelLabel}`}
          desk={desk}
          busy={activity.busy}
          reducedMotion={reducedMotion}
          style={{ ...positions[index] ?? positions[positions.length - 1]!, zIndex: 2 }}
        />
      ))}

      {/* Floor phase (detail lives on desk chips) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-center bg-[#14242a]/75 px-2 py-0.5">
        <p className="truncate font-mono text-[9px] text-[#a8e8f0]" aria-live="polite">
          {activity.label}
        </p>
      </div>
    </div>
  );
}
