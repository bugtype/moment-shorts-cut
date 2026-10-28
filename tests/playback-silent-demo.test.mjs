import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Actual app owners, synthetic native resources: no browser activation or energy claim.
async function fixture() {
  const f = await createAppFixture(), calls = [], contexts = [], recorders = [], probes = [], downloads = [];
  let failure;
  const track = () => ({ stops: 0, clone: track, stop() { this.stops++; } });
  const sourceTrack = track(), micTrack = track();
  const node = name => ({ name, gain: { value: 1 }, connect(target) { calls.push(['connect', name, target.name]); } });
  class AudioContext {
    constructor() {
      calls.push(['context']); if (failure === 'constructor') throw new Error('context unavailable');
      this.destination = node('speaker'); this.gains = []; this.sources = new Set(); contexts.push(this);
    }
    createMediaStreamDestination() { calls.push(['destination']); return { ...node('recording'), stream: { getAudioTracks: () => [sourceTrack] } }; }
    createMediaElementSource(element) {
      calls.push(['source', element.id]);
      if (failure === 'audioSource' && element === f.element('#sourceAudio')) throw new Error('audio source unavailable');
      assert.equal(this.sources.has(element), false); this.sources.add(element); return node(element.id);
    }
    createGain() { calls.push(['gain']); const gain = node('gain' + this.gains.length); this.gains.push(gain); return gain; }
    async resume() { calls.push(['resume']); if (failure === 'resume') throw new Error('resume unavailable'); }
    async suspend() { assert.fail('no new suspension policy'); }
    async close() { assert.fail('the persistent graph must not be closed or recreated'); }
  }
  const setFailure = value => { failure = value; f.context.AudioContext = value === 'missing' ? undefined : AudioContext; };
  setFailure();
  const eventful = element => {
    const handlers = new Map();
    element.addEventListener = (name, callback) => handlers.set(name, callback);
    element.removeEventListener = name => handlers.delete(name);
    return name => { const callback = handlers.get(name); assert.equal(typeof callback, 'function'); callback(); };
  };
  const video = f.element('#sourceVideo'), audio = f.element('#sourceAudio'), emitVideo = eventful(video);
  for (const element of [video, audio]) {
    element.paused = true;
    element.pause = () => { element.paused = true; };
    element.play = async () => { element.paused = false; calls.push(['play', element.id]); };
  }
  f.context.Audio = class {
    constructor() { const probe = { duration: 20, removeAttribute() {}, load() {} }; probe.emit = eventful(probe); probes.push(probe); return probe; }
  };
  f.context.URL = { createObjectURL: file => 'synthetic:' + file.name, revokeObjectURL() {} };
  const originalCreate = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = originalCreate(tag);
    element.toDataURL = () => 'data:image/jpeg;base64,c3ludGhldGlj';
    if (tag === 'canvas') element.captureStream = fps => {
      assert.equal(fps, 30); const tracks = [track()];
      return { addTrack: value => tracks.push(value), getTracks: () => tracks };
    };
    return element;
  };
  f.context.MediaRecorder = class {
    constructor(stream, options = {}) { this.stream = stream; this.mimeType = options.mimeType || 'audio/webm'; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  };
  f.context.navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [micTrack] }) } };
  f.context.File = class { constructor(parts, name, options) { this.name = name; this.size = parts.reduce((sum, part) => sum + part.size, 0); this.type = options.type; } };
  f.context.captureDownload = blob => downloads.push(blob);
  vm.runInContext('projectStore.setMedia = async () => {}; download = captureDownload;', f.context);
  const count = name => calls.filter(row => row[0] === name).length;
  return { ...f, calls, contexts, count, recorders, probes, video, audio, emitVideo, sourceTrack, micTrack, downloads, setFailure };
}
const play = f => vm.runInContext('play()', f.context);
const pause = f => vm.runInContext('pause()', f.context);
const snapshot = f => f.evaluate('({state,history,future})');
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function addAudio(f) {
  const pending = vm.runInContext("loadAudio({name:'voice.wav',size:100})", f.context);
  f.probes.at(-1).emit('loadedmetadata'); await pending;
  assert.equal(f.evaluate('state.audioName'), 'voice.wav');
}

