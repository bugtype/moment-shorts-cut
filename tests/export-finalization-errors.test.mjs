import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Native recording/download dispatch is simulated; app, export and download owners are real.
async function fixture() {
  const f = await createAppFixture(), recorders = [], tracks = [], downloads = [], blobs = [], revoked = [], timers = [];
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
    createObjectURL(blob) {
      blobs.push(blob);
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
  return { ...f, recorders, tracks, sourceTrack, downloads, blobs, revoked, timers, fail: value => { failure = value; } };
}

async function start(f, includeAudio = true) {
  vm.runInContext('exportDialog()', f.context);
  f.element('#exportFormat').value = '0';
  f.element('#exportQuality').value = '720';
  f.element('#exportIncludeAudio').checked = includeAudio;
  await f.element('#startExport').onclick();
  const recorder = f.recorders.at(-1);
  assert.equal(recorder.state, 'recording');
  const html = f.element('#modal').innerHTML;
  const progress = html.match(/<div\b[^>]*\bid="exportProgressStatus"[^>]*>/g);
  assert.equal(progress?.length, 1, 'running export has one named progress indicator');
  const attributes = Object.fromEntries([...progress[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
  for (const [name, value] of Object.entries({role:'progressbar', 'aria-labelledby':'modalTitle', 'aria-valuemin':'0', 'aria-valuemax':'100', 'aria-valuenow':'0'}))
    assert.equal(attributes[name], value);
  assert.equal(attributes['aria-live'], undefined);
  assert.equal(attributes.tabindex, undefined);
  assert.equal((html.match(/\bid="modalTitle"/g) || []).length, 1);
  assert.match(html, /<h2 id="modalTitle">[^]*data-i18n="shell.exportRunning"/);
  return { recorder, data: recorder.ondataavailable, stop: recorder.onstop, error: recorder.onerror,
    cancel: f.element('#cancelRunningExport').onclick };
}
const finalData = () => ({ data: new Blob(['synthetic complete recording']) });
const snapshot = f => f.evaluate('({state,history,future})');

for (const locale of ['ko', 'en', 'zh-CN']) {
  for (const failure of ['empty', 'url', 'click', 'detach']) {
    test(`${locale}: ${failure} finalization failure releases recording and permits explicit retry`, async () => {
      const f = await fixture(), before = snapshot(f);
      try {
        vm.runInContext(`setLocale('${locale}', {persist:false})`, f.context);
        assert.equal(f.evaluate('getLocale()'), locale);
        const old = await start(f);
        f.fail(failure);
        vm.runInContext('stopExport(false)', f.context);
        if (failure !== 'empty') old.data(finalData());
        assert.doesNotThrow(() => old.stop());
        assert.equal(f.evaluate('exporting'), false);
        assert.equal(f.evaluate('playing'), false);
        assert.equal(f.evaluate('modal.open'), failure !== 'empty');
        assert.equal(f.evaluate('videoExport.recorder'), null);
        assert.equal(f.evaluate('videoExport.canvas'), null);
        assert.equal(f.pendingFrames.size, 0);
        assert.equal(old.recorder.stops, 1);
        assert.ok(old.recorder.stream.getTracks().every(track => track.stops === 1));
        assert.equal(f.sourceTrack.stops, 0);
        if (failure === 'empty')
          assert.equal(f.element('#toast').textContent, vm.runInContext(`t('shell.exportEmpty')`, f.context));
        else {
          assert.match(f.element('#modal').innerHTML, /shell.exportDone/);
          assert.equal(f.element('#exportDownloadStatus').textContent, vm.runInContext(`t('shell.exportDownloadFailed')`, f.context));
        }
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
        if (failure !== 'empty') {
          const attempts = f.downloads.length, blob = f.blobs[0];
          f.element('#downloadExportAgain').onclick();
          assert.equal(f.downloads.length, attempts + 1);
          assert.equal(f.blobs.at(-1), blob, 'retry hands off the identical completed Blob');
          assert.equal(f.recorders.length, 1, 'retry does not encode again');
          assert.equal(f.element('#exportDownloadStatus').textContent, vm.runInContext(`t('shell.exportReview')`, f.context));
          assert.deepEqual(snapshot(f), before);
        }
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
    for (const [current, percent] of [[3, '25'], [12, '100']]) {
      vm.runInContext(`current=${current};updateTime()`, f.context);
      assert.equal(f.element('#exportProgressStatus').getAttribute('aria-valuenow'), percent);
      assert.equal(f.element('#exportPercent').textContent, percent + '%');
    }
    vm.runInContext('stopExport(false)', f.context);
    active.data(finalData()); active.stop();
    assert.equal(f.downloads.length, 1);
    assert.equal(f.evaluate('modal.open'), true);
    assert.match(f.element('#modal').innerHTML, /shell.exportDone/);
    assert.doesNotMatch(f.element('#modal').innerHTML, /role="progressbar"/);
    assert.equal(f.evaluate('exporting'), false);
    assert.deepEqual(snapshot(f), before);
    assert.ok(active.recorder.stream.getTracks().every(track => track.stops === 1));
    assert.equal(f.sourceTrack.stops, 0);
    f.element('#exportDone').onclick();
    assert.equal(f.evaluate('modal.open'), false);
  });
}

async function finish(f) {
  const active = await start(f);
  vm.runInContext('stopExport(false)', f.context);
  active.data(finalData()); active.stop();
  return active;
}

for (const dismissal of ['back', 'native close', 'replacement', 'export settings', 'new export', 'direct new export']) {
  test(`completed download owner is invalidated by ${dismissal}`, async () => {
    const f = await fixture();
    await finish(f);
    const retry = f.element('#downloadExportAgain').onclick, back = f.element('#exportDone').onclick;
    const close = f.element('#modal').onclose, replace = f.element('#modal').onreplace;
    assert.equal(typeof retry, 'function');
    if (dismissal === 'back') back();
    if (dismissal === 'native close') { f.element('#modal').close(); close(); }
    if (dismissal === 'replacement') f.element('#projectFilesButton').onclick();
    if (dismissal === 'export settings') vm.runInContext('exportDialog()', f.context);
    if (dismissal === 'new export') await start(f);
    if (dismissal === 'direct new export') await vm.runInContext("startExport({mime:'video/webm', ext:'webm'}, 720)", f.context);
    const html = f.element('#modal').innerHTML, open = f.element('#modal').open;
    retry(); back(); close(); replace();
    assert.equal(f.downloads.length, 1);
    assert.equal(f.element('#modal').innerHTML, html);
    assert.equal(f.element('#modal').open, open);
    if (f.evaluate('exporting')) vm.runInContext('stopExport(true)', f.context);
    // Dismissing the result does not revoke an already dispatched URL early.
    assert.deepEqual(f.revoked, []);
    f.timers.find(timer => timer.delay === 60000).callback();
    assert.deepEqual(f.revoked, ['blob:download-1']);
  });
}

test('retry keeps completed bytes and metadata after an API project edit', async () => {
  const f = await fixture();
  vm.runInContext("state.name = 'Original <short>'", f.context);
  await finish(f);
  const blob = f.blobs[0], html = f.element('#modal').innerHTML;
  const result = await vm.runInContext("window.moment.execute('project.update', {patch:{name:'New project', speed:2}})", f.context);
  assert.equal(result.ok, true, JSON.stringify(result));
  const before = snapshot(f);
  f.element('#downloadExportAgain').onclick();
  assert.equal(f.downloads.length, 2);
  assert.equal(f.downloads[1].name, 'Original <short>.mp4');
  assert.equal(f.blobs[1], blob);
  assert.equal(f.recorders.length, 1);
  assert.equal(f.element('#modal').innerHTML, html);
  assert.match(html, /Original &lt;short&gt;/);
  assert.deepEqual(snapshot(f), before);
});

test('retry failures remain recoverable and composing activation cannot dispatch', async () => {
  const f = await fixture();
  await finish(f);
  const retry = f.element('#downloadExportAgain').onclick, blob = f.blobs[0];
  retry({isComposing:true}); retry({keyCode:229});
  assert.equal(f.downloads.length, 1);
  for (const failure of ['url', 'click', 'detach']) {
    f.fail(failure); retry();
    assert.equal(f.evaluate('modal.open'), true);
    assert.equal(f.element('#exportDownloadStatus').textContent, vm.runInContext("t('shell.exportDownloadFailed')", f.context));
    assert.equal(f.recorders.length, 1);
  }
  f.fail(null); retry();
  assert.equal(f.blobs.at(-1), blob);
  assert.equal(f.downloads.length, 3, 'one original, one post-click fault, one explicit recovery');
});

test('stale result handlers cannot discard a newer completed export', async () => {
  const f = await fixture();
  await finish(f);
  const oldRetry = f.element('#downloadExportAgain').onclick, oldBack = f.element('#exportDone').onclick;
  const oldReplace = f.element('#modal').onreplace, oldClose = f.element('#modal').onclose;
  await finish(f);
  const newest = f.blobs.at(-1);
  oldRetry(); oldBack(); oldReplace(); oldClose();
  assert.equal(f.downloads.length, 2);
  assert.equal(f.evaluate('modal.open'), true);
  f.element('#downloadExportAgain').onclick();
  assert.equal(f.downloads.length, 3);
  assert.equal(f.blobs.at(-1), newest);
  assert.equal(f.recorders.length, 2);
});
