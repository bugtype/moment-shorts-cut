import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function nativeSource(target = {}, listeners = new Map()) {
  let src = '';
  const emit = name => { for (const callback of [...listeners.get(name) || []]) callback(); };
  Object.assign(target, { duration: 12, readyState: 4, error: null, paused: true, load() {},
    getAttribute: name => name === 'src' ? src || null : null,
    removeAttribute(name) { if (name === 'src') src = ''; },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
    pause() { this.paused = true; },
    async play() { this.paused = false; },
  });
  Object.defineProperties(target, {
    src: { configurable: true, get: () => src, set(value) {
      src = value; target.error = null; queueMicrotask(() => emit('loadeddata'));
    } },
    currentSrc: { configurable: true, get: () => src },
  });
  return { element: target, emit };
}

// Real recovery authorization and export/playback owners; native events/recorder are synthetic.
async function fixture() {
  const f = await createAppFixture(), recorders = [], tracks = [], downloads = [], writes = [];
  const v = nativeSource(f.element('#sourceVideo')), a = nativeSource(f.element('#sourceAudio'));
  const track = () => {
    const value = { stops: 0, clone: track, stop() { this.stops++; } };
    tracks.push(value); return value;
  };
  const sourceTrack = track(), node = () => ({ connect() {}, gain: { value: 1 } });
  f.context.AudioContext = class {
    constructor() { this.destination = {}; }
    async resume() {}
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [sourceTrack] } }; }
    createMediaElementSource() { return node(); }
    createGain() { return node(); }
  };
  const resume = f.context.AudioContext.prototype.resume, play = v.element.play;
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    if (['video', 'audio'].includes(tag)) nativeSource(element);
    if (tag === 'canvas') element.captureStream = () => {
      const owned = [track()];
      return { getTracks: () => owned, addTrack: value => owned.push(value) };
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
  let id = 0;
  f.context.URL = { createObjectURL: () => `blob:confirmed-${++id}`, revokeObjectURL() {} };
  f.context.publish = blob => downloads.push(blob);
  f.context.recordWrite = (...args) => writes.push(args);
  f.context.localStorage.setItem = f.context.recordWrite;
  vm.runInContext(`
    state = initial(); state.kind = 'video'; state.fileName = 'original.mp4'; state.audioName = 'voice.wav';
    history = []; future = []; current = 0;
    persistence.restorePhase = 'failed'; persistence.recoveryValid = true;
    persistence.recoveryBaseline = JSON.stringify(state); persistence.restoreMessage = 'Storage still failed';
    projectStore.setMedia = recordWrite; download = publish; bindUi(app);
  `, f.context);
  const relink = async () => {
    const result = await vm.runInContext("sessionMedia.connect({video:{name:'original.mp4',size:1},audio:{name:'voice.wav',size:1}},{confirmed:true})", f.context);
    assert.equal(result.ok, true);
    assert.equal(f.evaluate('sessionMedia.mediaReady()'), true);
    assert.equal(f.evaluate('persistence.restorePhase'), 'failed', 'relink never repairs storage authority');
  };
  await relink();
  return { ...f, video: v.element, audio: a.element, emitVideo: v.emit, recorders, tracks, sourceTrack, downloads, writes, relink,
    resetNative() { f.context.AudioContext.prototype.resume = resume; v.element.play = play; },
  };
}
const snapshot = f => f.evaluate('({state,history,future,current,phase:persistence.restorePhase,baseline:persistence.recoveryBaseline})');
const start = (f, includeAudio = true) => vm.runInContext(
  `exportFlow.startExport({mime:'video/webm',ext:'webm'},720,{includeAudio:${includeAudio}})`, f.context);
const chunk = () => ({ data: new Blob(['synthetic completed recording']) });