test('cold silent demo keeps async inspector completion, playback and loop without allocating an unused audio graph', async () => {
  const f = await fixture(), before = snapshot(f), order = [];
  const render = vm.runInContext('renderInspector', f.context);
  f.context.observeInspector = () => { order.push('inspector'); render(); };
  vm.runInContext('renderInspector = observeInspector;', f.context);
  const pending = play(f); order.push('caller');
  assert.deepEqual(order, ['caller']); await pending;
  assert.deepEqual(order, ['caller', 'inspector']); assert.equal(f.evaluate('playing'), true);
  for (const name of ['context','destination','source','gain','connect','resume','play']) assert.equal(f.count(name), 0, name);
  const frame = f.evaluate('frameHandle'), callback = f.pendingFrames.get(frame);
  f.pendingFrames.delete(frame); callback(f.evaluate('lastTick') + 100);
  assert.ok(Math.abs(f.evaluate('current') - .1) < 1e-10);
  vm.runInContext('playback.setLoopPreview(true); current = duration();', f.context);
  const last = f.evaluate('frameHandle'), end = f.pendingFrames.get(last);
  f.pendingFrames.delete(last); end(f.evaluate('lastTick') + 100); await settle();
  assert.equal(f.evaluate('playing'), true); assert.equal(f.evaluate('current'), 0);
  assert.equal(f.count('context'), 0); assert.deepEqual(snapshot(f), before); pause(f);
});

for (const failure of ['missing', 'constructor', 'resume']) {
  test(`silent demo defers ${failure} WebAudio failure until added audio is actually requested`, async () => {
    const f = await fixture(), before = snapshot(f); f.setFailure(failure);
    await play(f); assert.equal(f.evaluate('playing'), true); assert.equal(f.count('context'), 0);
    assert.deepEqual(snapshot(f), before);
    await addAudio(f); assert.equal(f.evaluate('playing'), false);
    const adopted = snapshot(f);
    await play(f); assert.equal(f.evaluate('playing'), false);
    assert.match(f.element('#toast').textContent, /재생할 수 없습니다/);
    assert.deepEqual(snapshot(f), adopted);
    const existing = f.contexts[0]; f.setFailure(); await play(f);
    assert.equal(f.evaluate('playing'), true); assert.equal(f.audio.paused, false);
    assert.equal(f.contexts.length, 1);
    if (existing) assert.equal(f.contexts[0], existing);
    pause(f);
  });
}

test('actual audio adoption pauses a cold demo, then explicit Play creates one graph retained after audio removal', async () => {
  const f = await fixture(); await play(f);
  const pending = vm.runInContext("loadAudio({name:'voice.wav',size:100})", f.context);
  assert.equal(f.evaluate('playing'), true); assert.equal(f.count('context'), 0);
  f.probes.at(-1).emit('loadedmetadata'); await pending;
  assert.equal(f.evaluate('playing'), false); assert.equal(f.count('context'), 0);
  vm.runInContext('muted = true; state.volume = .8; state.audioVolume = .4;', f.context);
  await play(f); assert.equal(f.contexts.length, 1); assert.equal(f.audio.paused, false); pause(f);
  assert.deepEqual(f.contexts[0].gains.map(gain => gain.gain.value), [.8,.4,0]);
  vm.runInContext("switchPanel('audio')", f.context); f.element('#removeAudio').onclick();
  assert.equal(f.evaluate('sources.audioFile'), null); const resumes = f.count('resume');
  await play(f); assert.equal(f.count('resume'), resumes + 1);
  assert.equal(f.contexts.length, 1); assert.equal(f.contexts[0].sources.size, 2); pause(f);
});

test('actual video import after silent preview retains its first required constructor and error path', async () => {
  const f = await fixture(); await play(f); assert.equal(f.count('context'), 0);
  const pending = vm.runInContext("loadVideo({name:'video.mp4',type:'video/mp4',size:100})", f.context);
  assert.equal(f.evaluate('playing'), false); f.emitVideo('loadeddata'); await pending;
  assert.equal(f.evaluate('state.kind'), 'video'); f.setFailure('constructor');
  await play(f); assert.equal(f.evaluate('playing'), false); assert.equal(f.count('context'), 1);
  f.setFailure(); await play(f); assert.equal(f.evaluate('playing'), true);
  assert.equal(f.video.paused, false); assert.equal(f.contexts.length, 1); pause(f);
});

