import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Synthetic media promises exercise the real playback/export owners, not codecs.
async function fixture() {
  const f = await createAppFixture();
  const tracks = [], recorders = [], downloads = [];
  const track = () => {
    const value = { stops: 0, clone: track, stop() { this.stops++; } };
    tracks.push(value);
    return value;
  };
  const sourceTrack = track();
  const node = () => ({ connect() {}, gain: { value: 1 } });
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
  f.context.recordDownload = blob => downloads.push(blob);
  vm.runInContext(`
    state = initial();
    state.kind = 'video';
    state.clips = [{start: 6, end: 12}, {start: 0, end: 4}];
    timelineCache = null;
    seekVideo = async time => { video.currentTime = time; };
    video.play = async () => {};
    download = recordDownload;
  `, f.context);
  return { ...f, tracks, sourceTrack, recorders, downloads };
}

const startExport = f => vm.runInContext(
  "startExport({mime: 'video/webm', ext: 'webm'}, 720)", f.context);
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const projectSnapshot = f => f.evaluate('({state, history, future})');

function cut(f) {
  const frame = f.evaluate('frameHandle');
  const callback = f.pendingFrames.get(frame);
  assert.equal(typeof callback, 'function');
  f.pendingFrames.delete(frame);
  vm.runInContext('current = 5.99; video.currentTime = 12; video.ended = true;', f.context);
  callback(performance.now());
  vm.runInContext('video.ended = false;', f.context);
  assert.equal(f.evaluate('current'), 6);
  assert.equal(f.evaluate('video.currentTime'), 0, 'the next clip rewinds from the source end');
}

function failNextCut(f) {
  let reject;
  const pending = new Promise((resolve, fail) => { reject = fail; });
  f.context.waitForCut = () => pending;
  vm.runInContext('video.play = waitForCut;', f.context);
  cut(f);
  return () => reject(new Error('Native cut playback failed'));
}

for (const exporting of [false, true]) {
  test(`current cut playback failure stops ${exporting ? 'export without a file' : 'preview'} and allows retry`, async () => {
    const f = await fixture(), before = projectSnapshot(f);
    if (exporting) await startExport(f);
    else await vm.runInContext('play()', f.context);
    const recorder = f.recorders.at(-1);
    const retained = recorder && { data: recorder.ondataavailable, stop: recorder.onstop };
    failNextCut(f)();
    await settle();
    assert.equal(f.evaluate('playing'), false);
    assert.equal(f.evaluate('exporting'), false);
    assert.equal(f.evaluate('frameHandle'), 0);
    assert.equal(f.pendingFrames.size, 0);
    assert.match(f.element('#toast').textContent, /재생할 수 없습니다/);
    assert.deepEqual(projectSnapshot(f), before);
    assert.equal(f.sourceTrack.stops, 0, 'the shared audio source is not owned by export');
    if (exporting) {
      assert.equal(recorder.stops, 1);
      assert.ok(recorder.stream.getTracks().every(value => value.stops === 1));
      assert.equal(f.evaluate('videoExport.recorder'), null);
      assert.equal(f.evaluate('videoExport.canvas'), null);
      retained.data({ data: new Blob(['incomplete']) });
      retained.stop();
      assert.equal(f.downloads.length, 0);
    }
    vm.runInContext('video.play = async () => {};', f.context);
    if (exporting) await startExport(f);
    else await vm.runInContext('play()', f.context);
    assert.equal(f.evaluate('playing'), true);
    assert.equal(f.pendingFrames.size, 1);
    vm.runInContext(exporting ? 'stopExport(true)' : 'pause()', f.context);
  });
}

for (const oldExport of [false, true]) {
  for (const replacement of ['paused', 'preview', 'preparing-export', 'recording-export']) {
    test(`late ${oldExport ? 'export' : 'preview'} cut rejection cannot interrupt ${replacement}`, async () => {
      const f = await fixture();
      if (oldExport) await startExport(f);
      else await vm.runInContext('play()', f.context);
      const reject = failNextCut(f);
      vm.runInContext(oldExport ? 'stopExport(true)' : 'pause()', f.context);
      vm.runInContext('video.play = async () => {};', f.context);
      let release, pending;
      if (replacement === 'preview') await vm.runInContext('play()', f.context);
      if (replacement === 'preparing-export') {
        f.context.waitAudio = () => new Promise(resolve => { release = resolve; });
        vm.runInContext('ensureAudio = waitAudio;', f.context);
        pending = startExport(f);
      }
      if (replacement === 'recording-export') await startExport(f);
      f.element('#toast').textContent = 'Current operation';
      const before = f.evaluate('({exporting, playing, frameHandle, state, history, future})');
      const stops = f.tracks.map(value => value.stops);
      reject();
      await settle();
      assert.deepEqual(f.evaluate('({exporting, playing, frameHandle, state, history, future})'), before);
      assert.deepEqual(f.tracks.map(value => value.stops), stops);
      assert.equal(f.element('#toast').textContent, 'Current operation');
      assert.equal(f.downloads.length, 0);
      if (pending) {
        vm.runInContext('stopExport(true)', f.context);
        release();
        await pending;
      } else vm.runInContext('exporting ? stopExport(true) : pause()', f.context);
    });
  }
}

test('successful cut restart preserves export and publishes only completed recorder data', async () => {
  const f = await fixture(), before = projectSnapshot(f);
  await startExport(f);
  const recorder = f.recorders.at(-1);
  cut(f);
  await settle();
  assert.equal(f.evaluate('playing'), true);
  assert.equal(f.evaluate('exporting'), true);
  assert.equal(recorder.stops, 0);
  assert.equal(f.downloads.length, 0);
  vm.runInContext('stopExport(false)', f.context);
  recorder.ondataavailable({ data: new Blob(['complete']) });
  recorder.onstop();
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].size, 8);
  assert.ok(recorder.stream.getTracks().every(value => value.stops === 1));
  assert.deepEqual(projectSnapshot(f), before);
});
