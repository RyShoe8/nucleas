/** Filament's choice searches and existing-file metadata use POST for read-only lookups. */
export function isReadOnlyFormLookup(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const components = (body as { components?: unknown }).components;
  if (!Array.isArray(components) || !components.length || components.length > 5) return false;
  return components.every((component) => {
    if (!component || typeof component !== 'object') return false;
    const { calls, updates } = component;
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length) return false;
    return Array.isArray(calls) && calls.length > 0 && calls.length <= 5 && calls.every((call) =>
      call?.method === 'callSchemaComponentMethod' && Array.isArray(call.params)
      && typeof call.params[0] === 'string' && call.params[0].startsWith('form.')
      && ['getOptionsForJs', 'getSearchResultsForJs', 'getOptionLabelForJs', 'getUploadedFiles'].includes(call.params[1])
    );
  });
}
