import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSources } from '../dist/media-sources.mjs';
import { createProjectPersistence } from '../dist/project-persistence.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

function element() {
  const events = new Map();
  return {
    events, duration: 12,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name),
    removeAttribute() {},
  };
}
function mediaFixture() {
  const video = element(), audio = element(), log = [];
  let timeout;
  const sources = createMediaSources({ video, audio }, {
    createURL: file => 'blob:' + file.name,
    revokeURL: url => log.push(['revoke', url]),
    createCanvas: () => ({
      getContext: () => ({ drawImage: () => log.push('draw') }),
      toDataURL: () => 'thumbnail',
    }),
    setTimer: callback => { timeout = callback; return 1; },
    clearTimer: timer => log.push(['clear', timer]),
  });
  return { sources, video, audio, log, timeout: () => timeout() };
}

test('media readiness clears listeners on success, error and timeout', async () => {
  for (const outcome of ['loadeddata', 'error', 'timeout']) {
    const f = mediaFixture(), pending = f.sources.waitForMedia(f.video, 'loadeddata', 'decode failed');
    if (outcome === 'timeout') f.timeout();
    else f.video.events.get(outcome)();
    if (outcome === 'loadeddata') await pending;
    else await assert.rejects(pending, outcome === 'error' ? /decode failed/ : /초과/);
    assert.equal(f.video.events.size, 0);
    assert.deepEqual(f.log, [['clear', 1]]);
  }
});

test('video replacement retains thumbnail creation and explicit reset releases both URLs', async () => {
  const f = mediaFixture();
  f.sources.sourceURL = 'blob:old';
  f.sources.audioURL = 'blob:audio';
  const pending = f.sources.setVideoFile({ name: 'next.mp4' });
  assert.equal(f.video.src, 'blob:next.mp4');
  f.video.events.get('loadeddata')();
  await pending;
  assert.equal(f.sources.thumbnail, 'thumbnail');
  f.sources.reset();
  assert.deepEqual(f.log.filter(Array.isArray), [
    ['revoke', 'blob:old'], ['clear', 1], ['revoke', 'blob:next.mp4'], ['revoke', 'blob:audio'],
  ]);
  assert.equal(f.sources.sourceURL, '');
  assert.equal(f.sources.audioURL, '');
  assert.equal(f.sources.thumbnail, '');
});

function persistenceFixture(raw = null) {
  let project = createDemoProject();
  const writes = [], statuses = [], timers = [];
  const sources = { videoFile: null, audioFile: null, restore: async () => {} };
  const store = { get: async () => null, setMedia: async () => {} };
  const native = { readSettings: () => raw };
  const persistence = createProjectPersistence({
    store, sources, getProject: () => project, replaceProject: next => { project = next; },
    saveStatus: (...args) => statuses.push(args), toast() {}, pause() {},
  }, {
    readSettings: key => native.readSettings(key),
    writeSettings: (key, value) => writes.push([key, value]),
    setTimer: callback => { timers.push(callback); return callback; },
    clearTimer() {},
  });
  return { persistence, sources, store, native, writes, statuses, timers, project: () => project };
}

test('restore failure retains valid settings and blocks even previously queued saves', async () => {
  const saved = createDemoProject(); saved.name = 'recoverable'; saved.audioName = 'missing.wav';
  const f = persistenceFixture(JSON.stringify(saved));
  f.sources.restore = async (project, read, stage) => {
    assert.equal(f.project(), project);
    stage('저장된 오디오 파일을 찾을 수 없습니다');
    throw new Error('missing');
  };
  await f.persistence.restore();
  assert.equal(f.persistence.restorePhase, 'failed');
  assert.equal(f.persistence.settingsUnavailable(), false);
  assert.deepEqual(f.project(), saved);
  f.persistence.scheduleSave(); f.persistence.persistMedia(); await f.persistence.saveProject(true);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.timers, []);
  assert.match(f.persistence.restoreMessage, /변경사항은 저장되지 않습니다/);
});

test('save waits for the latest queued media write and rechecks the restore lock', async () => {
  for (const failedRestore of [false, true]) {
    const f = persistenceFixture(); await f.persistence.restore();
    let releaseFirst, releaseLast;
    f.persistence.pendingSave = new Promise(resolve => { releaseFirst = resolve; });
    const saving = f.persistence.saveProject();
    f.persistence.pendingSave = new Promise(resolve => { releaseLast = resolve; });
    releaseFirst(); await Promise.resolve();
    assert.deepEqual(f.writes, []);
    if (failedRestore) {
      f.native.readSettings = () => 'invalid';
      await f.persistence.restore();
    }
    releaseLast(); await saving;
    assert.equal(f.writes.length, failedRestore ? 0 : 1);
  }
});
