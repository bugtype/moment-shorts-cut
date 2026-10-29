import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

// Real app/controller/loader with synthetic native events and panel replacement.
// This is not microphone, native DOM, IME, recording or audio-decoding verification.
async function fixture(locale = 'en') {
  const f = await createAppFixture(), panel = f.element('#panelContent'), query = f.doc.querySelector;
  let button, markup = '', generation = 0, timerId = 0, now = 0, accept, reject, metadataReady, metadataFailed;
  const timers = new Map(), recorders = [], tracks = [];
  f.doc.querySelector = selector => selector === '#recordButton' && button ? button : query(selector);
  Object.defineProperty(panel, 'innerHTML', {configurable: true, get: () => markup, set: value => {
    markup = value;
    const match = value.match(/<button class="([^"]*)" id="recordButton"[^>]*>(.*?)<\/button>/s);
    if (!match) return;
    button = f.element(`#record-instance-${++generation}`);
    button.id = 'recordButton'; button.innerHTML = match[2]; button.disabled = false;
    const classes = new Set(match[1].split(' '));
    button.classList = {add: value => classes.add(value), remove: value => classes.delete(value),
      contains: value => classes.has(value), toggle: (value, on) => on ? classes.add(value) : classes.delete(value)};
  }});
  f.context.navigator = {mediaDevices: {getUserMedia: () => new Promise((resolve, fail) => {accept = resolve; reject = fail;})}};
  f.context.MediaRecorder = class {
    state = 'inactive'; mimeType = 'audio/webm'; stops = 0;
    constructor(stream) {this.stream = stream; recorders.push(this);}
    start() {this.state = 'recording';}
    stop() {this.stops++; this.state = 'inactive';}
  };
  f.context.File = class extends Blob {constructor(parts, name, options) {super(parts, options); this.name = name;}};
  f.context.Audio = class {duration = 1; removeAttribute() {} load() {}};
  f.context.URL = {createObjectURL: () => 'blob:synthetic-recording', revokeObjectURL() {}};
  f.context.setInterval = callback => {timers.set(++timerId, callback); return timerId;};
  f.context.clearInterval = id => timers.delete(id);
  f.context.performance = {now: () => now};
  f.context.waitRecordingMetadata = () => new Promise((resolve, fail) => {metadataReady = resolve; metadataFailed = fail;});
  vm.runInContext(`setLocale('${locale}',{persist:false});sources.waitForMedia=waitRecordingMetadata;
    persistMedia=()=>{};snapshot();state.name='Changed name';changed();switchPanel('audio');`, f.context);
  assert.equal(f.evaluate('getLocale()'), locale);
  const label = key => vm.runInContext(`t('${key}')`, f.context);
  const check = (key, {active = false, disabled = false, time} = {}) => {
    assert.ok(button.innerHTML.includes(`data-i18n="${key}"`), button.innerHTML);
    assert.ok(button.innerHTML.includes(time == null ? label(key) : vm.runInContext(`t('${key}',{time:'${time}'})`, f.context)));
    assert.equal(button.classList.contains('recording'), active);
    assert.equal(button.disabled, disabled);
  };
  const grant = () => {
    const track = {stops: 0, stop() {this.stops++;}}; tracks.push(track);
    accept({getTracks: () => [track]});
  };
  const tick = (milliseconds = 1000) => {now += milliseconds; for (const callback of [...timers.values()]) callback();};
  const finish = () => {
    const recorder = recorders.at(-1);
    recorder.ondataavailable({data: new Blob(['synthetic recording bytes'])});
    return recorder.onstop();
  };
  return {...f, get button() {return button;}, check, grant, tick, finish, timers, recorders, tracks,
    deny: () => reject(new Error('Synthetic permission failure')), ready: () => metadataReady(),
    failMetadata: () => metadataFailed(new Error('Synthetic decode failure'))};
}

