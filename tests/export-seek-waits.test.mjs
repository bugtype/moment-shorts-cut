import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Real app/export/playback owners, simulated native media promises and recorder.
// These tests establish ordering and ownership, not encoded duration or audible output.
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function fixture() {
  const f = await createAppFixture(), events = [], recorders = [], tracks = [], timers = new Map();
  let timerId = 0, audioGate, playGate, seekPending = false, sourceTime = 0, failure;
  const track = () => { const t = { stops: 0, clone: track, stop() { this.stops++; } }; tracks.push(t); return t; };
  const sourceTrack = track(), node = () => ({ connect() {}, gain: { value: 1 } });
  f.context.AudioContext = class {
    constructor() { this.destination = {}; }
    async resume() { events.push('audio-ready'); if (audioGate) await audioGate.promise; }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [sourceTrack] } }; }
    createMediaElementSource() { return node(); }
    createGain() { return node(); }
  };
  f.context.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  f.context.clearTimeout = id => timers.delete(id);
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const e = createElement(tag);
    if (tag === 'canvas') e.captureStream = () => { const owned = [track()]; return { addTrack: t => owned.push(t), getTracks: () => owned }; };
    return e;
  };
  f.element('#preview').captureStream = () => {};
  f.context.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; this.stops = 0; recorders.push(this); }
    start() { events.push('record-start'); this.state = 'recording'; }
    pause() { events.push('record-pause'); if (failure === 'pause') throw new Error('pause failed'); this.state = 'paused'; }
    resume() { events.push('record-resume'); if (failure === 'resume') throw new Error('resume failed'); this.state = 'recording'; }
    stop() { events.push('record-stop'); this.stops++; this.state = 'inactive'; }
  };
  // Use app's exact elements rather than relying on fixture selector aliases.
  const media = vm.runInContext('({video,audio})', f.context);
  Object.defineProperty(media.video, 'currentTime', { configurable: true, get: () => sourceTime, set(value) { sourceTime = value; media.video.seeking = seekPending; events.push('seek'); } });
  media.video.pause = () => { media.video.paused = true; events.push('video-pause'); };
  media.video.play = async () => { events.push('video-play'); if (playGate) await playGate.promise; media.video.paused = false; };
  media.audio.pause = () => { media.audio.paused = true; events.push('audio-pause'); };
  media.audio.play = async () => { media.audio.paused = false; events.push('audio-play'); };
  vm.runInContext("state.kind='video';state.clips=[{start:0,end:1},{start:5,end:6}];state.speed=1.75;sources.videoFile={name:'video.mp4'};sources.audioFile={name:'voice.wav'};video.duration=12;audio.duration=12;video.readyState=4;video.seeking=false", f.context);
  f.context.exportWaitEvents = events;
  vm.runInContext('globalThis.originalWaitDraw=draw;draw=()=>{exportWaitEvents.push("draw");return originalWaitDraw()}', f.context);
  const finishSeek = () => {
    media.video.seeking = false;
    // EventTarget's once behavior is unnecessary: seekVideo removes its listener.
    for (const [key, handlers] of f.elementEvents) {
      if (f.element(key) !== media.video) continue;
      for (const handler of [...(handlers.get('seeked') || [])]) handler();
    }
  };
  return { ...f, events, recorders, tracks, sourceTrack, timers, media, finishSeek,
    setAudioGate: value => { audioGate = value; }, setPlayGate: value => { playGate = value; },
    setSeekPending: value => { seekPending = value; }, setTime: value => { sourceTime = value; }, fail: value => { failure = value; } };
}
function start(f, includeAudio = true) {
  vm.runInContext('exportDialog()', f.context);
  f.element('#exportFormat').value = '0'; f.element('#exportQuality').value = '720';
  f.element('#exportIncludeAudio').checked = includeAudio;
  return f.element('#startExport').onclick();
}
function frame(f, now = 100) {
  const entry = f.pendingFrames.entries().next().value;
  assert.ok(entry, 'one owned animation callback is pending');
  f.pendingFrames.delete(entry[0]); entry[1](now);
}
const snapshot = f => f.evaluate('({state,history,future})');
const cancel = f => vm.runInContext('stopExport(true)', f.context);
function released(f, recorder) {
  assert.equal(f.evaluate('exporting'), false); assert.equal(f.evaluate('playing'), false);
  assert.equal(f.pendingFrames.size, 0); assert.equal(f.evaluate('videoExport.recorder'), null);
  assert.ok(recorder.stream.getTracks().every(t => t.stops === 1)); assert.equal(f.sourceTrack.stops, 0);
}

