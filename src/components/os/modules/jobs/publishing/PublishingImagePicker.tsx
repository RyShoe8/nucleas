'use client';
import { useEffect, useRef, useState } from 'react';
export type SocialImage = { id: string; url: string; alt: string };

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 3_000_000;

/**
 * A reusable image for a social publishing job. Choosing a file always works; it uploads once it has a
 * description (needed for accessibility), and says so instead of silently refusing.
 */
export default function PublishingImagePicker({ companyId, image, onChange, onBusy }: { companyId: string; image: SocialImage | null; onChange: (image: SocialImage | null) => void; onBusy: (busy: boolean) => void }) {
  const [alt, setAlt] = useState('');
  const [pending, setPending] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choose = (file?: File) => {
    setError('');
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError('Choose a PNG, JPEG or WebP image.');
    if (file.size > MAX_BYTES) return setError(`That image is ${(file.size / 1_000_000).toFixed(1)} MB. Use one under 3 MB.`);
    setPending(file);
    setPreview(URL.createObjectURL(file));
  };

  async function upload() {
    if (!pending) return;
    if (!alt.trim()) return setError('Describe the image first (what it shows and any text on it), then upload.');
    setBusy(true); onBusy(true); setError('');
    try {
      const form = new FormData(); form.set('companyId', companyId); form.set('file', pending); form.set('alt', alt.trim());
      const response = await fetch('/api/os/jobs/publishing-image', { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as { image?: SocialImage; error?: string };
      if (!response.ok || !body.image) throw new Error(body.error || (response.status === 413 ? 'That image is too large. Use one under 3 MB.' : `Upload failed (${response.status}).`));
      onChange(body.image);
      setPending(null);
      setPreview(null);
      setAlt('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); onBusy(false); }
  }

  return <section className="space-y-2">
    <h4 className="ui-kicker">Reusable social image (optional)</h4>
    <p className="text-xs text-text-secondary">Used with every post from this automation. PNG, JPEG or WebP, up to 3 MB.</p>
    {image ? <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.alt} className="max-h-48 max-w-full rounded" />
      <button type="button" className="ui-button mt-2" onClick={() => onChange(null)}>Remove image</button>
    </div> : <>
      <input ref={input} type="file" accept={TYPES.join(',')} className="hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="max-h-48 max-w-full rounded" />
      ) : null}
      {pending ? <label className="block text-xs">Image description (needed for accessibility)
        <input className="ui-control w-full" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={1000} placeholder="Describe the graphic and its text" autoFocus />
      </label> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-button" disabled={busy} onClick={() => input.current?.click()}>{pending ? 'Choose a different image' : 'Choose image'}</button>
        {pending ? <button type="button" className="ui-button-primary" disabled={busy || !alt.trim()} title={alt.trim() ? undefined : 'Describe the image first'} onClick={() => void upload()}>{busy ? 'Uploading…' : 'Upload image'}</button> : null}
        {pending && !busy ? <button type="button" className="ui-button" onClick={() => { setPending(null); setPreview(null); setError(''); }}>Cancel</button> : null}
      </div>
    </>}
    {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
  </section>;
}