async function holdStartup(f, stage, includeAudio = true) {
  let release, resumes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  if (stage === 'resume') f.context.AudioContext.prototype.resume = () => ++resumes === 2 ? gate : Promise.resolve();
  if (stage === 'seek') {
    vm.runInContext('state.clips = [{start:6,end:12}]; timelineCache = null;', f.context);
    // Model a native clock change during resume so play owns a fresh asynchronous seek.
    f.context.AudioContext.prototype.resume = () => {
      if (++resumes === 2) f.video.currentTime = 0;
      return Promise.resolve();
    };
    release = () => f.emitVideo('seeked');
  }
  if (stage === 'native-play') f.video.play = () => { f.video.paused = false; return gate; };
  const pending = start(f, includeAudio);
  await settle();
  assert.equal(f.recorders.length, 1);
  assert.equal(f.recorders[0].state, 'recording');
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.evaluate('videoExport.renderOptions.includeAudio'), includeAudio);
  return { pending, release };
}

for (const stage of ['resume', 'seek', 'native-play']) {
  for (const source of ['video', 'audio']) {
    for (const includeAudio of [true, false]) {
      test(`${stage}: lost ${source} recovery readiness cancels the owned export (audio ${includeAudio})`, async () => {
        const f = await fixture(), { pending, release } = await holdStartup(f, stage, includeAudio);
        const before = snapshot(f), recorder = f.recorders[0];
        const old = { data: recorder.ondataavailable, stop: recorder.onstop, error: recorder.onerror };
        f[source].error = { code: 3 };
        assert.equal(f.evaluate('sessionMedia.mediaReady()'), false);
        release(); await pending;
        assert.equal(f.evaluate('exporting'), false);
        assert.equal(f.evaluate('playing'), false);
        assert.equal(f.evaluate('frameHandle'), 0);
        assert.equal(f.video.paused, true);
        assert.equal(recorder.stops, 1);
        assert.equal(f.evaluate('videoExport.recorder'), null);
        assert.equal(f.evaluate('videoExport.canvas'), null);
        assert.ok(recorder.stream.getTracks().every(track => track.stops === 1));
        assert.equal(f.sourceTrack.stops, 0);
        assert.deepEqual(snapshot(f), before);
        assert.deepEqual(f.writes, []);
        old.data(chunk()); old.stop(); old.error();
        assert.equal(f.downloads.length, 0);
        f.resetNative(); await f.relink(); await start(f, includeAudio);
        const replacement = f.recorders[1];
        assert.equal(f.evaluate('playing'), true);
        old.data(chunk()); old.stop(); old.error();
        assert.equal(f.evaluate('exporting'), true);
        assert.equal(replacement.stops, 0);
        assert.equal(f.downloads.length, 0);
        vm.runInContext('stopExport(false)', f.context);
        replacement.ondataavailable(chunk()); replacement.onstop();
        assert.equal(f.downloads.length, 1);
        assert.deepEqual(f.writes, []);
      });
    }
  }
}

for (const stage of ['resume', 'seek', 'native-play']) {
  test(`${stage}: a cancelled startup continuation cannot stop a newer recovered export`, async () => {
    const f = await fixture(), { pending, release } = await holdStartup(f, stage);
    vm.runInContext('stopExport(true)', f.context);
    f.resetNative(); await start(f);
    const replacement = f.recorders[1];
    f.element('#toast').textContent = 'Replacement owns this export';
    release(); await pending;
    assert.equal(f.evaluate('exporting'), true);
    assert.equal(f.evaluate('playing'), true);
    assert.equal(replacement.stops, 0);
    assert.equal(f.element('#toast').textContent, 'Replacement owns this export');
    assert.deepEqual(f.writes, []);
    vm.runInContext('stopExport(true)', f.context);
  });
}

test('manual preview readiness loss still pauses without creating an export or writing storage', async () => {
  const f = await fixture();
  let release;
  f.video.play = () => { f.video.paused = false; return new Promise(resolve => { release = resolve; }); };
  const pending = vm.runInContext('play()', f.context); await settle();
  f.audio.error = { code: 3 }; release(); await pending;
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.video.paused, true);
  assert.equal(f.recorders.length, 0);
  assert.deepEqual(f.writes, []);
});
