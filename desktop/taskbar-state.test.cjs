const { test } = require('node:test');
const assert = require('node:assert/strict');
const { supportsTaskbar, minimizedWindows, restoreWindow, createQuestionQueue } = require('./taskbar-state.cjs');

test('only supported Windows builds and architectures attempt taskbar embedding', () => {
  assert.equal(supportsTaskbar('win32', '10.0.26100', 'x64'), true);
  assert.equal(supportsTaskbar('win32', '10.0.22000', 'arm64'), true);
  for (const args of [['win32', '10.0.19045', 'x64'], ['darwin', '24.0.0', 'arm64'], ['win32', '10.0.26100', 'ia32'], ['win32', 'unknown', 'x64']]) assert.equal(supportsTaskbar(...args), false);
});
const window = (title, minimized = false, destroyed = false) => ({
  isDestroyed: () => destroyed, isMinimized: () => minimized, getTitle: () => title,
  restore() { this.restored = true; }, show() { this.shown = true; }, focus() { this.focused = true; },
});
test('only minimized Nucleas app windows appear, retaining each company context', () => {
  const windows = new Map([
    ['office:{}', window('Office', true)], ['assistant:{}', window('Ask', false)],
    ['company:{"id":"one"}', window('Frugal Gambler', true)], ['company:{"id":"two"}', window('PlayBound', true)],
    ['closed:{}', window('Old', true, true)],
  ]);
  assert.deepEqual(minimizedWindows(windows).map(w => w.title), ['Frugal Gambler', 'PlayBound']);
  assert.equal(restoreWindow(windows, 'company:{"id":"two"}'), true);
  assert.equal(windows.get('company:{"id":"two"}').focused, true);
  assert.equal(windows.get('company:{"id":"one"}').focused, undefined);
  for (const key of [44, { key: 'assistant:{}' }, 'external-hwnd', 'closed:{}']) assert.equal(restoreWindow(windows, key), false);
});
test('sign-in and busy Ask can inspect a queued question without consuming it', () => {
  const queue = createQuestionQueue();
  const first = queue.enqueue('  Show jobs for all companies  ');
  const second = queue.enqueue('What needs my approval?');
  assert.equal(queue.peek().text, 'Show jobs for all companies');
  assert.equal(queue.peek().id, first.id);
  assert.equal(queue.accept(second.id), false);
  assert.equal(queue.size, 2);
  assert.equal(queue.accept(first.id), true);
  assert.equal(queue.accept(first.id), false);
  assert.equal(queue.peek().id, second.id);
  assert.equal(queue.accept(second.id), true);
  assert.equal(queue.peek(), null);
});
test('repeat questions have different identities, queue is bounded, malformed inputs fail', () => {
  const queue = createQuestionQueue(2);
  for (const value of ['', '  ', null, {}, 'a'.repeat(4001)]) assert.throws(() => queue.enqueue(value));
  const first = queue.enqueue('How are we doing?');
  const second = queue.enqueue('How are we doing?');
  assert.notEqual(first.id, second.id);
  assert.throws(() => queue.enqueue('Another'), /waiting/);
  assert.equal(queue.size, 2);
});
