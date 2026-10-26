import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {createMediaStorageFixture} from './fixtures/media-storage.mjs';
import {createProjectStore} from '../dist/project-store.mjs';
import {createProjectPersistence} from '../dist/project-persistence.mjs';
import {createDemoProject} from '../dist/core/project.mjs';

async function appFixture() {
  const f = await createAppFixture(), storage = createMediaStorageFixture(), writes = [], events = new Map();
  f.context.generatedStore = createProjectStore(storage.factory);
  f.context.localStorage.setItem = (key, value) => writes.push([key, value]);
  f.context.window.addEventListener = (name, callback) => events.set(name, callback);
  const run = code => vm.runInContext(code, f.context);
  run('Object.assign(projectStore, generatedStore); bindUi(app)');
  const warns = () => {
    let warned = false;
    events.get('beforeunload')({preventDefault() { warned = true; }});
    return warned;
  };
  return {...f, run, storage, writes, warns};
}
const failedWrite = () => new DOMException('Synthetic media deletion failure', 'UnknownError');

for (const action of ['remove last audio', 'reset video and audio']) {
  test(`actual Save retries ${action} after media deletion fails, without reattaching old files`, async () => {
    const f = await appFixture();
    f.run("sources.audioFile = {name:'generated-voice.wav'}; state.audioName = sources.audioFile.name");
    if (action.startsWith('reset')) f.run("sources.videoFile = {name:'generated-video.mp4'}; state.kind = 'video'; state.fileName = sources.videoFile.name");
    f.run("switchPanel('audio')"); await f.element('#saveButton').onclick();
    f.storage.failures.push(failedWrite());
    if (action.startsWith('reset')) { f.run('confirmReset()'); f.element('#confirmReset').onclick(); }
    else f.element('#removeAudio').onclick();
    await f.run('persistence.pendingSave.catch(() => {})');
    const authored = f.evaluate('({state,history,future})'), stored = [...f.storage.records];
    await f.run('saveProject()');
    assert.equal(f.storage.attempts.length, 2, 'autosave does not retry failed media work');
    assert.equal(f.writes.length, 1); assert.equal(f.warns(), true);
    f.storage.failures.push(failedWrite()); await f.element('#saveButton').onclick();
    assert.equal(f.storage.attempts.length, 3, 'explicit Save must retry even without attached files');
    assert.deepEqual([...f.storage.records], stored); assert.equal(f.writes.length, 1);
    assert.equal(f.element('#saveStatusText').getAttribute('data-i18n'), 'errors.checkStorage');
    await f.element('#saveButton').onclick();
    assert.equal(f.storage.attempts.length, 4); assert.equal(f.storage.records.size, 0);
    assert.equal(f.writes.length, 2); assert.equal(JSON.parse(f.writes.at(-1)[1]).audioName, '');
    assert.deepEqual(f.evaluate('({state,history,future})'), authored);
    assert.equal(f.element('#saveStatusText').getAttribute('data-i18n'), 'errors.saved');
    assert.equal(f.warns(), false);
    await f.element('#saveButton').onclick();
    assert.equal(f.storage.attempts.length, 4, 'successful empty save does not keep deleting media');
  });
}

test('actual leave guard tracks a failed media-only deletion even when metadata returns to baseline', async () => {
  const f = await appFixture(), baseline = f.evaluate('state');
  f.run("sources.audioFile = {name:'generated-unsaved.wav'}; state.audioName = sources.audioFile.name; persistMedia(); switchPanel('audio')");
  await f.run('persistence.pendingSave');
  f.storage.failures.push(failedWrite()); f.element('#removeAudio').onclick();
  await f.run('persistence.pendingSave.catch(() => {})');
  assert.deepEqual(f.evaluate('state'), baseline); assert.equal(f.writes.length, 0);
  assert.equal(f.storage.records.has('audio'), true);
  assert.equal(f.warns(), true, 'unchanged metadata is not proof that requested media deletion persisted');
  await f.element('#saveButton').onclick();
  assert.equal(f.storage.records.size, 0); assert.equal(f.warns(), false);
  assert.deepEqual(f.evaluate('state'), baseline);
});

function persistenceFixture(store) {
  const project = createDemoProject(), sources = {videoFile:null, audioFile:null}, writes = [];
  const persistence = createProjectPersistence({store, sources, getProject:() => project,
    saveStatus() {}, toast() {}, pause() {}}, {clearTimer() {}, writeSettings:(_key, value) => writes.push(value)});
  persistence.restorePhase = 'ready';
  return {project, sources, persistence, writes};
}

test('an older successful media write cannot clear the newest failed deletion or its retry', async () => {
  const storage = createMediaStorageFixture(), f = persistenceFixture(createProjectStore(storage.factory));
  await f.persistence.saveProject();
  storage.failures.push(null, failedWrite());
  f.sources.audioFile = {name:'generated-pending.wav'}; f.persistence.persistMedia();
  f.sources.audioFile = null; f.persistence.persistMedia();
  await f.persistence.pendingSave.catch(() => {});
  assert.equal(storage.attempts.length, 2); assert.equal(storage.records.has('audio'), true);
  assert.equal(f.persistence.hasUnsavedChanges(), true);
  await f.persistence.saveProject(true);
  assert.equal(storage.attempts.length, 3); assert.equal(storage.records.size, 0);
  assert.equal(f.persistence.hasUnsavedChanges(), false);
});

test('concurrent explicit retries capture current files and wait for the newest request', async () => {
  const requests = [], store = {setMedia(video, audio) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.push({video, audio, resolve, reject}); return promise;
  }};
  const f = persistenceFixture(store); await f.persistence.saveProject();
  f.persistence.persistMedia(); requests[0].reject(failedWrite()); await f.persistence.pendingSave.catch(() => {});
  const first = f.persistence.saveProject(true); assert.equal(requests.length, 2);
  const latest = {name:'new-current-audio.wav'}; f.sources.audioFile = latest; f.project.audioName = latest.name;
  f.persistence.persistMedia();
  const second = f.persistence.saveProject(true); assert.equal(requests.length, 4);
  requests[1].resolve(); requests[2].resolve();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.writes.length, 1, 'no retry saves metadata before the newest media request finishes');
  assert.equal(f.persistence.hasUnsavedChanges(), true);
  assert.equal(requests[1].audio, null); assert.equal(requests[2].audio, latest); assert.equal(requests[3].audio, latest);
  requests[3].resolve(); await Promise.all([first, second]);
  assert.equal(JSON.parse(f.writes.at(-1)).audioName, latest.name);
  assert.equal(f.persistence.hasUnsavedChanges(), false);
});

test('fresh empty saves and failed restore do not request media persistence', async () => {
  const storage = createMediaStorageFixture(); let opens = 0;
  const f = persistenceFixture(createProjectStore({open() { opens++; return storage.factory.open(); }}));
  await f.persistence.saveProject(); await f.persistence.saveProject(true);
  assert.equal(opens, 0); assert.equal(f.persistence.hasUnsavedChanges(), false);
  storage.failures.push(failedWrite()); f.persistence.persistMedia(); await f.persistence.pendingSave.catch(() => {});
  f.persistence.restorePhase = 'failed'; f.persistence.recoveryBaseline = JSON.stringify(f.project);
  await f.persistence.saveProject(true); f.persistence.persistMedia();
  assert.equal(storage.attempts.length, 1); assert.equal(f.persistence.hasUnsavedChanges(), false);
});
