'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import MobileNavSheet from '@/components/mobile/MobileNavSheet';
import MobileActionSheet from '@/components/mobile/MobileActionSheet';
import { useMobileShell } from '@/contexts/MobileShellContext';

const MARKETING_PATHS = ['/', '/about', '/pricing', '/features', '/contact'];

function isMarketingPage(pathname: string | null): boolean {
  if (!pathname) return false;
  if (MARKETING_PATHS.includes(pathname)) return true;
  if (pathname.startsWith('/features')) return true;
  return false;
}

function MobileNavVoiceButton() {
  const { voice } = useMobileShell();
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTriggeredRef = useRef(false);
  const [holding, setHolding] = useState(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    if (!voice?.enabled) return;
    holdTriggeredRef.current = false;
    setHolding(true);
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTriggeredRef.current = true;
      voice.toggleWakeWord();
    }, 450);
  }, [voice, clearHoldTimer]);

  const handlePointerUp = useCallback(() => {
    clearHoldTimer();
    setHolding(false);
    if (!voice?.enabled || holdTriggeredRef.current) return;
    if (voice.state === 'listening') {
      voice.stopListening();
    } else {
      voice.startListening();
    }
  }, [voice, clearHoldTimer]);

  const handlePointerLeave = useCallback(() => {
    clearHoldTimer();
    setHolding(false);
  }, [clearHoldTimer]);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  if (!voice?.enabled) return null;

  const wakeActive = voice.wakeWordEnabled || holding;

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
      className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full touch-manipulation transition-colors ${
        voice.state === 'listening'
          ? 'text-red-500'
          : wakeActive
            ? 'text-emerald-500'
            : 'text-text-secondary hover:text-text-primary'
      }`}
      aria-label={
        voice.state === 'listening'
          ? 'Stop listening'
          : wakeActive
            ? 'Wake word on — tap to listen, hold to toggle off'
            : 'Voice — tap to listen, hold to toggle wake word'
      }
    >
      <span
        className={`text-xl mb-0.5 flex items-center justify-center w-9 h-9 rounded-full ${
          voice.state === 'listening'
            ? 'bg-red-500/15 animate-pulse ring-2 ring-red-500/30'
            : wakeActive
              ? 'bg-emerald-500/15 ring-2 ring-emerald-500/40'
              : ''
        }`}
      >
        🎤
      </span>
      <span className="text-[10px] font-medium leading-tight">
        {voice.state === 'listening' ? 'Listening' : wakeActive ? 'Wake on' : 'Voice'}
      </span>
    </button>
  );
}

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { inboxItems, registerReopenActionInbox, voice } = useMobileShell();
  const [navOpen, setNavOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const aiActive =
    pathname?.startsWith('/ide') || pathname?.startsWith('/workspace/ai-attention');

  useEffect(() => {
    registerReopenActionInbox(() => setActionOpen(true));
    return () => registerReopenActionInbox(null);
  }, [registerReopenActionInbox]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setIsPlatformAdmin(!!data?.isAdmin);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isMarketingPage(pathname)) return null;

  const inboxCount = inboxItems.length;
  const showVoice = !!voice?.enabled;

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 max-w-[100vw] overflow-hidden bg-background-card border-t border-border md:hidden z-50 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch h-16">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="flex flex-col items-center justify-center flex-1 min-w-0 h-full text-text-secondary hover:text-text-primary touch-manipulation"
            aria-label="Open menu"
            data-tour="mobile-start-menu"
          >
            <span className="text-xl mb-0.5">☰</span>
            <span className="text-[10px] font-medium">Menu</span>
          </button>

          <Link
            href="/ide"
            className={`flex flex-col items-center justify-center flex-1 min-w-0 h-full touch-manipulation ${
              aiActive ? 'text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
            aria-label="Open the IDE"
          >
            <span className="text-xl mb-0.5">🤖</span>
            <span className="text-[10px] font-medium">IDE</span>
          </Link>

          <button
            type="button"
            onClick={() => setActionOpen(true)}
            className="flex flex-col items-center justify-center flex-1 min-w-0 h-full text-text-secondary hover:text-text-primary touch-manipulation relative"
            aria-label="Open action inbox"
          >
            <span className="text-xl mb-0.5 relative inline-flex">
              ⚡
              {inboxCount > 0 ? (
                <span className="absolute -top-1 right-0 translate-x-1/2 min-w-[16px] h-4 px-1 rounded-full bg-primary text-[9px] font-bold text-white flex items-center justify-center">
                  {inboxCount > 99 ? '99+' : inboxCount}
                </span>
              ) : null}
            </span>
            <span className="text-[10px] font-medium">Action</span>
          </button>

          {showVoice ? <MobileNavVoiceButton /> : null}
        </div>
      </nav>

      <MobileNavSheet
        isOpen={navOpen}
        onClose={() => setNavOpen(false)}
        isPlatformAdmin={isPlatformAdmin}
      />
      <MobileActionSheet isOpen={actionOpen} onClose={() => setActionOpen(false)} />
    </>
  );
}
