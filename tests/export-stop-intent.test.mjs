import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

// Native terminal events are injected. This checks completion ownership, not
// browser track-loss triggers or the duration/content of an encoded file.
async function fixture() {
  const f = await createAppFixture(), recorders = [], downloads = [];
  const track = () => ({stops:0, clone:track, stop() {this.stops++;}});
  const sourceTrack = track(), node = () => ({connect() {}, gain:{value:1}});
  f.context.AudioContext = class {
    constructor() {this.destination = {};}
    async resume() {}
    createMediaStreamDestination() {return {stream:{getAudioTracks:() => [sourceTrack]}};}
    createMediaElementSource() {return node();}
    createGain() {return node();}
  };
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'canvas') element.captureStream = () => {
      const owned = [track()];
      return {addTrack:value => owned.push(value), getTracks:() => owned};
    };
    return element;
  };
  f.context.MediaRecorder = class {
    constructor(stream, options) {
      this.stream = stream; this.mimeType = options.mimeType;
      this.state = 'inactive'; this.stops = 0; recorders.push(this);
    }
    start() {this.state = 'recording';}
    stop() {this.state = 'inactive'; this.stops++; this.onNativeStop?.();}
  };
  f.context.captureDownload = (blob, filename) => downloads.push({blob, filename});
  vm.runInContext('download=captureDownload', f.context);
  return {...f, recorders, downloads, sourceTrack};
}
async function start(f, audio = true) {
  await vm.runInContext(`startExport({mime:'video/webm',ext:'webm'},720,{includeAudio:${audio}})`, f.context);
  const recorder = f.recorders.at(-1);
  assert.equal(recorder.state, 'recording');
  return {recorder, data:recorder.ondataavailable, stop:recorder.onstop, error:recorder.onerror};
}
const data = () => ({data:new Blob(['synthetic recorded bytes'])});
const model = f => f.evaluate('({state,history,future})');
function released(f, recorder) {
  assert.equal(f.evaluate('exporting'), false);
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.evaluate('videoExport.recorder'), null);
  assert.equal(f.pendingFrames.size, 0);
  assert.ok(recorder.stream.getTracks().every(t => t.stops === 1));
  assert.equal(f.sourceTrack.stops, 0);
}

for (const locale of ['ko', 'en', 'zh-CN']) for (const audio of [true, false]) {
  test(`${locale}: spontaneous stop is not a completed export (audio ${audio})`, async () => {
    const f = await fixture();
    vm.runInContext(`setLocale('${locale}',{persist:false})`, f.context);
    const before = model(f), old = await start(f, audio);
    vm.runInContext('current=3', f.context);
    old.recorder.state = 'inactive'; old.data(data()); old.stop();
    assert.equal(f.downloads.length, 0, 'partial bytes are not automatically presented as a complete file');
    assert.equal(f.evaluate('modal.open'), false);
    assert.doesNotMatch(f.element('#modal').innerHTML, /shell.exportDone/);
    assert.equal(f.element('#toast').textContent, vm.runInContext("t('shell.exportFinishFailed')", f.context));
    assert.equal(old.recorder.stops, 0, 'native stop did not originate in app finalization');
    released(f, old.recorder); assert.deepEqual(model(f), before);
    const retry = await start(f, audio);
    old.data(data()); old.stop(); old.error();
    assert.equal(f.evaluate('exporting'), true); assert.equal(retry.recorder.stops, 0);
    assert.equal(f.downloads.length, 0);
    vm.runInContext('stopExport(false);stopExport(false)', f.context);
    retry.data(data()); retry.stop();
    assert.equal(retry.recorder.stops, 1); assert.equal(f.downloads.length, 1);
    assert.match(f.element('#modal').innerHTML, /shell.exportDone/);
    released(f, retry.recorder); assert.deepEqual(model(f), before);
  });
}

test('a late endpoint stop cannot authorize a recorder that was already inactive', async () => {
  const f = await fixture(), active = await start(f), before = model(f);
  active.recorder.state = 'inactive';
  vm.runInContext('current=duration();stopExport(false);stopExport(false)', f.context);
  active.data(data()); active.stop();
  assert.equal(active.recorder.stops, 0); assert.equal(f.downloads.length, 0);
  assert.equal(f.evaluate('modal.open'), false);
  released(f, active.recorder); assert.deepEqual(model(f), before);
});

test('normal stop intent precedes synchronous terminal dispatch and is cleared before retry', async () => {
  const f = await fixture(), first = await start(f);
  first.recorder.onNativeStop = () => {first.data(data()); first.stop();};
  vm.runInContext('stopExport(false)', f.context);
  assert.equal(f.downloads.length, 1); released(f, first.recorder);
  const next = await start(f);
  next.recorder.state = 'inactive'; next.data(data()); next.stop();
  assert.equal(f.downloads.length, 1, 'the prior normal stop does not authorize a new recorder');
  assert.equal(f.evaluate('modal.open'), false); released(f, next.recorder);
});

test('cancel after a requested normal stop suppresses final bytes and leaves no completion intent', async () => {
  const f = await fixture(), old = await start(f);
  vm.runInContext('stopExport(false);stopExport(true)', f.context);
  released(f, old.recorder); old.data(data()); old.stop();
  assert.equal(f.downloads.length, 0);
  const next = await start(f);
  next.recorder.state = 'inactive'; next.data(data()); next.stop();
  assert.equal(f.downloads.length, 0); released(f, next.recorder);
});

test('a requested stop from paused capture still waits for final data before completing', async () => {
  const f = await fixture(), active = await start(f);
  active.recorder.state = 'paused';
  vm.runInContext('stopExport(false);stopExport(false)', f.context);
  assert.equal(active.recorder.stops, 1); assert.equal(f.downloads.length, 0);
  assert.equal(f.evaluate('exporting'), true);
  active.data(data()); active.stop();
  assert.equal(f.downloads.length, 1); released(f, active.recorder);
});
