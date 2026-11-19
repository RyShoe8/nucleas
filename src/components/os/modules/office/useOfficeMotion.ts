'use client';
import { useEffect, useRef, useState } from 'react';

/** One observer per room, not per employee; no animation timers or render loops. */
export function useOfficeMotion() {
    const ref = useRef<HTMLDivElement>(null);
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
        let inView = false;
        const update = () => setEnabled(inView && !document.hidden && !preference.matches);
        const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
        observer.observe(element);
        document.addEventListener('visibilitychange', update);
        preference.addEventListener('change', update);
        return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); preference.removeEventListener('change', update); };
    }, []);
    return { ref, enabled };
}