test('startup audio, initial seek and native play waits do not record; fresh frame precedes start', async () => {
  const f = await fixture(), audio = deferred(), play = deferred(), before = snapshot(f);
  f.setAudioGate(audio); f.setPlayGate(play); f.setSeekPending(true);
  vm.runInContext('state.clips=[{start:2,end:3},{start:5,end:6}]', f.context);
  const expected = snapshot(f), pending = start(f); await flush();
  assert.ok(f.recorders.every(r => r.state === 'inactive'));
  audio.resolve(); await flush();
  assert.equal(f.media.video.seeking, true); assert.ok(f.recorders.every(r => r.state === 'inactive'));
  f.finishSeek(); await flush();
  assert.ok(f.events.includes('video-play')); assert.ok(f.recorders.every(r => r.state === 'inactive'));
  play.resolve(); await pending;
  assert.equal(f.recorders.at(-1).state, 'recording');
  const at = f.events.indexOf('record-start'); assert.equal(f.events[at - 1], 'draw');
  assert.deepEqual(snapshot(f), expected); assert.notDeepEqual(expected, before); cancel(f);
});

for (const includeAudio of [true, false]) test(`cut waits pause recording and both media, hold timeline, then draw before resuming (audio ${includeAudio})`, async () => {
  const f = await fixture(); await start(f, includeAudio); const recorder = f.recorders.at(-1), before = snapshot(f);
  f.events.length = 0; f.setSeekPending(true); f.setTime(.99); frame(f); await flush();
  assert.equal(recorder.state, 'paused'); assert.equal(f.evaluate('current'), 1);
  const pauseIndex = f.events.indexOf('record-pause'), seekIndex = f.events.indexOf('seek');
  assert.ok(pauseIndex >= 0 && seekIndex > pauseIndex, 'capture pauses before changing native source time');
  assert.equal(f.media.video.paused, true); assert.equal(f.media.audio.paused, true);
  assert.equal(f.pendingFrames.size, 0, 'seek wait owns continuation, not a polling animation loop');
  const gate = deferred(); f.setPlayGate(gate); f.finishSeek(); await flush();
  assert.equal(recorder.state, 'paused'); assert.equal(f.pendingFrames.size, 0);
  gate.resolve(); await flush();
  assert.equal(recorder.state, 'recording'); assert.equal(f.pendingFrames.size, 1);
  const resume = f.events.indexOf('record-resume'), draw = f.events.lastIndexOf('draw');
  assert.ok(draw >= 0 && draw < resume); assert.deepEqual(snapshot(f), before); cancel(f); released(f, recorder);
});

for (const late of ['seek', 'play-resolve', 'play-reject']) test(`cancelled cut ${late} cannot resume or stop a newer export`, async () => {
  const f = await fixture(); await start(f); const old = f.recorders.at(-1);
  f.setSeekPending(true); f.setTime(.99); frame(f); await flush();
  const gate = deferred();
  if (late !== 'seek') { f.setPlayGate(gate); f.finishSeek(); await flush(); }
  cancel(f); released(f, old);
  f.setSeekPending(false); f.media.video.seeking = false; f.setPlayGate(null); await start(f);
  const fresh = f.recorders.at(-1), before = snapshot(f), eventCount = f.events.filter(e => e === 'record-resume').length;
  if (late === 'seek') f.finishSeek(); else if (late === 'play-resolve') gate.resolve(); else gate.reject(new Error('old native play rejected'));
  await flush();
  assert.equal(fresh.state, 'recording'); assert.equal(fresh.stops, 0); assert.equal(f.evaluate('exporting'), true);
  assert.equal(f.events.filter(e => e === 'record-resume').length, eventCount); assert.deepEqual(snapshot(f), before);
  cancel(f); released(f, fresh);
});

for (const failure of ['pause', 'resume']) test(`native recorder ${failure} failure cancels and releases cut resources`, async () => {
  const f = await fixture(); await start(f); const recorder = f.recorders.at(-1), before = snapshot(f);
  f.fail(failure); f.setSeekPending(true); f.setTime(.99); frame(f); await flush();
  if (failure === 'resume') { f.finishSeek(); await flush(); }
  released(f, recorder); assert.equal(recorder.stops, 1); assert.deepEqual(snapshot(f), before);
  f.fail(null); f.setSeekPending(false); f.media.video.seeking = false; await start(f);
  assert.equal(f.recorders.at(-1).state, 'recording'); cancel(f);
});


