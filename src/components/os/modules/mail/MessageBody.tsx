'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * An email's HTML, shown in a frame that cannot run scripts, load anything from the web or navigate away.
 * (The server already sanitized it and removed remote images; this is the second wall.)
 */
export default function MessageBody({ html, text }: { html: string; text: string }) {
    const frame = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(120);

    useEffect(() => {
        const el = frame.current;
        if (!el || !html) return;
        const measure = () => {
            const doc = el.contentDocument;
            if (doc?.body) setHeight(Math.min(Math.max(doc.body.scrollHeight + 16, 60), 4000));
        };
        el.addEventListener('load', measure);
        const timer = window.setTimeout(measure, 300);
        return () => {
            el.removeEventListener('load', measure);
            window.clearTimeout(timer);
        };
    }, [html]);

    if (!html) return <pre className="whitespace-pre-wrap break-words text-sm font-sans text-text-primary">{text || '(no content)'}</pre>;

    const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'"><style>body{margin:0;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#e5e7eb;word-wrap:break-word}@media (prefers-color-scheme:light){body{color:#111827}blockquote{color:#4b5563}}a{color:#60a5fa}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:8px 0;padding-left:10px;border-left:3px solid #4b5563;color:#9ca3af}</style></head><body>${html}</body></html>`;
    return <iframe ref={frame} title="Message" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height }} className="w-full border-0 bg-transparent" />;
}
