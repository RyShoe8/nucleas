'use client';

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { upload } from '@vercel/blob/client';

export interface AttachmentRef {
    pathname: string;
    name: string;
    mime: string;
    size: number;
    access: 'private' | 'public';
}

type Pending = {
    id: string;
    file: File;
    status: 'uploading' | 'ready' | 'error';
    progress: number;
    ref?: AttachmentRef;
    error?: string;
};

const HEIGHT_KEY = 'nucleas.os.assistant.inputHeight';
const MIN_HEIGHT = 44;
const DEFAULT_HEIGHT = 64;
const MAX_FILES = 6;
const ACCEPT = '.txt,.md,.csv,.tsv,.json,.jsonl,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.sql,.yml,.yaml,.toml,.log,.sh,.pdf,image/*,text/*';

function readHeight(): number {
    try {
        const v = Number(window.localStorage.getItem(HEIGHT_KEY));
        return Number.isFinite(v) && v >= MIN_HEIGHT ? v : DEFAULT_HEIGHT;
    } catch {
        return DEFAULT_HEIGHT;
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeName(name: string): string {
    return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
}

let userIdPromise: Promise<string | null> | null = null;
function currentUserId(): Promise<string | null> {
    userIdPromise ??= fetch('/api/auth/me', { cache: 'no-store' })
        .then((r) => r.json())
        .then((b: { id?: string } | null) => b?.id ?? null)
        .catch(() => null);
    return userIdPromise;
}

/**
 * The Ask input: a text box you can make taller by dragging its top edge, plus file attachments
 * (button, drag and drop, or paste). Files upload straight to storage as soon as they are added.
 */
export default function AskComposer({
    disabled,
    busy,
    placeholder,
    onSend,
}: {
    disabled: boolean;
    busy: boolean;
    placeholder: string;
    onSend: (text: string, attachments: AttachmentRef[]) => Promise<boolean>;
}) {
    const [text, setText] = useState('');
    const [files, setFiles] = useState<Pending[]>([]);
    const [height, setHeight] = useState(() => (typeof window === 'undefined' ? DEFAULT_HEIGHT : readHeight()));
    const [dragging, setDragging] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const drag = useRef<{ startY: number; startHeight: number } | null>(null);
    const filesRef = useRef<Pending[]>([]);

    useEffect(() => {
        filesRef.current = files;
    }, [files]);

    // ---- resize by dragging the handle above the text box
    const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startY: e.clientY, startHeight: height };
    };
    const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        const max = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.7));
        setHeight(Math.min(max, Math.max(MIN_HEIGHT, drag.current.startHeight + (drag.current.startY - e.clientY))));
    };
    const onHandleUp = () => {
        if (!drag.current) return;
        drag.current = null;
        try {
            window.localStorage.setItem(HEIGHT_KEY, String(height));
        } catch {
            // Per-browser convenience only.
        }
    };

    // ---- attachments
    const addFiles = async (list: FileList | File[]) => {
        const incoming = Array.from(list);
        if (!incoming.length) return;
        const userId = await currentUserId();
        if (!userId) {
            setNotice('Sign in again to attach files.');
            return;
        }
        const room = Math.max(0, MAX_FILES - filesRef.current.length);
        if (incoming.length > room) setNotice(`Attach at most ${MAX_FILES} files per message.`);
        const accepted: Pending[] = incoming.slice(0, room).map((file) => ({ id: crypto.randomUUID(), file, status: 'uploading', progress: 0 }));
        filesRef.current = [...filesRef.current, ...accepted];
        setFiles((current) => [...current, ...accepted]);
        for (const p of accepted) void startUpload(p, userId);
    };

    const startUpload = async (p: Pending, userId: string) => {
        const update = (patch: Partial<Pending>) => setFiles((list) => list.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
        const pathname = `ask/${userId}/${Date.now()}-${safeName(p.file.name)}`;
        const attempt = (access: 'private' | 'public') =>
            upload(pathname, p.file, {
                access,
                handleUploadUrl: '/api/os/assistant/upload',
                contentType: p.file.type || undefined,
                multipart: p.file.size > 8 * 1024 * 1024,
                onUploadProgress: (e) => update({ progress: Math.round(e.percentage) }),
            });
        try {
            let access: 'private' | 'public' = 'private';
            let blob;
            try {
                blob = await attempt('private');
            } catch {
                // A store that only takes public uploads: the name is unguessable and the file is
                // deleted as soon as the message is read.
                access = 'public';
                blob = await attempt('public');
            }
            update({ status: 'ready', progress: 100, ref: { pathname: blob.pathname, name: p.file.name, mime: p.file.type, size: p.file.size, access } });
        } catch (error) {
            update({ status: 'error', error: error instanceof Error ? error.message : 'Upload failed.' });
        }
    };

    const remove = (p: Pending) => {
        setFiles((list) => list.filter((x) => x.id !== p.id));
        if (p.ref) {
            void fetch('/api/os/assistant/upload', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pathname: p.ref.pathname }) });
        }
    };

    const uploading = files.some((f) => f.status === 'uploading');
    const ready = files.filter((f) => f.status === 'ready' && f.ref).map((f) => f.ref!);
    const canSend = !disabled && !busy && !uploading && (text.trim().length > 0 || ready.length > 0);

    const submit = async (e?: FormEvent) => {
        e?.preventDefault();
        if (!canSend) return;
        // Clear straight away (the answer can take minutes); put it back only if sending failed.
        const sentText = text;
        const sentFiles = files;
        setText('');
        setFiles([]);
        setNotice(null);
        const sent = await onSend(sentText, ready);
        if (!sent) {
            setText((current) => current || sentText);
            setFiles((current) => (current.length ? current : sentFiles));
        }
    };

    const onDrop = (e: DragEvent<HTMLFormElement>) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled && e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
    };

    return (
        <form
            onSubmit={submit}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    setDragging(true);
                }
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`border-t ${dragging ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
            <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize the message box"
                title="Drag to resize"
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                className="h-2 cursor-row-resize flex items-center justify-center touch-none group"
            >
                <span className="h-0.5 w-10 rounded bg-border group-hover:bg-primary/60" />
            </div>
            <div className="px-3 pb-3 space-y-2">
                {files.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                        {files.map((f) => (
                            <li
                                key={f.id}
                                className={`inline-flex items-center gap-1 max-w-[220px] text-[11px] px-2 py-0.5 rounded border ${f.status === 'error' ? 'border-red-400/50 text-red-400' : 'border-border'}`}
                                title={f.error ?? `${f.file.name} · ${formatSize(f.file.size)}`}
                            >
                                <span aria-hidden>{f.file.type.startsWith('image/') ? '🖼️' : '📄'}</span>
                                <span className="truncate">{f.file.name}</span>
                                <span className="text-text-secondary flex-shrink-0">
                                    {f.status === 'uploading' ? `${f.progress}%` : f.status === 'error' ? 'failed' : formatSize(f.file.size)}
                                </span>
                                <button type="button" onClick={() => remove(f)} aria-label={`Remove ${f.file.name}`} className="text-text-secondary hover:text-text-primary flex-shrink-0">
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : null}
                {notice ? <p className="text-[11px] text-amber-400">{notice}</p> : null}
                <div className="flex gap-2 items-stretch">
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={disabled || files.length >= MAX_FILES}
                        title="Attach files (or drop them here, or paste an image)"
                        aria-label="Attach files"
                        className="px-2 rounded border border-border hover:bg-background-card disabled:opacity-50 self-end h-8"
                    >
                        📎
                    </button>
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files) void addFiles(e.target.files);
                            e.target.value = '';
                        }}
                    />
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void submit();
                            }
                        }}
                        onPaste={(e) => {
                            const pasted = Array.from(e.clipboardData.files);
                            if (pasted.length) {
                                e.preventDefault();
                                void addFiles(pasted);
                            }
                        }}
                        placeholder={placeholder}
                        disabled={disabled}
                        style={{ height }}
                        className="flex-1 min-w-0 px-2 py-1.5 rounded border border-border bg-background-elevated text-sm resize-none"
                    />
                    <button type="submit" disabled={!canSend} className="px-3 rounded bg-primary text-white text-sm disabled:opacity-50 self-end h-8">
                        {busy ? '…' : uploading ? 'Uploading…' : 'Ask'}
                    </button>
                </div>
            </div>
        </form>
    );
}
