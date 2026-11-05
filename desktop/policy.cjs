const ORIGIN = 'https://nucleas.app';
function trustedRemote(raw) { try { return new URL(raw).origin === ORIGIN; } catch { return false; } }
function externalUrl(raw) { try { const u = new URL(raw); return ['https:', 'http:', 'mailto:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; } }
/** A Nucleas page that can open in its own app window. Routes and sign-in are not pages: they go to the browser. */
function appPage(raw) {
  if (!trustedRemote(raw)) return false;
  const { pathname } = new URL(raw);
  return pathname !== '/' && pathname !== '/login' && !pathname.startsWith('/api/') && !pathname.startsWith('/desktop/');
}
function moduleRequest(value, catalog) {
  if (!value || typeof value !== 'object' || !catalog.some(m => m.id === value.moduleId)) return null;
  const payload = value.payload ?? {};
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' || Object.keys(payload).length > 30) return null;
  if (Object.entries(payload).some(([key, v]) => key.length > 80 || typeof v !== 'string' || v.length > 2000)) return null;
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)));
  return { moduleId: value.moduleId, payload: sorted, key: `${value.moduleId}:${JSON.stringify(sorted)}` };
}
function visibleBounds(bounds, displays) {
  if (!bounds || ![bounds.width, bounds.height].every(Number.isFinite) || bounds.width < 100 || bounds.height < 60) bounds = null;
  else bounds = { ...bounds, x: Number.isFinite(bounds.x) ? bounds.x : undefined, y: Number.isFinite(bounds.y) ? bounds.y : undefined };
  const display = displays.find(d => bounds && bounds.x + bounds.width > d.x && bounds.x < d.x + d.width && bounds.y + bounds.height > d.y && bounds.y < d.y + d.height) || displays[0];
  const width = Math.min(bounds?.width || 440, display.width), height = Math.min(bounds?.height || 600, display.height);
  return { width, height, x: Math.max(display.x, Math.min(bounds?.x ?? display.x + display.width - width - 32, display.x + display.width - width)), y: Math.max(display.y, Math.min(bounds?.y ?? display.y + 48, display.y + display.height - height)) };
}
module.exports = { ORIGIN, trustedRemote, externalUrl, appPage, moduleRequest, visibleBounds };
