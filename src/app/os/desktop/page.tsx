import { Suspense } from 'react';
import DesktopModule from '@/components/os/desktop/DesktopModule';
export default function DesktopPage() {
    return <Suspense fallback={<div className="p-8 text-text-secondary">Opening Nucleas…</div>}><DesktopModule /></Suspense>;
}
