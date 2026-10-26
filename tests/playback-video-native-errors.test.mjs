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
  const pending = vm.runInContext(exporting
    ? `exportFlow.startExport({mime:'video/webm',ext:'webm'},720,{includeAudio:${includeAudio}})` : 'play()', f.context);
  // Check the captured request options before cancellation can reset the export owner.
  if (exporting) assert.equal(f.evaluate('videoExport.renderOptions.includeAudio'), includeAudio);
  await pending;
}
const snapshot = f => f.evaluate('({state,history,future,current})');
const failure = code => ({ code, message: 'Synthetic native media failure' });

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

test('known unsupported-source error during export preparation cancels the current request', async () => {
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
  // Restore graph preparation so the resumed flow checks the known source error.
  vm.runInContext('ensureAudio = () => playback.ensureAudio();', f.context);
  await vm.runInContext('ensureAudio()', f.context);
  resume(); await pending;
  assert.equal(f.evaluate('exporting'), false);
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.element('#toast').textContent, vm.runInContext("t('shell.playError')", f.context));
});

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function assertStartupStopped(f, before) {
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.evaluate('exporting'), false);
  assert.equal(f.evaluate('frameHandle'), 0);
  assert.equal(f.video.paused, true);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.sourceTrack.stops, 0);
  assert.equal(f.element('#toast').textContent, vm.runInContext("t('shell.playError')", f.context));
  const recorder = f.recorders.at(-1);
  if (recorder) {
    assert.equal(recorder.stops, 1);
    assert.ok(recorder.stream.getTracks().every(track => track.stops === 1));
    assert.equal(f.evaluate('videoExport.recorder'), null);
    assert.equal(f.evaluate('videoExport.canvas'), null);
  }
}

for (const exporting of [false, true]) {
  for (const code of [2, 3]) {
    test(`known video error ${code} is rejected before requesting native ${exporting ? 'export' : 'preview'} playback`, async () => {
      const f = await fixture(), before = snapshot(f); let plays = 0;
      // Native play's immediate existing-error rejection is only guaranteed for code4.
      f.video.play = async () => { plays++; f.video.paused = false; };
      f.video.error = failure(code); f.emit();
      await start(f, exporting);
      assertStartupStopped(f, before);
      assert.equal(plays, 0);
    });
  }
}

async function holdStartup(f, stage, exporting = true, includeAudio = true) {
  let release, resumes = 0, plays = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const resume = f.context.AudioContext.prototype.resume;
  const ordinaryPlay = async () => { plays++; f.video.paused = false; };
  f.video.play = ordinaryPlay;
  const targetResume = exporting ? 2 : 1;
  if (stage === 'resume') f.context.AudioContext.prototype.resume = () => ++resumes === targetResume ? gate : Promise.resolve();
  if (stage === 'seek') {
    vm.runInContext('state.clips = [{start:6,end:12}]; timelineCache = null;', f.context);
    f.context.AudioContext.prototype.resume = () => {
      if (++resumes === targetResume) f.video.currentTime = 0;
      return Promise.resolve();
    };
    release = () => { for (const callback of [...f.events.get('seeked') || []]) callback(); };
  }
  if (stage === 'native-play') f.video.play = () => { plays++; f.video.paused = false; return gate; };
  const pending = start(f, exporting, includeAudio); await settle();
  assert.equal(f.evaluate('playing'), false);
  if (exporting) assert.equal(f.recorders[0].state, 'recording');
  if (stage === 'resume') assert.equal(resumes, targetResume);
  if (stage === 'seek') assert.equal(f.events.get('seeked').size, 2);
  if (stage === 'native-play') assert.equal(plays, 1);
  return { pending, release, plays: () => plays,
    restore() { f.context.AudioContext.prototype.resume = resume; f.video.play = ordinaryPlay; } };
}

for (const stage of ['resume', 'seek', 'native-play']) {
  for (const exporting of [false, true]) {
    for (const code of [2, 3]) {
      test(`${stage}: latched video error ${code} cannot become an active ${exporting ? 'export' : 'preview'} after settlement`, async () => {
        const f = await fixture(), held = await holdStartup(f, stage, exporting), before = snapshot(f);
        const recorder = f.recorders[0], old = recorder && {
          data: recorder.ondataavailable, stop: recorder.onstop, error: recorder.onerror,
        };
        f.video.error = failure(code); f.emit();
        assert.equal(f.evaluate('exporting'), exporting, 'event alone does not claim immediate startup cancellation');
        held.release(); await held.pending;
        assertStartupStopped(f, before);
        assert.equal(held.plays(), stage === 'native-play' ? 1 : 0, 'do not enter native play with a known failed video');
        if (old) { old.data({data:new Blob(['stale'])}); old.stop(); old.error(); }
        assert.equal(f.downloads.length, 0);
        held.restore(); f.video.error = null;
        // Preserve the existing one-off seek paint, not a second transport clock.
        for (const [id, draw] of f.pendingFrames) { f.pendingFrames.delete(id); draw(); }
        await start(f, exporting);
        f.emit();
        if (old) { old.stop(); old.error(); }
        assert.equal(f.evaluate('playing'), true);
        assert.equal(f.evaluate('exporting'), exporting);
        if (exporting) assert.equal(f.recorders[1].stops, 0);
        vm.runInContext(exporting ? 'stopExport(true)' : 'pause()', f.context);
      });
    }
  }
}

test('source video remains required when startup fails in an intentionally silent export', async () => {
  const f = await fixture(), held = await holdStartup(f, 'native-play', true, false), before = snapshot(f);
  assert.equal(f.evaluate('videoExport.renderOptions.includeAudio'), false);
  assert.equal(f.recorders[0].stream.getTracks().length, 1);
  f.video.error = failure(3); f.emit(); held.release(); await held.pending;
  assertStartupStopped(f, before);
});

for (const stage of ['resume', 'seek', 'native-play']) {
  test(`${stage}: stale startup does not handle the current error of a newer pending export`, async () => {
    const f = await fixture(), held = await holdStartup(f, stage);
    vm.runInContext('stopExport(true)', f.context); held.restore();
    let release;
    f.video.play = () => new Promise(resolve => { release = resolve; });
    const pending = start(f, true); await settle();
    const replacement = f.recorders[1]; f.video.error = failure(3); f.emit();
    f.element('#toast').textContent = 'Replacement owns this startup';
    held.release(); await held.pending;
    assert.equal(f.evaluate('exporting'), true);
    assert.equal(replacement.stops, 0);
    assert.equal(f.element('#toast').textContent, 'Replacement owns this startup');
    release(); await pending;
    assert.equal(f.evaluate('exporting'), false);
    assert.equal(replacement.stops, 1);
    assert.equal(f.downloads.length, 0);
  });
}

test('a cleared error at the owned startup boundary is not treated as a latched failure', async () => {
  const f = await fixture(), held = await holdStartup(f, 'resume');
  f.video.error = failure(3); f.emit(); f.video.error = null;
  held.release(); await held.pending;
  assert.equal(f.evaluate('playing'), true);
  assert.equal(f.evaluate('exporting'), true);
  vm.runInContext('stopExport(true)', f.context);
});

test('known stale video error before demo startup stays irrelevant', async () => {
  const f = await fixture(); vm.runInContext("state.kind = 'demo'; sources.videoFile = null;", f.context);
  f.video.error = failure(3); await start(f, true);
  assert.equal(f.evaluate('playing'), true);
  assert.equal(f.evaluate('exporting'), true);
  vm.runInContext('stopExport(true)', f.context);
});
