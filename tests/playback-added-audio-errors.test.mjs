import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Real app owners with synthetic native media; no audible or encoded-file claim.
async function fixture(offset = 0) {
  const f = await createAppFixture(), tracks = [], recorders = [], downloads = [], attempts = [];
  const track = () => {
    const value = { stops: 0, clone: track, stop() { this.stops++; } };
    tracks.push(value);
    return value;
  };
  const sourceTrack = track(), node = () => ({ connect() {}, gain: { value: 1 } });
  f.context.AudioContext = class {
    constructor() { this.destination = {}; }
    async resume() {}
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [sourceTrack] } }; }
    createMediaElementSource() { return node(); }
    createGain() { return node(); }
  };
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'canvas') element.captureStream = () => {
      const owned = [track()];
      return { addTrack: value => owned.push(value), getTracks: () => owned };
    };
    return element;
  };
  f.context.MediaRecorder = class {
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options.mimeType;
      this.state = 'inactive';
      this.stops = 0;
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.stops++; }
  };
  const audio = f.element('#sourceAudio');
  audio.paused = true;
  audio.pause = () => { audio.paused = true; };
  audio.play = () => {
    audio.paused = false;
    return new Promise((resolve, reject) => { attempts.push({ resolve, reject }); });
  };
  f.context.recordDownload = blob => downloads.push(blob);
  vm.runInContext(`
    state = initial();
    state.audioName = 'voice.wav';
    state.audioOffset = ${offset};
    sources.audioFile = {name: 'voice.wav'};
    download = recordDownload;
  `, f.context);
  return { ...f, tracks, sourceTrack, recorders, downloads, attempts };
}

const startExport = (f, includeAudio = true) => vm.runInContext(
  `exportFlow.startExport({mime: 'video/webm', ext: 'webm'}, 720, {includeAudio: ${includeAudio}})`, f.context);
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const snapshot = f => f.evaluate('({state, history, future})');
const rejectAudio = (f, index = 0, name = 'NotAllowedError') => {
  const failure = new Error('Added audio could not play');
  failure.name = name;
  f.attempts[index].reject(failure);
};

for (const exporting of [false, true]) {
  for (const offset of [0, 2]) {
    test(`added-audio rejection at offset ${offset} stops ${exporting ? 'export without publishing' : 'preview'}`, async () => {
      const f = await fixture(offset), before = snapshot(f);
      if (exporting) await startExport(f);
      else await vm.runInContext('play()', f.context);
      if (offset) {
        assert.equal(f.attempts.length, 0);
        vm.runInContext('current = 2; playback.syncAudio();', f.context);
      }
      assert.equal(f.attempts.length, 1);
      const recorder = f.recorders.at(-1);
      const retained = recorder && { data: recorder.ondataavailable, stop: recorder.onstop };
      rejectAudio(f);
      await settle();
      assert.equal(f.evaluate('playing'), false);
      assert.equal(f.evaluate('exporting'), false);
      assert.equal(f.evaluate('frameHandle'), 0);
      assert.equal(f.pendingFrames.size, 0);
      assert.match(f.element('#toast').textContent, /재생할 수 없습니다/);
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.sourceTrack.stops, 0);
      if (exporting) {
        assert.equal(recorder.stops, 1);
        assert.ok(recorder.stream.getTracks().every(value => value.stops === 1));
        assert.equal(f.evaluate('videoExport.canvas'), null);
        retained.data({ data: new Blob(['missing-audio']) });
        retained.stop();
      }
      assert.equal(f.downloads.length, 0);
      f.element('#sourceAudio').play = async () => { f.element('#sourceAudio').paused = false; };
      if (exporting) await startExport(f);
      else await vm.runInContext('play()', f.context);
      assert.equal(f.evaluate('playing'), true);
      vm.runInContext(exporting ? 'stopExport(true)' : 'pause()', f.context);
    });
  }
}

for (const action of ['pause()', 'current = 0; state.audioOffset = 2; playback.syncAudio();',
  "state.kind = 'video'; video.seeking = true; tick(performance.now());"]) {
  test(`intentional audio pause invalidates its pending rejection: ${action}`, async () => {
    const f = await fixture();
    await startExport(f);
    assert.equal(f.attempts.length, 1);
    vm.runInContext(action, f.context);
    f.element('#toast').textContent = 'Current operation';
    const before = f.evaluate('({exporting, playing, playRequest, frameHandle})');
    rejectAudio(f, 0, 'AbortError');
    await settle();
    assert.deepEqual(f.evaluate('({exporting, playing, playRequest, frameHandle})'), before);
    assert.equal(f.element('#toast').textContent, 'Current operation');
    assert.equal(f.recorders[0].stops, 0);
    vm.runInContext('stopExport(true)', f.context);
  });
}

