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

// Media clocks are controlled independently: waiting video remains unpaused,
// while an already-playing audio element can otherwise advance on its own.
async function bufferingFixture({ exporting = false, includeAudio = true, offset = 0, audioDuration = 12 } = {}) {
  const f = await fixture(offset), video = f.element('#sourceVideo'), audio = f.element('#sourceAudio');
  const clocks = { video: 1, audio: 1, seeks: [], seekOnWrite: false };
  Object.assign(video, { readyState: 4, seeking: false, paused: true, ended: false });
  audio.duration = audioDuration;
  Object.defineProperty(video, 'currentTime', { configurable: true,
    get: () => clocks.video, set(value) { clocks.video = value; if (clocks.seekOnWrite) video.seeking = true; },
  });
  Object.defineProperty(audio, 'currentTime', { configurable: true,
    get: () => clocks.audio, set(value) { clocks.audio = value; clocks.seeks.push(value); },
  });
  video.pause = () => { video.paused = true; };
  video.play = async () => { video.paused = false; };
  vm.runInContext("state.kind = 'video'; sources.videoFile = {name:'generated.mp4'}; current = 1;", f.context);
  if (exporting) await startExport(f, includeAudio);
  else await vm.runInContext('play()', f.context);
  assert.equal(f.evaluate('playing'), true);
  assert.equal(video.paused, false);
  assert.equal(f.evaluate('app.mediaReady()'), true);
  clocks.seeks.length = 0;
  let now = f.evaluate('lastTick');
  const step = ({ readyState = 4, seeking = false, videoAdvance = 0, audioAdvance = .3 } = {}) => {
    video.readyState = readyState; video.seeking = seeking;
    if (!video.paused && !seeking && readyState >= 3) clocks.video += videoAdvance;
    if (!audio.paused) clocks.audio += audioAdvance;
    const frame = f.evaluate('frameHandle'), callback = f.pendingFrames.get(frame);
    assert.equal(typeof callback, 'function');
    f.pendingFrames.delete(frame);
    callback(now += 300);
  };
  return { ...f, video, audio, clocks, step };
}

for (const exporting of [false, true]) {
  for (const readyState of [0, 1, 2]) {
    test(`video readiness ${readyState} waits added audio through repeated ${exporting ? 'export' : 'preview'} stalls`, async () => {
      const f = await bufferingFixture({ exporting }), before = snapshot(f), request = f.evaluate('playRequest');
      assert.equal(f.attempts.length, 1);
      for (let i = 0; i < 3; i++) f.step({ readyState });
      assert.equal(f.audio.paused, true);
      assert.deepEqual(f.clocks.seeks, [], 'blocked video must not repeatedly rewind independently playing audio');
      assert.equal(f.attempts.length, 1);
      assert.equal(f.evaluate('playing'), true, 'waiting is not a user Pause');
      assert.equal(f.evaluate('playRequest'), request);
      assert.equal(f.evaluate('app.mediaReady()'), true, 'transient readiness must not revoke authorization');
      const stoppedAt = f.evaluate('current');
      f.step({ readyState: 3, audioAdvance: 0 });
      assert.equal(f.audio.paused, false);
      assert.equal(f.attempts.length, 2);
      assert.deepEqual(f.clocks.seeks, [stoppedAt], 'resume retains the existing drift correction');
      f.element('#toast').textContent = 'Resumed transport';
      rejectAudio(f, 0, 'AbortError'); await settle();
      assert.equal(f.evaluate('playing'), true);
      assert.equal(f.element('#toast').textContent, 'Resumed transport');
      f.step({ readyState });
      assert.equal(f.audio.paused, true);
      f.step({ readyState: 4, audioAdvance: 0 });
      assert.equal(f.audio.paused, false);
      assert.equal(f.attempts.length, 3);
      rejectAudio(f, 1, 'AbortError'); await settle();
      assert.equal(f.evaluate('playing'), true);
      assert.deepEqual(snapshot(f), before);
      if (exporting) assert.equal(f.recorders[0].stops, 0, 'buffer waits never pause/stop the recorder');
      f.step({ readyState });
      assert.equal(f.audio.paused, true);
      const lateFrame = f.pendingFrames.get(f.evaluate('frameHandle'));
      vm.runInContext(exporting ? 'stopExport(true)' : 'pause()', f.context);
      f.video.readyState = 4; lateFrame(10000);
      assert.equal(f.evaluate('playing'), false);
      assert.equal(f.audio.paused, true);
      assert.equal(f.pendingFrames.size, 0);
      assert.equal(f.attempts.length, 3, 'data recovery cannot restart a user-cancelled transport');
      assert.equal(f.downloads.length, 0);
    });
  }
}

