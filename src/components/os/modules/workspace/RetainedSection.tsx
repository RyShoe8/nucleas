'use client';
import { Activity, useState, type ReactNode } from 'react';
/** Keep visited editors and filters, while React suspends effects in inactive sections. */
export default function RetainedSection({ active, children }: { active: boolean; children: ReactNode }) {
    const [visited, setVisited] = useState(active);
    if (active && !visited) setVisited(true);
    return active || visited ? <Activity mode={active ? 'visible' : 'hidden'}>{children}</Activity> : null;
}
