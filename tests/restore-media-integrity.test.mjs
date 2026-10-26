import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createProjectStore } from '../dist/project-store.mjs';
import { createMediaSources } from '../dist/media-sources.mjs';
import { createProjectPersistence } from '../dist/project-persistence.mjs';
import { createSessionMedia } from '../dist/session-media.mjs';
import { createDemoProject, createProjectDocument } from '../dist/core/project.mjs';
import { initLocale, setLocale, t } from '../dist/i18n.mjs';
import { createMediaStorageFixture } from './fixtures/media-storage.mjs';
import { createAppFixture } from './fixtures/app.mjs';

// Real storage/restore owners, synthetic IndexedDB transactions and media metadata.
function fixture(project, files = {}) {
  const storage = createMediaStorageFixture(Object.entries(files));
  let raw = JSON.stringify(project), failSettings = false, settingsWrites = 0;
  function session() {
    let model = createDemoProject(), paused = 0;
    const urls = [], timers = new Set(), attached = [], statuses = [];
    const media = kind => {
      const events = new Map();
      return {
        duration: NaN, events,
        addEventListener: (name, callback) => events.set(name, callback),
        removeEventListener: name => events.delete(name),
        removeAttribute() {},
        set src(value) {
          attached.push([kind, value]);
          this.duration = urls.find(item => item.url === value).file.duration;
          queueMicrotask(() => events.get('loadeddata')?.());
        },
      };
    };
    const video = media('video'), audio = media('audio');
    const sources = createMediaSources({ video, audio }, {
      createURL: file => {
        const url = `blob:restore-${urls.length}`;
        urls.push({ file, url });
        return url;
      },
      revokeURL() {},
      createCanvas: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'thumbnail' }),
      setTimer: callback => { timers.add(callback); return callback; },
      clearTimer: callback => timers.delete(callback),
    });
    const store = createProjectStore(storage.factory);
    const persistence = createProjectPersistence({
      store, sources, getProject: () => model, replaceProject: next => { model = next; },
      saveStatus: (...args) => statuses.push(args), toast() {}, pause() { paused++; },
    }, {
      readSettings: () => raw,
      writeSettings: (_key, value) => {
        if (failSettings) throw new Error('Settings quota exceeded');
        raw = value;
        settingsWrites++;
      },
      setTimer: callback => { timers.add(callback); return callback; },
      clearTimer: callback => timers.delete(callback),
    });
    const gate = createSessionMedia({ getProject: () => model, persistence, sources, video, audio });
    return { sources, persistence, gate, video, audio, urls, attached, statuses, timers,
      model: () => model, paused: () => paused };
  }
  return { session, storage, raw: () => raw, writes: () => settingsWrites,
    failSettings: () => { failSettings = true; } };
}

function videoProject(name = 'original.mp4') {
  return { ...createDemoProject(), kind: 'video', fileName: name, clips: [{ start: 10, end: 12 }] };
}

async function assertProtected(f, restored, original, { noAttachment = false } = {}) {
  assert.equal(restored.persistence.restorePhase, 'failed');
  assert.equal(restored.persistence.recoveryValid, true);
  assert.deepEqual(restored.model(), original);
  assert.equal(restored.gate.mediaReady(), false, 'preview/export cannot use unverified stored media');
  assert.equal(restored.paused(), 1);
  const before = { raw: f.raw(), records: structuredClone(f.storage.records), attempts: f.storage.attempts.length };
  restored.persistence.persistMedia();
  restored.persistence.scheduleSave();
  await restored.persistence.saveProject(true);
  assert.deepEqual({ raw: f.raw(), records: f.storage.records, attempts: f.storage.attempts.length }, before);
  assert.equal(f.writes(), 0);
  assert.equal(restored.timers.size, 0);
  assert.equal(restored.video.events.size, 0);
  assert.equal(restored.audio.events.size, 0);
  if (noAttachment) assert.deepEqual(restored.attached, []);
}

for (const kind of ['audio', 'video']) {
  test(`successful ${kind} replacement plus failed settings save cannot restore the wrong file`, async () => {
    const original = kind === 'video' ? videoProject() : { ...createDemoProject(), audioName: 'original.wav' };
    const originalFile = { name: kind === 'video' ? original.fileName : original.audioName, duration: 12 };
    const f = fixture(original, { [kind]: originalFile }), first = f.session();
    await first.persistence.restore();
    assert.equal(first.persistence.restorePhase, 'ready');
    const replacement = { name: `replacement.${kind === 'video' ? 'mp4' : 'wav'}`, duration: 12 };
    first.sources[`${kind}File`] = replacement;
    first.model()[kind === 'video' ? 'fileName' : 'audioName'] = replacement.name;
    first.persistence.persistMedia();
    f.failSettings();
    await first.persistence.saveProject();
    assert.deepEqual(JSON.parse(f.raw()), original);
    assert.deepEqual(f.storage.records.get(kind), replacement);
    for (let retry = 0; retry < 2; retry++) {
      const restored = f.session();
      await restored.persistence.restore();
      await assertProtected(f, restored, original, { noAttachment: true });
      assert.match(restored.persistence.restoreMessage, /일치하지 않습니다/);
    }
  });
}