for (const options of [{ exporting: false }, { exporting: true }, { exporting: true, includeAudio: false }]) {
  test(`current audio resume failure keeps existing error policy ${JSON.stringify(options)}`, async () => {
    const f = await bufferingFixture(options);
    f.step({ readyState: 2 }); f.step({ readyState: 3, audioAdvance: 0 });
    assert.equal(f.attempts.length, 2);
    f.element('#toast').textContent = 'Current resume';
    rejectAudio(f, 1, 'AbortError'); await settle();
    const optional = options.includeAudio === false;
    assert.equal(f.evaluate('playing'), optional);
    assert.equal(f.evaluate('exporting'), optional);
    if (optional) {
      assert.equal(f.element('#toast').textContent, 'Current resume');
      assert.equal(f.recorders[0].stream.getTracks().length, 1);
      vm.runInContext('stopExport(true)', f.context);
    } else assert.match(f.element('#toast').textContent, /재생할 수 없습니다/);
    assert.equal(f.downloads.length, 0);
    assert.equal(f.sourceTrack.stops, 0);
  });
}

for (const options of [{ offset: 4 }, { audioDuration: .5 }]) {
  test(`data recovery does not start added audio outside its interval ${JSON.stringify(options)}`, async () => {
    const f = await bufferingFixture(options);
    assert.equal(f.attempts.length, 0);
    f.step({ readyState: 2 }); f.step({ readyState: 4 });
    assert.equal(f.audio.paused, true); assert.equal(f.attempts.length, 0);
    if (options.offset) {
      f.step({ videoAdvance: 3 });
      assert.equal(f.evaluate('current'), 4);
      assert.equal(f.attempts.length, 1); assert.equal(f.audio.currentTime, 0);
    }
    vm.runInContext('pause()', f.context);
  });
}

test('waiting at a source cut preserves the next source clock and resumes the edited audio clock', async () => {
  const f = await bufferingFixture();
  vm.runInContext('state.clips=[{start:0,end:2},{start:4,end:6}];timelineCache=null;', f.context);
  const before = snapshot(f);
  f.clocks.video = 2; f.clocks.seekOnWrite = true;
  f.step({ readyState: 2 });
  assert.equal(f.evaluate('current'), 2); assert.equal(f.video.currentTime, 4);
  assert.equal(f.video.seeking, true); assert.equal(f.audio.paused, true);
  f.step({ readyState: 3, videoAdvance: .1, audioAdvance: 0 });
  assert.ok(Math.abs(f.evaluate('current') - 2.1) < 1e-10);
  assert.ok(Math.abs(f.audio.currentTime - 2.1) < 1e-10);
  assert.equal(f.audio.paused, false); assert.equal(f.attempts.length, 2);
  assert.deepEqual(snapshot(f), before);
  vm.runInContext('pause()', f.context);
});

test('natural final frame still finishes export and waits for final recorder data', async () => {
  const f = await bufferingFixture({ exporting: true }), before = snapshot(f);
  f.clocks.video = 12; f.video.ended = true;
  f.step({ readyState: 2 });
  assert.equal(f.evaluate('current'), 12); assert.equal(f.evaluate('playing'), false);
  assert.equal(f.audio.paused, true); assert.equal(f.pendingFrames.size, 0);
  const recorder = f.recorders[0];
  assert.equal(recorder.stops, 1); assert.equal(f.evaluate('exporting'), true);
  assert.equal(f.downloads.length, 0);
  recorder.ondataavailable({ data: new Blob(['complete buffered export']) }); recorder.onstop();
  assert.equal(f.downloads.length, 1); assert.equal(f.evaluate('exporting'), false);
  assert.deepEqual(snapshot(f), before);
});

