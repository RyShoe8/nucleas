/** Company assets retain their editable source; preview formats are not editor documents. */
export function editorForAsset(asset: { id: string; url?: string }, companyId: string) {
  if (!asset.url?.startsWith('/api/os/animation-projects?')) return null;
  const query = new URLSearchParams(asset.url.split('?')[1]);
  if (query.get('companyId') !== companyId || query.get('id') !== asset.id) return null;
  return { moduleId: 'animation', payload: { companyId, assetId: asset.id, tool: 'editor' } };
}
