import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

for (const busy of ['loadingMedia', 'exporting', 'transcribing']) {
  test(`reset does not open while ${busy}`, async () => {
    const { context, evaluate, element } = await createAppFixture();
    vm.runInContext(`state.name = 'keep my project'; ${busy} = true; confirmReset();`, context);
    assert.notEqual(element('#modal').open, true);
    assert.equal(evaluate('state.name'), 'keep my project');
  });
  test(`an already-open reset rechecks ${busy} before discarding the project`, async () => {
    const { context, evaluate, element } = await createAppFixture();
    vm.runInContext(`state.name = 'keep my project'; history = ['saved edit']; confirmReset(); ${busy} = true;`, context);
    const before = evaluate('({state, history, future})');
    element('#confirmReset').onclick();
    assert.deepEqual(evaluate('({state, history, future})'), before);
    vm.runInContext(`${busy} = false;`, context);
    element('#confirmReset').onclick();
    assert.notEqual(evaluate('state.name'), 'keep my project', 'retry succeeds after the work finishes');
    assert.equal(evaluate('history.length'), 0);
  });
}

test('reset confirmation cannot discard a project while a chosen video is still loading', async () => {
  const { context, evaluate, element } = await createAppFixture();
  let finish;
  context.pendingVideo = new Promise(resolve => { finish = resolve; });
  vm.runInContext("state.name = 'existing edit'; confirmReset(); sources.setVideoFile = () => pendingVideo;", context);
  const loading = vm.runInContext("loadVideo({name:'next.mp4', type:'video/mp4', size:12})", context);
  assert.equal(evaluate('loadingMedia'), true);
  element('#confirmReset').onclick();
  assert.equal(evaluate('state.name'), 'existing edit');
  finish();
  await loading;
  assert.equal(evaluate('state.name'), 'next');
  assert.equal(evaluate('loadingMedia'), false);
  element('#confirmReset').onclick();
  assert.equal(evaluate('state.kind'), 'demo');
});
