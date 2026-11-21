/** Browser-to-Rogly transfer; API requests contain metadata only, never the large source body. */
export async function uploadAnimation(companyId: string, bytes: ArrayBuffer, progress: (text: string) => void) {
  const endpoint = `/api/os/animation-projects/upload?companyId=${encodeURIComponent(companyId)}`;
  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw Error(result.error ?? 'Could not save this animation.'); return result;
  };
  progress('Checking source fileâ€¦');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  const upload = await post({ action: 'start', size: bytes.byteLength, sha256 });
  const target = new URL(upload.url);
  if (target.origin !== 'https://s3.rogly.net' || !target.pathname.startsWith('/playbound/nucleas/creative/staging/')) throw Error('Unexpected animation storage destination.');
  progress('Uploading source to private Rogly storageâ€¦');
  const response = await fetch(upload.url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw Error(`Rogly upload failed (${response.status}). Retry saving the project.`);
  progress('Verifying source and saving the new versionâ€¦');
  return post({ action: 'complete', id: upload.id });
}
