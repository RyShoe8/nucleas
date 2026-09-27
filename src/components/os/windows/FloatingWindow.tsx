'use client';

import { type ReactNode, useCallback, useRef, useState } from 'react';
import type { ModuleDefinition, WindowState } from '@/lib/os/types';
import { clampToViewport } from '@/lib/os/clampToViewport';
import { windowLabel } from '@/lib/os/windowLabel';
import {
    isNearPopoutEdge,
    isPointerOutsideOsViewport,
    pointerToScreenPlacement,
    shouldTriggerTearOffPopout,
    windowToScreenPlacement,
} from '@/lib/os/tearOffPopout';
import { getOsViewportBounds, OS_INSET_BOTTOM, OS_INSET_TOP } from '@/lib/os/viewportBounds';
import { useWindowManager } from '@/hooks/os/useWindowManager';
import { useDraggable } from './useDraggable';
import { useResizable } from './useResizable';

interface FloatingWindowProps {
    window: WindowState;
    module: ModuleDefinition;
    children: ReactNode;
}

export default function FloatingWindow({ window: w, module, children }: FloatingWindowProps) {
    const wm = useWindowManager();
    const [popoutError, setPopoutError] = useState<string | null>(null);
    const [nearEdge, setNearEdge] = useState(false);
    const nearEdgeRef = useRef(false);
    const grabOffsetRef = useRef({ x: 0, y: 0 });

    const handleDrag = useCallback(
        (x: number, y: number) => {
            const clamped = clampToViewport(
                { x, y, width: w.width, height: w.height },
                getOsViewportBounds()
            );
            wm.move(w.id, clamped.x, clamped.y);
            if (module.canPopout && !w.poppedOut) {
                const edge = isNearPopoutEdge(clamped.x, clamped.y, w.width, w.height);
                nearEdgeRef.current = edge;
                setNearEdge(edge);
            }
        },
        [wm, w.id, w.width, w.height, w.poppedOut, module.canPopout]
    );

    const handleDragStart = useCallback(() => {
        wm.focus(w.id);
        nearEdgeRef.current = false;
        setNearEdge(false);
    }, [wm, w.id]);

    const handleDragEnd = useCallback(
        (x: number, y: number, event: PointerEvent) => {
            const wasNearEdge = nearEdgeRef.current;
            nearEdgeRef.current = false;
            setNearEdge(false);
            if (!module.canPopout || w.poppedOut || w.maximized) return;

            const clamped = clampToViewport(
                { x, y, width: w.width, height: w.height },
                getOsViewportBounds()
            );

            if (
                !shouldTriggerTearOffPopout(
                    event.clientX,
                    event.clientY,
                    clamped.x,
                    clamped.y,
                    w.width,
                    w.height,
                    wasNearEdge
                )
            ) {
                return;
            }

            const placement = isPointerOutsideOsViewport(event.clientX, event.clientY)
                ? pointerToScreenPlacement(
                      event.clientX,
                      event.clientY,
                      grabOffsetRef.current.x,
                      grabOffsetRef.current.y
                  )
                : windowToScreenPlacement(clamped.x, clamped.y);
            const ok = wm.popOut(w.id, { placement });
            setPopoutError(ok ? null : 'Allow pop-ups for this site to pop out modules.');
        },
        [wm, w.id, w.poppedOut, w.maximized, w.width, w.height, module.canPopout]
    );

    const handleResize = useCallback(
        (width: number, height: number) => {
            const clamped = clampToViewport(
                { x: w.x, y: w.y, width, height },
                getOsViewportBounds()
            );
            wm.move(w.id, clamped.x, clamped.y);
            wm.resize(w.id, clamped.width, clamped.height);
        },
        [wm, w.id, w.x, w.y]
    );

    const { onPointerDown: draggablePointerDown, dragging } = useDraggable({
        x: w.x,
        y: w.y,
        onDragStart: handleDragStart,
        onDrag: handleDrag,
        onDragEnd: handleDragEnd,
        disabled: w.maximized,
    });

    const onHeaderPointerDown = useCallback(
        (e: React.PointerEvent<HTMLElement>) => {
            grabOffsetRef.current = {
                x: e.clientX - w.x,
                y: e.clientY - w.y,
            };
            draggablePointerDown(e);
        },
        [w.x, w.y, draggablePointerDown]
    );

    const { onPointerDown: onResizePointerDown, resizing } = useResizable({
        width: w.width,
        height: w.height,
        minWidth: module.minSize.width,
        minHeight: module.minSize.height,
        onResize: handleResize,
        disabled: w.maximized,
    });

    const focusOnInteraction = useCallback(() => {
        if (wm.activeWindowId !== w.id) {
            wm.focus(w.id);
        }
    }, [wm, w.id]);

    const isActive = wm.activeWindowId === w.id;
    const windowTitle = windowLabel(w, module);

    const style: React.CSSProperties = w.maximized
        ? {
              left: 0,
              top: OS_INSET_TOP,
              width: '100%',
              height: `calc(100vh - ${OS_INSET_TOP}px - ${OS_INSET_BOTTOM}px)`,
              zIndex: w.zIndex,
          }
        : {
              transform: `translate(${w.x}px, ${w.y}px)`,
              width: w.width,
              height: w.height,
              zIndex: w.zIndex,
          };

    return (
        <div
            role="dialog"
            aria-label={windowTitle}
            className={`absolute ${w.maximized ? '' : 'top-0 left-0'} bg-background-card border rounded-lg shadow-2xl flex flex-col overflow-hidden select-none ${
                isActive ? 'border-primary/40' : 'border-border'
            } ${nearEdge && dragging ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-transparent' : ''} ${
                dragging || resizing ? '' : 'transition-shadow'
            }`}
            style={style}
            onPointerDown={focusOnInteraction}
        >
            <div
                onPointerDown={onHeaderPointerDown}
                onDoubleClick={() => wm.maximize(w.id)}
                title={module.canPopout ? 'Drag outside window to pop out' : undefined}
                className={`flex items-center gap-2 px-3 h-9 border-b border-border ${
                    w.maximized ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                } ${isActive ? 'bg-background-elevated' : 'bg-background-card'}`}
            >
                <span className="text-sm leading-none" aria-hidden>
                    {module.icon}
                </span>
                <span className="flex-1 text-sm font-medium text-text-primary truncate">{windowTitle}</span>
                {module.canPopout && !w.poppedOut && (
                    <WindowButton
                        label="Pop out"
                        onClick={(e) => {
                            e.stopPropagation();
                            const ok = wm.popOut(w.id);
                            setPopoutError(ok ? null : 'Allow pop-ups for this site to pop out modules.');
                        }}
                    >
                        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                            <rect x="2" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M5 5 L8 2 M8 2 H6 M8 2 V4" fill="none" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                    </WindowButton>
                )}
                <WindowButton
                    label="Minimize"
                    onClick={(e) => {
                        e.stopPropagation();
                        wm.minimize(w.id);
                    }}
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                        <line x1="2" y1="8" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                </WindowButton>
                <WindowButton
                    label={w.maximized ? 'Restore' : 'Maximize'}
                    onClick={(e) => {
                        e.stopPropagation();
                        wm.maximize(w.id);
                    }}
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                        <rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                </WindowButton>
                <WindowButton
                    label="Close"
                    danger
                    onClick={(e) => {
                        e.stopPropagation();
                        wm.close(w.id);
                    }}
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                        <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" />
                        <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                </WindowButton>
            </div>

            <div className="flex-1 min-h-0 overflow-auto bg-background text-text-primary">
                {popoutError && (
                    <div className="px-3 py-2 text-xs text-amber-300 bg-amber-950/40 border-b border-amber-900/50">
                        {popoutError}
                    </div>
                )}
                {children}
            </div>

            {!w.maximized && (
                <div
                    onPointerDown={onResizePointerDown}
                    aria-label="Resize"
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                    style={{
                        background:
                            'linear-gradient(135deg, transparent 0%, transparent 50%, rgb(82 82 91) 50%, rgb(82 82 91) 60%, transparent 60%, transparent 75%, rgb(82 82 91) 75%, rgb(82 82 91) 85%, transparent 85%)',
                    }}
                />
            )}
        </div>
    );
}

interface WindowButtonProps {
    label: string;
    danger?: boolean;
    onClick: (e: React.MouseEvent) => void;
    children: ReactNode;
}

function WindowButton({ label, onClick, danger, children }: WindowButtonProps) {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            onPointerDown={(e) => e.stopPropagation()}
            className={`w-6 h-6 inline-flex items-center justify-center rounded text-text-secondary hover:text-text-primary ${
                danger ? 'hover:bg-error' : 'hover:bg-background-elevated'
            }`}
        >
            {children}
        </button>
    );
}
