import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

test('asset workspace actions stay connected after repeated panel switches', async () => {
  const { context, evaluate, element } = await createAppFixture();
  const picks = [];
  element('#videoInput').click = () => picks.push('video');
  element('#audioInput').click = () => picks.push('audio');
  for (let i = 0; i < 2; i++) {
    vm.runInContext('switchPanel("media")', context);
    element('#chooseVideo').onclick();
    vm.runInContext('current=3', context);
    element('#assetSelect').onclick();
    assert.equal(evaluate('current'), 0);
    element('#loadDemo').onclick();
    assert.equal(element('#modal').open, true);
    element('#modal').close();
    vm.runInContext('switchPanel("audio")', context);
    element('#chooseAudio').onclick();
    assert.equal(typeof element('#recordButton').onclick, 'function');
  }
  assert.deepEqual(picks, ['video', 'audio', 'video', 'audio']);
  vm.runInContext('sources.audioFile={name:"voice.wav"};state.audioName="voice.wav";renderPanel()', context);
  assert.match(element('#panelContent').innerHTML, /오디오 교체/);
  element('#removeAudio').onclick();
  assert.equal(evaluate('sources.audioFile'), null);
  assert.match(element('#panelContent').innerHTML, /오디오 선택/);
  assert.doesNotMatch(element('#panelContent').innerHTML, /id="removeAudio"/);
});

test('regrouped settings keep reset and trim actions undoable after panel switches', async () => {
  const { context, evaluate, element } = await createAppFixture();
  vm.runInContext('state.zoom=2;state.panX=.2;state.panY=.1;switchPanel("settings")', context);
  element('#resetPosition').onclick();
  assert.deepEqual(evaluate('[state.zoom,state.panX,state.panY]'), [1, 0, 0]);
  vm.runInContext('undo();switchPanel("audio");switchPanel("settings")', context);
  assert.deepEqual(evaluate('[state.zoom,state.panX,state.panY]'), [2, .2, .1]);
  element('#panelTrimStart').value = '2';
  element('#panelTrimEnd').value = '7';
  element('#panelTrimApply').onclick();
  assert.deepEqual(evaluate('state.clips'), [{ start: 2, end: 7 }]);
  vm.runInContext('undo()', context);
  assert.deepEqual(evaluate('state.clips'), [{ start: 0, end: 12 }]);
});
