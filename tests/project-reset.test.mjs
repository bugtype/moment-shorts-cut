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

test('detached reset callbacks cannot close or reset a replacement dialog', async () => {
  const { context, evaluate, element } = await createAppFixture();
  vm.runInContext("state.name = 'keep'; history = ['saved edit']; confirmReset();", context);
  const cancel = element('#cancelReset').onclick;
  const confirm = element('#confirmReset').onclick;
  const before = evaluate('({state, history, future})');
  vm.runInContext("modalOpen('Other tool', 'Other content')", context);
  cancel();
  confirm();
  assert.equal(element('#modal').open, true);
  assert.deepEqual(evaluate('({state, history, future})'), before);
});

test('closed reset callbacks are inert and cannot take ownership after reopening', async () => {
  const { context, evaluate, element } = await createAppFixture();
  vm.runInContext("state.name = 'keep'; confirmReset();", context);
  const oldCancel = element('#cancelReset').onclick;
  const oldConfirm = element('#confirmReset').onclick;
  element('#modal').close();
  oldConfirm();
  assert.equal(evaluate('state.name'), 'keep');
  vm.runInContext('confirmReset()', context);
  // Native close events may arrive after the next dialog has opened.
  element('#modal').onclose();
  oldCancel();
  oldConfirm();
  assert.equal(element('#modal').open, true);
  assert.equal(evaluate('state.name'), 'keep');
  element('#confirmReset').onclick();
  assert.notEqual(evaluate('state.name'), 'keep');
});

test('reset ignores composing activation and accepted confirmation is one-shot', async () => {
  const { context, evaluate, element } = await createAppFixture();
  vm.runInContext("state.name = 'keep'; confirmReset();", context);
  const confirm = element('#confirmReset').onclick;
  const cancel = element('#cancelReset').onclick;
  for (const event of [{ isComposing: true }, { keyCode: 229 }]) {
    confirm(event);
    cancel(event);
    assert.equal(element('#modal').open, true);
    assert.equal(evaluate('state.name'), 'keep');
  }
  confirm();
  assert.equal(element('#modal').open, false);
  vm.runInContext("state.name = 'after reset'; history = ['new edit'];", context);
  const after = evaluate('({state, history, future})');
  confirm();
  assert.deepEqual(evaluate('({state, history, future})'), after);
});

test('reset callbacks require the currently mounted confirmation controls', async () => {
  const { context, evaluate, element } = await createAppFixture();
  vm.runInContext("state.name = 'keep'; confirmReset();", context);
  const confirm = element('#confirmReset').onclick;
  const cancel = element('#cancelReset').onclick;
  context.originalQuery = vm.runInContext('app.query', context);
  context.replacementButton = {};
  vm.runInContext("app.query = selector => selector === '#confirmReset' ? replacementButton : originalQuery(selector)", context);
  confirm();
  cancel();
  assert.equal(evaluate('state.name'), 'keep');
  assert.equal(element('#modal').open, true);
});
