import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Native recording/download dispatch is simulated; app, export and download owners are real.
async function fixture() {
  const f = await createAppFixture(), recorders = [], tracks = [], downloads = [], revoked = [], timers = [];
  let failure, nextURL = 0;
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
  f.context.URL = {
    createObjectURL() {
      if (failure === 'url') throw new Error('Cannot create download URL');
      return `blob:download-${++nextURL}`;
    },
    revokeObjectURL: url => revoked.push(url),
  };
  f.context.setTimeout = (callback, delay) => { timers.push({ callback, delay }); };
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'canvas') element.captureStream = () => {
      const owned = [track()];
      return { addTrack: value => owned.push(value), getTracks: () => owned };
    };
    if (tag === 'a') {
      element.click = () => {
        if (failure === 'click') throw new Error('Download dispatch failed');
        downloads.push({ url: element.href, name: element.download });
      };
      element.remove = () => {
        if (failure === 'detach') throw new Error('Download anchor detach failed');
        element.parentNode = null;
      };
    }
    return element;
  };
  f.doc.body.append = element => { element.parentNode = f.doc.body; };
  f.doc.body.removeChild = element => { element.parentNode = null; };
  f.element('#preview').captureStream = () => {};
  f.context.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor(stream, options) {
      this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; this.stops = 0;
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.stops++; }
  };
  return { ...f, recorders, tracks, sourceTrack, downloads, revoked, timers, fail: value => { failure = value; } };
}

async function start(f, includeAudio = true) {
  vm.runInContext('exportDialog()', f.context);
  f.element('#exportFormat').value = '0';
  f.element('#exportQuality').value = '720';
  f.element('#exportIncludeAudio').checked = includeAudio;
  await f.element('#startExport').onclick();
  const recorder = f.recorders.at(-1);
  assert.equal(recorder.state, 'recording');
  return { recorder, data: recorder.ondataavailable, stop: recorder.onstop, error: recorder.onerror,
    cancel: f.element('#cancelRunningExport').onclick };
}
const finalData = () => ({ data: new Blob(['synthetic complete recording']) });
const snapshot = f => f.evaluate('({state,history,future})');

for (const locale of ['ko', 'en', 'zh-CN']) {
  for (const failure of ['empty', 'url', 'click', 'detach']) {
    test(`${locale}: ${failure} finalization failure closes the running dialog and permits explicit retry`, async () => {
      const f = await fixture(), before = snapshot(f);
      try {
        vm.runInContext(`setLocale('${locale}', {persist:false})`, f.context);
        const old = await start(f);
        f.fail(failure);
        vm.runInContext('stopExport(false)', f.context);
        if (failure !== 'empty') old.data(finalData());
        assert.doesNotThrow(() => old.stop());
        assert.equal(f.evaluate('exporting'), false);
        assert.equal(f.evaluate('playing'), false);
        assert.equal(f.evaluate('modal.open'), false);
        assert.equal(f.evaluate('videoExport.recorder'), null);
        assert.equal(f.evaluate('videoExport.canvas'), null);
        assert.equal(f.pendingFrames.size, 0);
        assert.equal(old.recorder.stops, 1);
        assert.ok(old.recorder.stream.getTracks().every(track => track.stops === 1));
        assert.equal(f.sourceTrack.stops, 0);
        const key = failure === 'empty' ? 'shell.exportEmpty' : 'shell.exportFinishFailed';
        assert.equal(f.element('#toast').textContent, vm.runInContext(`t('${key}')`, f.context));
        assert.deepEqual(snapshot(f), before);
        // A post-click cleanup error cannot undo a download already dispatched.
        assert.equal(f.downloads.length, failure === 'detach' ? 1 : 0);
        assert.equal(f.recorders.length, 1, 'there is no automatic retry');
        if (failure === 'click') assert.deepEqual(f.revoked, ['blob:download-1']);
        if (failure === 'detach') {
          assert.deepEqual(f.revoked, []);
          f.timers.find(timer => timer.delay === 60000).callback();
          assert.deepEqual(f.revoked, ['blob:download-1']);
        }
        f.fail(null);
        const replacement = await start(f), dispatched = f.downloads.length;
        f.element('#toast').textContent = 'New export';
        old.data(finalData()); old.stop(); old.error(); old.cancel();
        assert.equal(f.evaluate('exporting'), true);
        assert.equal(f.evaluate('modal.open'), true);
        assert.equal(f.element('#toast').textContent, 'New export');
        assert.equal(replacement.recorder.stops, 0);
        assert.equal(f.downloads.length, dispatched);
        vm.runInContext('stopExport(false)', f.context);
        replacement.data(finalData()); replacement.stop();
        assert.equal(f.downloads.length, dispatched + 1);
        assert.equal(f.evaluate('exporting'), false);
        assert.match(f.element('#modal').innerHTML, /shell.exportDone/);
        f.element('#exportDone').onclick();
        assert.equal(f.evaluate('modal.open'), false);
      } finally { vm.runInContext("setLocale('ko', {persist:false})", f.context); }
    });
  }
}

for (const includeAudio of [true, false]) {
  test(`successful completion keeps its review dialog and one download (audio ${includeAudio})`, async () => {
    const f = await fixture(), before = snapshot(f), active = await start(f, includeAudio);
    vm.runInContext('stopExport(false)', f.context);
    active.data(finalData()); active.stop();
    assert.equal(f.downloads.length, 1);
    assert.equal(f.evaluate('modal.open'), true);
    assert.match(f.element('#modal').innerHTML, /shell.exportDone/);
    assert.equal(f.evaluate('exporting'), false);
    assert.deepEqual(snapshot(f), before);
    assert.ok(active.recorder.stream.getTracks().every(track => track.stops === 1));
    assert.equal(f.sourceTrack.stops, 0);
    f.element('#exportDone').onclick();
    assert.equal(f.evaluate('modal.open'), false);
  });
}