test('demo playback does not inherit unrelated video readiness', async () => {
  const f = await fixture(); f.element('#sourceVideo').readyState = 1;
  await vm.runInContext('play()', f.context);
  assert.equal(f.attempts.length, 1);
  const frame = f.evaluate('frameHandle'), callback = f.pendingFrames.get(frame);
  f.pendingFrames.delete(frame); f.element('#sourceAudio').currentTime = .3;
  callback(f.evaluate('lastTick') + 300);
  assert.ok(Math.abs(f.evaluate('current') - .3) < 1e-10);
  assert.equal(f.element('#sourceAudio').paused, false); assert.equal(f.attempts.length, 1);
  vm.runInContext('pause()', f.context);
});

test('recovery retains the drift tolerance and seeking still waits even with future data', async () => {
  const f = await bufferingFixture();
  f.step({ readyState: 2, audioAdvance: .1 });
  f.step({ readyState: 3, audioAdvance: 0 });
  assert.equal(f.audio.paused, false); assert.equal(f.attempts.length, 2);
  assert.deepEqual(f.clocks.seeks, [], 'small drift does not acquire a new force-seek policy');
  for (const readyState of [0, 1, 2, 3, 4]) {
    f.step({ readyState, seeking: true, audioAdvance: 0 });
    assert.equal(f.audio.paused, true); assert.equal(f.attempts.length, 2);
  }
  vm.runInContext("sources.audioFile = null; state.audioName = '';", f.context);
  f.step({ readyState: 4, audioAdvance: 0 });
  assert.equal(f.audio.paused, true); assert.equal(f.attempts.length, 2);
  assert.equal(f.evaluate('playing'), true);
  vm.runInContext('pause()', f.context);
});

for (const replaceSource of [false, true]) {
  test(`blocked final frame preserves guarded preview loop${replaceSource ? ' source replacement' : ' restart'}`, async () => {
    const f = await bufferingFixture();
    let release;
    f.context.waitLoopAudio = () => new Promise(resolve => { release = resolve; });
    vm.runInContext('const priorEnsureAudio = ensureAudio; ensureAudio = waitLoopAudio; playback.setLoopPreview(true);', f.context);
    const before = snapshot(f);
    f.clocks.video = 12; f.video.ended = true;
    f.step({ readyState: 2 });
    assert.equal(f.evaluate('current'), 0); assert.equal(f.evaluate('playing'), false);
    assert.equal(f.audio.paused, true); assert.equal(f.pendingFrames.size, 0);
    assert.equal(typeof release, 'function');
    if (replaceSource) vm.runInContext("sources.videoFile = {name:'replacement.mp4'};", f.context);
    f.video.readyState = 4; f.video.ended = false;
    release(); await settle();
    assert.equal(f.evaluate('playing'), !replaceSource);
    assert.equal(f.attempts.length, replaceSource ? 1 : 2);
    f.element('#toast').textContent = 'Current loop owner';
    rejectAudio(f, 0, 'AbortError'); await settle();
    assert.equal(f.element('#toast').textContent, 'Current loop owner');
    assert.equal(f.evaluate('playing'), !replaceSource);
    assert.deepEqual(snapshot(f), before);
    if (replaceSource) {
      assert.equal(f.pendingFrames.size, 0);
      vm.runInContext('ensureAudio = priorEnsureAudio;', f.context);
      await vm.runInContext('play()', f.context);
      assert.equal(f.evaluate('playing'), true); assert.equal(f.attempts.length, 2);
    }
    vm.runInContext('pause()', f.context);
  });
}