test('cut seek timeout releases paused recorder and late seek cannot restart it', async () => {
  const f = await fixture(); await start(f); const recorder = f.recorders.at(-1), before = snapshot(f);
  f.setSeekPending(true); f.setTime(.99); frame(f); await flush();
  assert.equal(recorder.state, 'paused');
  const timeout = [...f.timers.values()].find(timer => timer.delay === 10000);
  assert.ok(timeout, 'real seekVideo owns a bounded seek wait'); timeout.callback(); await flush();
  released(f, recorder); assert.equal(recorder.stops, 1);
  const resumes = f.events.filter(event => event === 'record-resume').length;
  f.finishSeek(); await flush();
  assert.equal(f.events.filter(event => event === 'record-resume').length, resumes);
  assert.deepEqual(snapshot(f), before);
});

for (const outcome of ['resolve', 'reject']) test(`startup cancel during native play ${outcome} never starts obsolete capture`, async () => {
  const f = await fixture(), gate = deferred(); f.setPlayGate(gate);
  const pending = start(f); await flush();
  const recorder = f.recorders.at(-1); assert.ok(recorder); assert.equal(recorder.state, 'inactive');
  cancel(f); released(f, recorder);
  f.setPlayGate(null); await start(f); const fresh = f.recorders.at(-1);
  if (outcome === 'resolve') gate.resolve(); else gate.reject(new Error('old startup rejected'));
  await pending; await flush();
  assert.equal(recorder.state, 'inactive'); assert.equal(fresh.state, 'recording'); assert.equal(fresh.stops, 0);
  assert.equal(f.evaluate('exporting'), true); assert.equal(f.events.filter(event => event === 'record-start').length, 1);
  cancel(f); released(f, fresh);
});

test('a failed first frame after a cut cancels capture without resuming and permits retry', async () => {
  const f = await fixture(); await start(f); const recorder = f.recorders.at(-1), before = snapshot(f);
  f.setSeekPending(true); f.setTime(.99); frame(f); await flush();
  assert.equal(recorder.state, 'paused');
  vm.runInContext('globalThis.savedCutDraw=draw;draw=()=>{throw new Error("cut paint failed")}', f.context);
  f.finishSeek(); await flush();
  released(f, recorder); assert.equal(recorder.stops, 1);
  assert.equal(f.events.filter(event => event === 'record-resume').length, 0);
  assert.deepEqual(snapshot(f), before);
  vm.runInContext('draw=savedCutDraw', f.context); f.setSeekPending(false);
  await start(f); assert.equal(f.recorders.at(-1).state, 'recording'); cancel(f);
});

test('successive cuts in a three-clip export each own one pause, fresh frame and resume', async () => {
  const f = await fixture();
  vm.runInContext('state.clips=[{start:0,end:1},{start:5,end:6},{start:2,end:3}]', f.context);
  const before = snapshot(f); await start(f); const recorder = f.recorders.at(-1);
  for (const [sourceEnd, timelineBoundary] of [[.99, 1], [5.99, 2]]) {
    f.events.length = 0; f.setSeekPending(true); f.setTime(sourceEnd); frame(f, timelineBoundary * 100); await flush();
    assert.equal(recorder.state, 'paused'); assert.equal(f.evaluate('current'), timelineBoundary);
    assert.equal(f.pendingFrames.size, 0);
    assert.equal(f.events.filter(event => event === 'record-pause').length, 1);
    assert.ok(f.events.indexOf('record-pause') < f.events.indexOf('seek'));
    f.finishSeek(); await flush();
    assert.equal(recorder.state, 'recording'); assert.equal(f.pendingFrames.size, 1);
    assert.equal(f.events.filter(event => event === 'record-resume').length, 1);
    const drawIndex = f.events.lastIndexOf('draw');
    assert.ok(drawIndex >= 0 && drawIndex < f.events.indexOf('record-resume'));
    assert.equal(f.recorders.length, 1); assert.equal(recorder.stops, 0); assert.deepEqual(snapshot(f), before);
  }
  cancel(f); released(f, recorder); assert.equal(recorder.stops, 1);
});
