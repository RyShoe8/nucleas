'use client';
import { useRef, useState } from 'react';
export type SocialImage = { id: string; url: string; alt: string };

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 3_000_000;

/** "Game_Nights-Image.png" → "Game Nights Image": a description to start from when none was typed. */
export function altFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base || 'Social image';
}

/**
 * A reusable image for a social publishing job. Choosing a file uploads it straight away, so there is no
 * "selected but not uploaded" state to get stuck in. The description (for accessibility) is optional: it
 * uses what was typed, or the file name.
 */
export default function PublishingImagePicker({ companyId, image, onChange, onBusy }: { companyId: string; image: SocialImage | null; onChange: (image: SocialImage | null) => void; onBusy: (busy: boolean) => void }) {
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file?: File) {
    setError('');
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError('Choose a PNG, JPEG or WebP image.');
    if (file.size > MAX_BYTES) return setError(`That image is ${(file.size / 1_000_000).toFixed(1)} MB. Use one under 3 MB.`);
    setBusy(true); onBusy(true);
    try {
      const form = new FormData(); form.set('companyId', companyId); form.set('file', file); form.set('alt', alt.trim() || altFromFileName(file.name));
      const response = await fetch('/api/os/jobs/publishing-image', { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as { image?: SocialImage; error?: string };
      if (!response.ok || !body.image) throw new Error(body.error || (response.status === 413 ? 'That image is too large. Use one under 3 MB.' : `Upload failed (${response.status}).`));
      onChange(body.image);
      setAlt('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); onBusy(false); }
  }

  return <section className="space-y-2">
    <h4 className="ui-kicker">Reusable social image (optional)</h4>
    <p className="text-xs text-text-secondary">Used with every post from this automation. PNG, JPEG or WebP, up to 3 MB.</p>
    {image ? <div className="space-y-2">
      <p role="status" className="text-xs text-emerald-300">Image uploaded and attached. No need to upload it again.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.alt} className="max-h-48 max-w-full rounded" />
      <p className="text-[11px] text-text-secondary">Description: {image.alt}</p>
      <button type="button" className="ui-button" onClick={() => onChange(null)}>Remove image</button>
    </div> : <>
      <input ref={input} type="file" accept={TYPES.join(',')} className="hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      <label className="block text-xs">Image description (optional, for accessibility)
        <input className="ui-control w-full" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={1000} placeholder="What the image shows and any text on it. Leave empty to use the file name." disabled={busy} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
      </label>
      <button type="button" className="ui-button" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Choose and upload image'}</button>
    </>}
    {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
  </section>;
}