for (const locale of ['ko', 'en', 'zh-CN']) {
  test(`${locale}: recording status/time and Finish action survive Undo/Redo and finalization remounts`, async () => {
    const f = await fixture(locale);
    try {
      const start = f.button.onclick();
      f.grant(); await start; f.tick(); f.tick();
      f.check('shell.recordDone', {active: true, time: '00:02'});
      const recorder = f.recorders[0], stops = recorder.onstop;
      f.element('#undoButton').onclick();
      f.check('shell.recordDone', {active: true, time: '00:02'});
      f.element('#redoButton').onclick();
      f.check('shell.recordDone', {active: true, time: '00:02'});
      f.tick(5000);
      f.check('shell.recordDone', {active: true, time: '00:07'});
      vm.runInContext('renderPanel()', f.context);
      f.check('shell.recordDone', {active: true, time: '00:07'});
      assert.equal(f.recorders.length, 1); assert.equal(f.tracks[0].stops, 0);
      const state = f.evaluate('({state,history,future})');
      await f.button.onclick();
      assert.equal(recorder.stops, 1); assert.equal(f.timers.size, 0);
      f.check('shell.recordFinishing', {disabled: true});
      f.element('#undoButton').onclick();
      f.check('shell.recordFinishing', {disabled: true});
      const pending = f.finish();
      assert.equal(f.tracks[0].stops, 1);
      f.element('#redoButton').onclick();
      f.check('shell.recordFinishing', {disabled: true});
      assert.deepEqual(f.evaluate('({state,history,future})'), state);
      await f.button.onclick(); assert.equal(recorder.stops, 1);
      f.ready(); await pending;
      f.check('panels.recordMicrophone');
      assert.equal(f.evaluate('audioRecording.current'), null);
      await stops(); // Late native callback cannot restore the busy display.
      f.check('panels.recordMicrophone');
    } finally {vm.runInContext("setLocale('ko',{persist:false})", f.context);}
  });
}

test('a pending microphone request rejected by Undo returns the current control to idle', async () => {
  const f = await fixture();
  const pending = f.button.onclick();
  f.element('#undoButton').onclick();
  f.check('shell.recordPreparing', {disabled: true});
  f.grant(); await pending;
  f.check('panels.recordMicrophone');
  assert.equal(f.recorders.length, 0); assert.equal(f.tracks[0].stops, 1);
  assert.equal(f.evaluate('audioRecording.requesting'), false);
});

test('permission and handoff failures restore idle controls and allow explicit retry', async () => {
  const f = await fixture();
  let pending = f.button.onclick(); f.deny(); await pending;
  f.check('panels.recordMicrophone');
  pending = f.button.onclick(); f.grant(); await pending;
  await f.button.onclick();
  const finishing = f.finish();
  f.check('shell.recordFinishing', {disabled: true});
  f.failMetadata(); await finishing;
  f.check('panels.recordMicrophone');
  assert.equal(f.tracks[0].stops, 1);
  pending = f.button.onclick(); f.grant(); await pending;
  f.check('shell.recordDone', {active: true, time: '00:00'});
  f.recorders.at(-1).onerror();
  f.check('panels.recordMicrophone');
  assert.equal(f.tracks[1].stops, 1);
});

test('the existing 180-second stop updates status before final events without a second timer', async () => {
  const f = await fixture(), pending = f.button.onclick();
  f.grant(); await pending;
  assert.equal(f.timers.size, 1);
  for (let i = 0; i < 180; i++) f.tick();
  assert.equal(f.recorders[0].stops, 1); assert.equal(f.timers.size, 0);
  f.check('shell.recordFinishing', {disabled: true});
  vm.runInContext('renderPanel()', f.context);
  f.check('shell.recordFinishing', {disabled: true});
  const finishing = f.finish(); f.ready(); await finishing;
  f.check('panels.recordMicrophone');
});


test('leaving Audio during permission wait does not update detached controls or accept the obsolete request', async () => {
  const f = await fixture(), pending = f.button.onclick();
  const detached = f.button, initial = detached.innerHTML;
  vm.runInContext("switchPanel('settings')", f.context);
  assert.equal(f.evaluate('panel'), 'settings');
  f.grant(); await pending;
  assert.equal(detached.innerHTML, initial);
  assert.equal(f.recorders.length, 0); assert.equal(f.tracks[0].stops, 1);
  vm.runInContext("switchPanel('audio')", f.context);
  assert.notEqual(f.button, detached);
  f.check('panels.recordMicrophone');
  const retry = f.button.onclick(); f.grant(); await retry;
  vm.runInContext("switchPanel('settings')", f.context);
  assert.equal(f.evaluate('panel'), 'audio', 'Existing active-recording navigation guard is unchanged');
  f.recorders[0].onerror();
  f.check('panels.recordMicrophone');
  assert.equal(f.tracks[1].stops, 1);
});
