import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

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