test('a partially constructed required graph is retried even after returning to a silent demo', async () => {
  const f = await fixture(); await addAudio(f); f.setFailure('audioSource'); await play(f);
  assert.equal(f.evaluate('playing'), false); assert.equal(f.contexts.length, 1); assert.equal(f.contexts[0].sources.size, 1);
  vm.runInContext("switchPanel('audio')", f.context); f.element('#removeAudio').onclick();
  f.setFailure(); await play(f); assert.equal(f.evaluate('playing'), true);
  assert.equal(f.contexts.length, 1); assert.equal(f.contexts[0].sources.size, 2);
  assert.equal(f.count('destination'), 1); assert.equal(f.count('resume'), 1); pause(f);
});

for (const includeAudio of [true, false]) {
  test(`fresh silent demo export still prepares its graph and preserves includeAudio=${includeAudio} tracks`, async () => {
    const f = await fixture(), before = snapshot(f);
    const start = () => vm.runInContext(`exportFlow.startExport({mime:'video/webm',ext:'webm'},720,{includeAudio:${includeAudio}})`, f.context);
    f.setFailure('constructor'); await start();
    assert.equal(f.evaluate('exporting'), false); assert.equal(f.recorders.length, 0);
    f.setFailure(); await start();
    assert.equal(f.evaluate('playing'), true); assert.equal(f.evaluate('exporting'), true);
    assert.equal(f.contexts.length, 1); assert.equal(f.count('resume'), 2);
    const recorder = f.recorders[0]; assert.equal(recorder.stream.getTracks().length, includeAudio ? 2 : 1);
    vm.runInContext('stopExport(false)', f.context); assert.equal(f.downloads.length, 0);
    recorder.ondataavailable({data: new Blob(['synthetic export'])}); recorder.onstop();
    assert.equal(f.downloads.length, 1); assert.equal(f.sourceTrack.stops, 0);
    assert.ok(recorder.stream.getTracks().every(track => track.stops === 1));
    assert.deepEqual(snapshot(f), before);
  });
}

test('cold async preparation cannot outlive immediate Pause, a newer Play or hidden-tab cancellation', async () => {
  const f = await fixture(), before = snapshot(f);
  const first = play(f); pause(f); await first;
  assert.equal(f.evaluate('playing'), false); assert.equal(f.evaluate('frameHandle'), 0);
  const stale = play(f), current = play(f); await Promise.all([stale,current]);
  assert.equal(f.evaluate('playing'), true); assert.equal(f.pendingFrames.size, 1);
  f.doc.hidden = true; f.documentEvents.get('visibilitychange')();
  assert.equal(f.evaluate('playing'), false); assert.equal(f.evaluate('frameHandle'), 0);
  f.doc.hidden = false; f.documentEvents.get('visibilitychange')();
  assert.equal(f.evaluate('playing'), false); assert.equal(f.count('context'), 0);
  assert.deepEqual(snapshot(f), before);
});

test('synthetic microphone recording and audio handoff stay independent of a cold preview graph', async () => {
  const f = await fixture(); await play(f);
  vm.runInContext("switchPanel('audio')", f.context); await f.element('#recordButton').onclick();
  assert.equal(f.evaluate('playing'), false); assert.equal(f.count('context'), 0);
  const recorder = f.recorders[0]; assert.equal(recorder.state, 'recording');
  recorder.ondataavailable({data: new Blob(['synthetic recording'])});
  f.element('#recordButton').onclick(); const finishing = recorder.onstop();
  f.probes.at(-1).emit('loadedmetadata'); await finishing;
  assert.equal(f.micTrack.stops, 1); assert.equal(f.evaluate('audioRecording.current'), null);
  assert.equal(f.evaluate('playing'), false); assert.equal(f.count('context'), 0);
  assert.ok(f.evaluate('sources.audioFile.name').endsWith('.webm'));
  await play(f); assert.equal(f.evaluate('playing'), true); assert.equal(f.contexts.length, 1); pause(f);
});