test('seek pause and resumed audio have separate ownership within the same transport', async () => {
  const f = await fixture();
  await startExport(f);
  vm.runInContext("state.kind = 'video'; video.seeking = true; tick(performance.now());", f.context);
  vm.runInContext('video.seeking = false; playback.syncAudio();', f.context);
  assert.equal(f.attempts.length, 2);
  rejectAudio(f, 0, 'AbortError');
  await settle();
  assert.equal(f.evaluate('exporting'), true);
  assert.equal(f.recorders[0].stops, 0);
  rejectAudio(f, 1, 'AbortError');
  await settle();
  assert.equal(f.evaluate('exporting'), false, 'a current failure is not ignored just because it is AbortError');
  assert.equal(f.recorders[0].stops, 1);
  assert.equal(f.downloads.length, 0);
});

for (const replacement of ['preview', 'preparing-export', 'recording-export']) {
  test(`old added-audio rejection cannot interrupt ${replacement}`, async () => {
    const f = await fixture();
    await startExport(f);
    vm.runInContext('stopExport(true)', f.context);
    let pending, release;
    if (replacement === 'preview') await vm.runInContext('play()', f.context);
    if (replacement === 'preparing-export') {
      f.context.waitAudio = () => new Promise(resolve => { release = resolve; });
      vm.runInContext('ensureAudio = waitAudio;', f.context);
      pending = startExport(f);
    }
    if (replacement === 'recording-export') await startExport(f);
    f.element('#toast').textContent = 'Replacement';
    const before = f.evaluate('({exporting, playing, frameHandle})');
    const stops = f.tracks.map(value => value.stops);
    rejectAudio(f);
    await settle();
    assert.deepEqual(f.evaluate('({exporting, playing, frameHandle})'), before);
    assert.deepEqual(f.tracks.map(value => value.stops), stops);
    assert.equal(f.element('#toast').textContent, 'Replacement');
    vm.runInContext('exporting ? stopExport(true) : pause()', f.context);
    if (pending) { release(); await pending; }
  });
}

test('omitted export audio is not a required playback dependency', async () => {
  const f = await fixture();
  await startExport(f, false);
  f.element('#toast').textContent = 'Silent export';
  rejectAudio(f);
  await settle();
  assert.equal(f.evaluate('exporting'), true);
  assert.equal(f.evaluate('playing'), true);
  assert.equal(f.element('#toast').textContent, 'Silent export');
  const recorder = f.recorders[0];
  assert.equal(recorder.stream.getTracks().length, 1);
  vm.runInContext('stopExport(false)', f.context);
  recorder.ondataavailable({ data: new Blob(['silent-export']) });
  recorder.onstop();
  assert.equal(f.downloads.length, 1);
  assert.equal(f.sourceTrack.stops, 0);
});

test('speaker mute does not make a failed required export mix optional', async () => {
  const f = await fixture();
  vm.runInContext('muted = true;', f.context);
  await startExport(f);
  rejectAudio(f);
  await settle();
  assert.equal(f.evaluate('exporting'), false);
  assert.equal(f.evaluate('muted'), true);
  assert.equal(f.recorders[0].stops, 1);
  assert.equal(f.downloads.length, 0);
});

test('successful added-audio playback preserves the normal export result', async () => {
  const f = await fixture(), before = snapshot(f);
  await startExport(f);
  f.attempts[0].resolve();
  await settle();
  assert.equal(f.evaluate('exporting'), true);
  const recorder = f.recorders[0];
  assert.equal(recorder.stream.getTracks().length, 2);
  vm.runInContext('stopExport(false)', f.context);
  recorder.ondataavailable({ data: new Blob(['mixed-export']) });
  recorder.onstop();
  assert.equal(f.downloads.length, 1);
  assert.deepEqual(snapshot(f), before);
  assert.ok(recorder.stream.getTracks().every(value => value.stops === 1));
});
