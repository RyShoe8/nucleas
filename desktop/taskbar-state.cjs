const { randomUUID } = require('node:crypto');

const MAX_QUESTION_LENGTH = 4000;
function supportsTaskbar(platform, release, arch) {
  const [major, , build] = release.split('.').map(Number);
  return platform === 'win32' && ['x64', 'arm64'].includes(arch) && major >= 10 && build >= 22000;
}
function minimizedWindows(windows) {
  return [...windows].filter(([key, win]) => key !== 'office:{}' && !win.isDestroyed() && win.isMinimized())
    .map(([key, win]) => ({ key, title: win.getTitle().slice(0, 160) || 'Nucleas' }));
}
function restoreWindow(windows, key) {
  if (typeof key !== 'string') return false;
  const win = windows.get(key);
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  return true;
}
// Questions stay in the main process through sign-in, page loads and taskbar recreation.
// Only the authenticated Ask renderer can acknowledge them. Never persist queries to disk.
function createQuestionQueue(limit = 8) {
  const queue = [];
  return {
    enqueue(text) {
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_QUESTION_LENGTH) throw new Error('Enter a question of up to 4,000 characters.');
      if (queue.length >= limit) throw new Error('Ask has several questions waiting. Let it finish before adding more.');
      const item = { id: randomUUID(), text: text.trim() };
      queue.push(item);
      return item;
    },
    peek: () => queue[0] ?? null,
    accept(id) {
      if (typeof id !== 'string' || queue[0]?.id !== id) return false;
      queue.shift(); return true;
    },
    get size() { return queue.length; },
  };
}
module.exports = { supportsTaskbar, minimizedWindows, restoreWindow, createQuestionQueue, MAX_QUESTION_LENGTH };
