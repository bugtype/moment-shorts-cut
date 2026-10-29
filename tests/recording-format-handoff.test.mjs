import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { getLocale, initLocale } from '../dist/i18n.mjs';

// Actual recording → media loader → original-download owners with synthetic data
// and deferred metadata only; no microphone, native encoder or decoder is used.
async function fixture(locale, {resetMime = false} = {}) {
  const f = await createAppFixture(), writes = [], downloads = [], timers = new Map();
  initLocale({ languages: [locale], storage: null, document: f.doc });
  assert.equal(getLocale(), locale);
  assert.equal(f.doc.documentElement.lang, locale);
  let settle, reject;
  const track = { stops: 0, stop() { this.stops++; } };
  Object.assign(f.context, {
    File,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } },
    MediaRecorder: class {
      state = 'inactive'; mimeType = 'audio/ogg;codecs=opus';
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; if (resetMime) this.mimeType = ''; }
    },
    Audio: class { duration = 2; removeAttribute() {} load() {} },
    setInterval: callback => { timers.set(1, callback); return 1; },
    clearInterval: id => timers.delete(id),
    metadata: () => new Promise((resolve, fail) => { settle = resolve; reject = fail; }),
    saveMedia: (...args) => { writes.push(args); return Promise.resolve(); },
    collectDownload: (...args) => downloads.push(args),
  });
  vm.runInContext(`
    state = initial();
    sources.waitForMedia = metadata;
    projectStore.setMedia = saveMedia;
    download = collectDownload;
    switchPanel('audio');
  `, f.context);
  await f.element('#recordButton').onclick();
  const recorder = vm.runInContext('audioRecording.current', f.context);
  const chunk = new Blob(['synthetic recording\0bytes'], { type: recorder.mimeType });
  await f.element('#recordButton').onclick();
  recorder.ondataavailable({ data: chunk });
  const finishing = recorder.onstop();
  assert.equal(f.evaluate('loadingMedia'), true);
  assert.equal(track.stops, 1);
  assert.equal(timers.size, 0);
  return { ...f, writes, downloads, track, chunk, finishing, settle, reject };
}

for (const locale of ['ko', 'en', 'zh-CN']) {
  test(`Ogg recording handoff and original download preserve its File and filename (${locale})`, async () => {
    try {
      // One locale exercises the spec's stop-time reset; the others retain MIME.
      const f = await fixture(locale, {resetMime: locale === 'en'});
      assert.equal(f.writes.length, 0, 'Wait for metadata before connecting or persisting');
      f.settle();
      await f.finishing;
      const file = vm.runInContext('sources.audioFile', f.context);
      assert.equal(file.name, '내 목소리.oga');
      assert.equal(file.type, 'audio/ogg;codecs=opus');
      assert.deepEqual(await file.arrayBuffer(), await f.chunk.arrayBuffer());
      assert.equal(f.evaluate('state.audioName'), file.name);
      assert.equal(f.writes.length, 1);
      assert.equal(f.writes[0][1], file);
      f.element('#downloadOriginalAudio').onclick({});
      assert.equal(f.downloads.length, 1);
      assert.equal(f.downloads[0][0], file);
      assert.equal(f.downloads[0][1], file.name);
      assert.equal(f.evaluate('audioRecording.current'), null);
      assert.equal(f.evaluate('loadingMedia'), false);
      assert.equal(f.track.stops, 1);
    } finally { initLocale(); }
  });
}

test('Ogg recording metadata failure does not connect or save the candidate', async () => {
  try {
    const f = await fixture('en', {resetMime: true});
    f.reject(new Error('synthetic metadata failure'));
    await f.finishing;
    assert.equal(f.evaluate('sources.audioFile'), null);
    assert.equal(f.evaluate('state.audioName'), '');
    assert.equal(f.evaluate('loadingMedia'), false);
    assert.equal(f.evaluate('audioRecording.current'), null);
    assert.equal(f.track.stops, 1);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.downloads, []);
    assert.match(f.element('#toast').textContent, /synthetic metadata failure/);
  } finally { initLocale(); }
});
