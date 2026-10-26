import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Real app bindings/playback/export with synthetic native errors, not decoder or codec QA.
async function fixture() {
  const f = await createAppFixture(), events = new Map(), recorders = [], downloads = [], tracks = [];
  const video = f.element('#sourceVideo');
  video.error = null;
  video.paused = true;
  video.pause = () => { video.paused = true; };
  let started = 0;
  video.play = async () => {
    if (video.error) throw new Error('Native video cannot play');
    video.paused = false; started++;
  };
  video.addEventListener = (name, callback) => {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(callback);
  };
  video.removeEventListener = (name, callback) => events.get(name)?.delete(callback);
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
      this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; this.stops = 0;
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.stops++; }
  };
  f.context.publish = blob => downloads.push(blob);
  vm.runInContext(`
    state = initial(); state.kind = 'video'; state.fileName = 'original.mp4';
    sources.videoFile = {name:state.fileName}; download = publish; bindUi(app);
  `, f.context);
  const emit = () => { for (const callback of events.get('error') || []) callback({ target: video }); };
  return { ...f, video, events, recorders, downloads, tracks, sourceTrack, emit, started: () => started };
}
async function start(f, exporting, includeAudio = true) {
  await vm.runInContext(exporting
    ? `exportFlow.startExport({mime:'video/webm',ext:'webm'},720,{includeAudio:${includeAudio}})` : 'play()', f.context);
  if (exporting) assert.equal(f.evaluate('videoExport.renderOptions.includeAudio'), includeAudio);
}
const snapshot = f => f.evaluate('({state,history,future,current})');
const failure = code => ({ code, message: 'Synthetic media failure after playback started' });

for (const exporting of [false, true]) {
  for (const code of [2, 3, 4]) {
    test(`native video error ${code} after play resolves stops ${exporting ? 'export without publishing' : 'preview'}`, async () => {
      const f = await fixture();
      await start(f, exporting);
      assert.equal(f.started(), 1, 'initial play has resolved, not rejected or remained pending');
      assert.equal(f.video.paused, false);
      const before = snapshot(f), recorder = f.recorders[0];
      const retained = recorder && { data: recorder.ondataavailable, stop: recorder.onstop, error: recorder.onerror };
      f.video.error = failure(code);
      f.emit();
      assert.equal(f.evaluate('playing'), false);
      assert.equal(f.evaluate('exporting'), false);
      assert.equal(f.video.paused, true);
      assert.equal(f.evaluate('frameHandle'), 0);
      assert.equal(f.pendingFrames.size, 0);
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.element('#toast').textContent, vm.runInContext("t('shell.playError')", f.context));
      assert.equal(f.sourceTrack.stops, 0);
      if (recorder) {
        assert.equal(recorder.stops, 1);
        assert.ok(recorder.stream.getTracks().every(track => track.stops === 1));
        assert.equal(f.evaluate('videoExport.canvas'), null);
        retained.data({ data: new Blob(['invalid output']) }); retained.stop(); retained.error();
      }
      assert.equal(f.downloads.length, 0);
      f.element('#toast').textContent = 'Stopped';
      f.emit();
      assert.equal(f.element('#toast').textContent, 'Stopped', 'repeated error after stop is inert');
      // Native load clears error; an old queued event must not cancel the new transport.
      f.video.error = null;
      await start(f, exporting);
      const replacement = f.recorders.at(-1);
      f.element('#toast').textContent = 'Retry';
      f.emit();
      if (retained) { retained.stop(); retained.error(); }
      assert.equal(f.evaluate('playing'), true);
      assert.equal(f.evaluate('exporting'), exporting);
      assert.equal(f.element('#toast').textContent, 'Retry');
      if (exporting) assert.equal(replacement.stops, 0);
      vm.runInContext(exporting ? 'stopExport(true)' : 'pause()', f.context);
    });
  }
}

test('a video failure still cancels a silent export and a speaker-muted export', async () => {
  for (const includeAudio of [false, true]) {
    const f = await fixture();
    vm.runInContext('muted = true', f.context);
    await start(f, true, includeAudio);
    assert.equal(f.recorders[0].stream.getTracks().length, includeAudio ? 2 : 1);
    f.video.error = failure(3); f.emit();
    assert.equal(f.evaluate('exporting'), false);
    assert.equal(f.evaluate('muted'), true);
    assert.equal(f.recorders[0].stops, 1);
    assert.equal(f.downloads.length, 0);
  }
});

test('an unused video element error does not stop demo playback or export', async () => {
  for (const exporting of [false, true]) {
    const f = await fixture();
    vm.runInContext('state.kind = "demo"; sources.videoFile = null;', f.context);
    await start(f, exporting);
    f.element('#toast').textContent = 'Demo';
    f.video.error = failure(3); f.emit();
    assert.equal(f.evaluate('playing'), true);
    assert.equal(f.evaluate('exporting'), exporting);
    assert.equal(f.element('#toast').textContent, 'Demo');
    vm.runInContext(exporting ? 'stopExport(true)' : 'pause()', f.context);
  }
});

test('paused import errors remain owned by the media loader', async () => {
  const f = await fixture(), before = snapshot(f);
  vm.runInContext('loadingMedia = true;', f.context);
  f.element('#toast').textContent = 'Import error';
  f.video.error = failure(3); f.emit();
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.evaluate('loadingMedia'), true);
  assert.equal(f.element('#toast').textContent, 'Import error');
  assert.equal(f.recorders.length, 0);
});

test('current video failure is not hidden by concurrent audio loading or lost recovery readiness', async () => {
  for (const action of ['loadingMedia = true;', 'app.mediaReady = () => false;']) {
    const f = await fixture();
    await start(f, false);
    vm.runInContext(action, f.context);
    f.video.error = failure(3); f.emit();
    assert.equal(f.evaluate('playing'), false);
    assert.equal(f.video.paused, true);
    assert.equal(f.element('#toast').textContent, vm.runInContext("t('shell.playError')", f.context));
  }
});

test('native play rejection during export preparation still cancels the current request', async () => {
  const f = await fixture();
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  f.context.pendingAudio = () => gate;
  vm.runInContext('ensureAudio = pendingAudio;', f.context);
  const pending = start(f, true);
  f.element('#toast').textContent = 'Preparing';
  f.video.error = failure(4); f.emit();
  assert.equal(f.evaluate('exporting'), true);
  assert.equal(f.element('#toast').textContent, 'Preparing');
  // Restore graph preparation so the resumed flow reaches the native play error.
  vm.runInContext('ensureAudio = () => playback.ensureAudio();', f.context);
  await vm.runInContext('ensureAudio()', f.context);
  resume(); await pending;
  assert.equal(f.evaluate('exporting'), false);
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.element('#toast').textContent, vm.runInContext("t('shell.playError')", f.context));
});
