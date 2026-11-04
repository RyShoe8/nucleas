'use client';

/** The Windows desktop installer, distinct from the older browser-installed PWA. */
export default function OsInstallButton() {
    return <a href="/desktop/download" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-2 text-xs text-text-secondary hover:border-violet-300/40 hover:text-text-primary" title="Download Nucleas for Windows — floating launcher and independent desktop windows">
        <span aria-hidden>↙</span><span>Windows app</span>
    </a>;
}
