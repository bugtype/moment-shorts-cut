import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createAppFixture } from './fixtures/app.mjs';

test('app entry links natively and stops at its first DOM query', () => {
  // The VM fixture strips imports. Link the real graph, then stop before app
  // bootstrap; this executes module initialization, not browser behavior.
  const url = new URL('../dist/app.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    const stop = new Error('Stop before browser bootstrap'), queries = [];
    let documentReads = 0;
    for (const name of ['window', 'navigator', 'localStorage', 'indexedDB', 'Worker',
      'Image', 'Audio', 'AudioContext', 'OfflineAudioContext', 'MediaRecorder',
      'XMLHttpRequest', 'WebSocket', 'fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
      Object.defineProperty(globalThis, name, {configurable:true, get() {
        throw new Error('Unexpected resource access: ' + name);
      }});
    }
    const documentStub = {querySelector(selector) { queries.push(selector); throw stop; }};
    Object.defineProperty(globalThis, 'document', {configurable:true, get() {
      documentReads++;
      return documentStub;
    }});
    await assert.rejects(import(${JSON.stringify(url)}), error => error === stop);
    assert.deepEqual(queries, ['#sourceVideo']);
    assert.equal(documentReads, 1);
    console.log('App graph linked; stopped at first sourceVideo query.');
  `], {encoding:'utf8', timeout:10000, maxBuffer:1024 * 1024});
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'App graph linked; stopped at first sourceVideo query.\n');
});

test('app fixtures own separate state, DOM, focus and scheduled callbacks', async () => {
  const first = await createAppFixture(), second = await createAppFixture();
  vm.runInContext("edit(()=>state.name='first fixture');", first.context);
  assert.notEqual(second.evaluate('state.name'), 'first fixture');
  assert.equal(second.evaluate('history.length'), 0);
  const input = first.element('#titleFirst');
  input.value = 'private draft';
  input.focus();
  assert.notEqual(second.element('#titleFirst').value, 'private draft');
  assert.notEqual(second.doc.activeElement, input);
  assert.equal(second.focusEvents.length, 0);
  assert.notEqual(first.documentEvents.get('keydown'), second.documentEvents.get('keydown'));
  first.context.requestAnimationFrame(() => {});
  assert.equal(second.pendingFrames.size, 0);
});