for (const actualDuration of [4, 11.999]) {
  test(`same-name video at ${actualDuration}s cannot satisfy the saved cut ending at 12s`, async () => {
    const original = videoProject(), f = fixture(original, { video: { name: original.fileName, duration: 12 } });
    const first = f.session();
    await first.persistence.restore();
    first.sources.videoFile = { name: original.fileName, duration: actualDuration };
    first.model().duration = actualDuration;
    first.model().clips = [{ start: 0, end: actualDuration }];
    first.persistence.persistMedia();
    f.failSettings();
    await first.persistence.saveProject();
    assert.deepEqual(JSON.parse(f.raw()), original);
    assert.equal(f.storage.records.get('video').duration, actualDuration);
    const restored = f.session();
    await restored.persistence.restore();
    await assertProtected(f, restored, original);
    assert.match(restored.persistence.restoreMessage, /일치하지 않습니다/);
  });
}

for (const kind of ['audio', 'video']) {
  test(`stored ${kind} that the saved project does not request remains protected, never attached`, async () => {
    const original = createDemoProject(), file = { name: `uncommitted.${kind}`, duration: 12 };
    const f = fixture(original, { [kind]: file }), restored = f.session();
    await restored.persistence.restore();
    await assertProtected(f, restored, original, { noAttachment: true });
    assert.deepEqual(f.storage.records.get(kind), file);
  });
}

test('all required identities are checked before either source is attached', async () => {
  const original = { ...videoProject(), audioName: 'original.wav' };
  const f = fixture(original, {
    video: { name: original.fileName, duration: 12 },
    audio: { name: 'different.wav', duration: 12 },
  }), restored = f.session();
  await restored.persistence.restore();
  await assertProtected(f, restored, original, { noAttachment: true });
  assert.equal(restored.urls.length, 0);
});

for (const duration of [11.96, 12, 12.04, 16]) {
  for (const audioDuration of [5, Infinity]) {
    test(`compatible video ${duration}s and audio ${audioDuration}s retain normal restore/save`, async () => {
      const original = { ...videoProject(), name: 'An unrelated project title', audioName: 'VOICE.wav',
        clips: [{ start: 0, end: 10 }] };
      const f = fixture(original, {
        video: { name: original.fileName, duration }, audio: { name: original.audioName, duration: audioDuration },
      }), restored = f.session();
      await restored.persistence.restore();
      assert.equal(restored.persistence.restorePhase, 'ready');
      assert.equal(restored.gate.mediaReady(), true);
      assert.deepEqual(restored.model(), original);
      assert.deepEqual(restored.attached.map(([kind]) => kind), ['video', 'audio']);
      assert.equal(restored.timers.size, 0);
      await restored.persistence.saveProject(true);
      assert.equal(f.writes(), 1);
    });
  }
}

test('names are exact and are not normalized or compared to the project title', async () => {
  const original = { ...createDemoProject(), audioName: 'VOICE.wav' };
  const f = fixture(original, { audio: { name: 'voice.wav', duration: 5 } }), restored = f.session();
  await restored.persistence.restore();
  await assertProtected(f, restored, original, { noAttachment: true });
});

test('matching demo without stored media still restores normally', async () => {
  const original = createDemoProject(), f = fixture(original), restored = f.session();
  await restored.persistence.restore();
  assert.equal(restored.persistence.restorePhase, 'ready');
  assert.deepEqual(restored.model(), original);
  assert.deepEqual(restored.attached, []);
});

test('repeated accepted metadata imports with safe cuts remain restorable', async () => {
  const app = await createAppFixture();
  vm.runInContext(`
    state = initial(); state.kind = 'video'; state.fileName = 'original.mp4';
    state.clips = [{start: 0, end: 10}]; timelineCache = null;
  `, app.context);
  for (const duration of [12.04, 12.08]) {
    const project = { ...app.evaluate('state'), duration };
    const result = await app.context.window.moment.execute('project.import', { document: createProjectDocument(project) });
    assert.equal(result.ok, true);
  }
  const imported = app.evaluate('state');
  assert.equal(imported.duration, 12.08);
  const f = fixture(imported, { video: { name: imported.fileName, duration: 12 } }), restored = f.session();
  await restored.persistence.restore();
  assert.equal(restored.persistence.restorePhase, 'ready');
  assert.deepEqual(restored.model(), imported);
});

test('corrected stored media permits a read-only restore retry before saving is re-enabled', async () => {
  const original = { ...videoProject(), audioName: 'original.wav' };
  const files = { video: { name: original.fileName, duration: 12 }, audio: { name: original.audioName, duration: 5 } };
  const f = fixture(original, { ...files, audio: { name: 'different.wav', duration: 5 } }), restored = f.session();
  await restored.persistence.restore();
  await assertProtected(f, restored, original, { noAttachment: true });
  // Represents storage repaired independently; restore itself must never rewrite it.
  f.storage.records.set('audio', files.audio);
  await restored.persistence.restore();
  assert.equal(restored.persistence.restorePhase, 'ready');
  assert.equal(restored.gate.mediaReady(), true);
  assert.deepEqual(restored.model(), original);
  assert.equal(f.storage.attempts.length, 0);
  assert.equal(f.writes(), 0);
  await restored.persistence.saveProject(true);
  assert.equal(f.writes(), 1);
});

test('mismatch cause remains localized inside the existing protected-recovery warning', async () => {
  initLocale();
  try {
    const original = { ...createDemoProject(), audioName: 'original.wav' };
    const f = fixture(original, { audio: { name: 'different.wav', duration: 5 } }), restored = f.session();
    await restored.persistence.restore();
    for (const locale of ['ko', 'en', 'zh-CN']) {
      setLocale(locale, { persist: false });
      const cause = t('errors.storedMediaMismatch');
      assert.notEqual(cause, 'errors.storedMediaMismatch');
      assert.ok(restored.persistence.restoreMessage.includes(cause));
      assert.equal(restored.persistence.restorePhase, 'failed');
      assert.deepEqual(restored.model(), original);
    }
  } finally { initLocale(); }
});
