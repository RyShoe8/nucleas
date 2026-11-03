const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trustedRemote, externalUrl, moduleRequest, visibleBounds } = require('./policy.cjs');
test('native bridge trusts only the exact Nucleas origin', () => {
  assert.equal(trustedRemote('https://nucleas.app/os/desktop'), true);
  for (const url of ['http://nucleas.app', 'https://nucleas.app.evil.example', 'file:///C:/secret', 'javascript:alert(1)']) assert.equal(trustedRemote(url), false);
});
test('external links cannot execute native protocols', () => {
  for (const url of ['file:///C:/Windows', 'javascript:alert(1)', 'ms-excel:test', 'https://user:pass@example.com']) assert.equal(externalUrl(url), false);
  assert.equal(externalUrl('https://example.com'), true);
});
test('windows deduplicate identical app context and reject arbitrary payloads', () => {
  const catalog = [{ id: 'company' }];
  const a = moduleRequest({ moduleId: 'company', payload: { b: '2', a: '1' } }, catalog);
  assert.equal(a.key, moduleRequest({ moduleId: 'company', payload: { a: '1', b: '2' } }, catalog).key);
  assert.equal(moduleRequest({ moduleId: 'shell' }, catalog), null);
  assert.equal(moduleRequest({ moduleId: 'company', payload: { value: {} } }, catalog), null);
});
test('removed monitors cannot strand a saved window off-screen', () => {
  assert.deepEqual(visibleBounds({ x: 3000, y: -400, width: 1100, height: 900 }, [{ x: 0, y: 0, width: 1920, height: 1080 }]), { x: 820, y: 0, width: 1100, height: 900 });
});

test('new app windows retain their requested size without saved coordinates', () => {
  const result = visibleBounds({ width: 1120, height: 780 }, [{ x: 0, y: 0, width: 1920, height: 1080 }]);
  assert.equal(result.width, 1120);
  assert.equal(result.height, 780);
  assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y));
});
