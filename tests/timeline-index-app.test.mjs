import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

test('app timeline mapping preserves authored repeats, pre-speed time and endpoint behavior', async () => {
  const { context, evaluate } = await createAppFixture();
  assert.equal(vm.runInContext(`runEditorCommand('timeline.replace', {clips:[
    {start:8,end:10}, {start:1,end:4}, {start:8,end:10}
  ]})`, context), true);
  assert.equal(evaluate('duration()'), 7);
  for (const [time, expected] of [
    [-1, {index:0,source:8,offset:0}],
    [0, {index:0,source:8,offset:0}],
    [2, {index:1,source:1,offset:2}],
    [5, {index:2,source:8,offset:5}],
    [7, {index:2,source:10,offset:5}],
    [10, {index:2,source:10,offset:5}],
  ]) assert.deepEqual(evaluate(`locate(${time})`), expected);
  assert.equal(vm.runInContext("runEditorCommand('project.update', {patch:{speed:4}})", context), true);
  assert.equal(evaluate('duration()'), 7);
  assert.deepEqual(evaluate('locate(2)'), {index:1,source:1,offset:2});
  assert.deepEqual(evaluate('locate(-Infinity)'), {index:0,source:8,offset:0});
  assert.deepEqual(evaluate('locate(Infinity)'), {index:2,source:10,offset:5});
  assert.equal(vm.runInContext('Number.isNaN(locate(NaN).source)', context), true);
  assert.equal(evaluate('locate(NaN).index'), 2);
});

test('app retains clip-identity cache ownership across edits and undo', async () => {
  const { context, evaluate } = await createAppFixture();
  assert.equal(vm.runInContext(`(() => {
    const first = timelineIndex();
    if (first !== timelineIndex() || first.clips !== state.clips || first.entries[0].clip !== state.clips[0]) return false;
    state.name = 'unrelated setting';
    return timelineIndex() === first;
  })()`, context), true);
  assert.equal(vm.runInContext(`(() => {
    const first = timelineIndex();
    if (!runEditorCommand('timeline.replace', {clips:[{start:2,end:5},{start:8,end:12}]})) return false;
    const edited = timelineIndex();
    if (edited === first || edited.clips !== state.clips || edited.entries[1].clip !== state.clips[1]) return false;
    undo();
    const restored = timelineIndex();
    return restored !== edited && restored !== first && restored.clips === state.clips &&
      restored.entries[0].clip === state.clips[0] && restored === timelineIndex();
  })()`, context), true);
  assert.equal(evaluate('duration()'), 12);
  assert.deepEqual(evaluate('locate(3)'), {index:0,source:3,offset:0});
});
