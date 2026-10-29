'use client';
import { useState } from 'react';
export type SocialImage = { id: string; url: string; alt: string };
export default function PublishingImagePicker({ companyId, image, onChange, onBusy }: { companyId: string; image: SocialImage | null; onChange: (image: SocialImage | null) => void; onBusy: (busy: boolean) => void }) {
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); onBusy(true); setError('');
    try {
      const form = new FormData(); form.set('companyId', companyId); form.set('file', file); form.set('alt', alt);
      const response = await fetch('/api/os/jobs/publishing-image', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Upload failed.');
      onChange(body.image);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); onBusy(false); }
  }
  return <section className="space-y-2">
    <h4 className="ui-kicker">Reusable social image</h4>
    <p className="text-xs text-text-secondary">Used with every post from this automation. PNG, JPEG or WebP, up to 3 MB.</p>
    {image ? <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.alt} className="max-h-48 max-w-full rounded" />
      <button type="button" className="ui-button mt-2" onClick={() => onChange(null)}>Remove image</button>
    </div> : null}
    <label className="block text-xs">Image description (accessibility)
      <input className="ui-control w-full" value={alt} onChange={e => setAlt(e.target.value)} maxLength={1000} placeholder="Describe the graphic and its text" />
    </label>
    <input aria-label="Upload reusable social image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !alt.trim()} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
    {busy ? <p className="text-xs">Uploading image…</p> : null}
    {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
  </section>;
}
