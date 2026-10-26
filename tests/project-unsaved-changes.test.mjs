import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {createMediaStorageFixture} from './fixtures/media-storage.mjs';
import {createProjectStore} from '../dist/project-store.mjs';
import {createProjectPersistence} from '../dist/project-persistence.mjs';
import {createDemoProject} from '../dist/core/project.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };
async function appFixture() {
  const f = await createAppFixture(), events = new Map(), timers = [], writes = [];
  let fail = false;
  f.context.window.addEventListener = (name, callback) => events.set(name, callback);
  f.context.setTimeout = (callback, delay) => { const timer = {callback,delay}; timers.push(timer); return timer; };
  f.context.clearTimeout = timer => { if (timer) timer.cancelled = true; };
  f.context.localStorage.setItem = (key, value) => {
    if (fail) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
    writes.push([key,value]);
  };
  vm.runInContext('bindUi(app)', f.context);
  const run = code => vm.runInContext(code, f.context);
  const leaves = () => {
    const event = {prevented:false, preventDefault() { this.prevented = true; }};
    events.get('beforeunload')(event);
    return event;
  };
  return {...f, run, leaves, timers, writes, fail(value = true) { fail = value; }};
}

test('actual leave guard warns during the metadata debounce gap without saving or toasting on unload', async () => {
  const f = await appFixture();
  assert.equal(f.leaves().prevented, false, 'untouched fresh demo is clean');
  f.run("edit(() => state.name = 'Unsaved synthetic edit')");
  const timer = f.timers.findLast(timer => timer.delay === 500), before = f.evaluate('({state,history,future})');
  const notices = f.element('#toast').textContent;
  assert.equal(f.leaves().prevented, true);
  assert.equal(f.leaves().returnValue, true);
  assert.equal(timer.cancelled, undefined, 'warning does not flush or cancel the pending save');
  assert.deepEqual(f.writes, []);
  assert.equal(f.element('#toast').textContent, notices);
  assert.deepEqual(f.evaluate('({state,history,future})'), before);
  await timer.callback();
  assert.equal(f.leaves().prevented, false);
  assert.equal(f.writes.length, 1);
});

test('actual failed settings save keeps leave warning until a successful explicit retry', async () => {
  const f = await appFixture();
  f.run("edit(() => state.name = 'Keep this after failure')"); f.fail();
  await f.run('saveProject()');
  assert.equal(f.element('#saveStatusText').getAttribute('data-i18n'), 'errors.checkStorage');
  assert.equal(f.leaves().prevented, true);
  assert.equal(f.writes.length, 0);
  f.fail(false); await f.run('saveProject(true)');
  assert.equal(f.leaves().prevented, false);
  assert.equal(JSON.parse(f.writes.at(-1)[1]).name, 'Keep this after failure');
});

test('actual Undo to confirmed state clears metadata warning and Redo restores it', async () => {
  const f = await appFixture();
  await f.run('saveProject()');
  f.run("edit(() => state.name = 'Changed after saving')");
  assert.equal(f.leaves().prevented, true);
  f.run('undo()'); assert.equal(f.leaves().prevented, false);
  f.run('undo(true)'); assert.equal(f.leaves().prevented, true);
  await f.run('saveProject()'); assert.equal(f.leaves().prevented, false);
});

test('actual save waits for latest media promise and captures edits made during the wait', async () => {
  const f = await appFixture(), first = deferred(), latest = deferred();
  f.context.firstSave = first.promise; f.context.latestSave = latest.promise;
  f.run("edit(() => state.name = 'First edit'); persistence.pendingSave = firstSave");
  const saving = f.run('saveProject()');
  f.run("edit(() => state.name = 'Latest edit'); persistence.pendingSave = latestSave");
  first.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.leaves().prevented, true); assert.equal(f.writes.length, 0);
  latest.resolve(); await saving;
  assert.equal(JSON.parse(f.writes.at(-1)[1]).name, 'Latest edit');
  assert.equal(f.leaves().prevented, false);
  f.run("edit(() => state.name = 'Even newer edit')");
  assert.equal(f.leaves().prevented, true);
});

for (const active of ['export', 'recording']) {
  test(`existing active-operation leave guard remains after a successful save: ${active}`, async () => {
    const f = await appFixture(); await f.run('saveProject()');
    assert.equal(f.leaves().prevented, false);
    if (active === 'export') f.run('exporting=true');
    else {
      f.context.navigator = {mediaDevices:{getUserMedia:async () => ({getTracks:() => [{stop() {}}]})}};
      f.context.MediaRecorder = class {
        state = 'inactive';
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; this.onstop?.(); }
      };
      await f.run('audioRecording.start(() => true)');
      assert.equal(f.run('audioRecording.current.state'), 'recording');
    }
    assert.equal(f.leaves().prevented, true);
    if (active === 'recording') f.run('audioRecording.stop()');
  });
}

test('actual failed-recovery edits remain protected and Undo returns to the recovery baseline', async () => {
  const f = await appFixture();
  f.context.localStorage.getItem = key => key === 'moment-state-v1' ? 'invalid' : null;
  await f.run('persistence.restore()');
  assert.equal(f.leaves().prevented, false);
  f.run("edit(() => state.name = 'Recovery-only edit')");
  assert.equal(f.leaves().prevented, true);
  await f.run('saveProject(true)');
  assert.equal(f.leaves().prevented, true); assert.equal(f.writes.length, 0);
  f.run('undo()'); assert.equal(f.leaves().prevented, false);
});

async function persistenceFixture(raw = null, files = {}) {
  const storage = createMediaStorageFixture(Object.entries(files)), requests = [], writes = [], statuses = [], notices = [];
  const store = createProjectStore({open() { const request = storage.factory.open(); requests.push(request); return request; }});
  let project = createDemoProject();
  const native = {raw, afterWrite() {}, fail:false};
  const sources = {videoFile:null, audioFile:null, async restore(_project, read) {
    [this.videoFile,this.audioFile] = await Promise.all([read('video'),read('audio')]);
  }};
  const persistence = createProjectPersistence({
    store, sources, getProject:() => project, replaceProject:value => { project = value; },
    saveStatus:(...args) => statuses.push(args), toast:value => notices.push(value), pause() {},
  }, {
    readSettings:() => native.raw,
    writeSettings:(key,value) => {
      if (native.fail) throw new DOMException('Synthetic settings failure','QuotaExceededError');
      writes.push([key,value]); native.afterWrite();
    },
    clearTimer() {}, setTimer() {},
  });
  await persistence.restore();
  return {persistence, store, storage, sources, requests, native, writes, statuses, notices,
    project:() => project, dirty:() => persistence.hasUnsavedChanges?.() ?? false};
}

test('normalized restored state, not raw pre-migration JSON, is the clean baseline', async () => {
  const original = createDemoProject(); delete original.schemaVersion;
  const raw = JSON.stringify(original, null, 2), f = await persistenceFixture(raw);
  assert.equal(f.persistence.restorePhase, 'ready');
  assert.equal(f.project().schemaVersion, 4); assert.notEqual(JSON.stringify(f.project()), raw);
  assert.equal(f.dirty(), false);
  f.project().name = 'Changed migrated project'; assert.equal(f.dirty(), true);
  await f.persistence.saveProject(); assert.equal(f.dirty(), false);
});

for (const type of ['versionchange', 'close']) for (const kind of ['video', 'audio', 'both']) {
  test(`${type}: ${kind} media invalidation stays dirty after metadata saves until explicit media repair`, async () => {
    const video = {name:'original.mp4'}, audio = {name:'voice.wav'};
    const files = {...(kind !== 'audio' ? {video} : {}), ...(kind !== 'video' ? {audio} : {})};
    const project = {...createDemoProject(), ...(files.video ? {kind:'video',fileName:video.name} : {}), audioName:files.audio?.name || ''};
    const f = await persistenceFixture(JSON.stringify(project), files);
    assert.equal(f.dirty(), false);
    const db = f.requests.at(-1).result; db[type === 'close' ? 'onclose' : 'onversionchange']();
    f.storage.records.clear();
    assert.equal(f.dirty(), true);
    f.project().name = 'Metadata saved with unconfirmed media'; await f.persistence.saveProject();
    assert.equal(f.dirty(), true);
    assert.equal(f.statuses.at(-1)[0].messageKey, 'errors.checkStorage');
    const before = {requests:f.requests.length, attempts:f.storage.attempts.length, writes:f.writes.length, statuses:f.statuses.length, notices:f.notices.length};
    f.dirty(); f.dirty();
    assert.deepEqual({requests:f.requests.length, attempts:f.storage.attempts.length, writes:f.writes.length, statuses:f.statuses.length, notices:f.notices.length}, before);
    assert.equal(f.storage.records.size, 0, 'query never repopulates deleted media');
    await f.persistence.saveProject(true);
    assert.equal(f.dirty(), false);
    assert.deepEqual(Object.fromEntries(f.storage.records), files);
  });
}

test('metadata baseline uses the exact written snapshot, not a newer project observed after the write', async () => {
  const f = await persistenceFixture(); f.project().name = 'Written snapshot';
  f.native.afterWrite = () => { f.project().name = 'Newer in-memory edit'; };
  await f.persistence.saveProject();
  assert.equal(JSON.parse(f.writes.at(-1)[1]).name, 'Written snapshot');
  assert.equal(f.dirty(), true);
  f.native.afterWrite = () => {}; await f.persistence.saveProject(); assert.equal(f.dirty(), false);
});

test('successful metadata baseline advances independently of unconfirmed media', async () => {
  const f = await persistenceFixture();
  f.sources.audioFile = {name:'unsaved.wav'}; f.project().audioName = 'unsaved.wav';
  f.project().name = 'Saved metadata'; await f.persistence.saveProject();
  assert.equal(f.dirty(), true);
  await f.store.setMedia(null, f.sources.audioFile);
  assert.equal(f.dirty(), false, 'confirming media needs no redundant metadata save');
});

test('late pending save and retained timer cannot clear protected restored state', async () => {
  const f = await appFixture(), pending = deferred();
  f.context.pendingMedia = pending.promise;
  f.run("edit(() => state.name = 'Old edit'); persistence.pendingSave = pendingMedia");
  const timer = f.timers.findLast(timer => timer.delay === 500), saving = f.run('saveProject()');
  f.context.localStorage.getItem = key => key === 'moment-state-v1' ? 'invalid' : null;
  await f.run('persistence.restore()');
  f.run("edit(() => state.name = 'Protected newer edit')");
  pending.resolve(); await saving; await timer.callback();
  assert.equal(f.leaves().prevented, true); assert.equal(f.writes.length, 0);
});

test('restoring does not compare against an unrelated old saved baseline', async () => {
  const f = await persistenceFixture(); f.project().name = 'Old unsaved edit';
  const reading = deferred(); f.sources.restore = () => reading.promise;
  f.native.raw = JSON.stringify(createDemoProject());
  const restoring = f.persistence.restore();
  assert.equal(f.persistence.restorePhase, 'restoring'); assert.equal(f.dirty(), false);
  reading.resolve(); await restoring;
  assert.equal(f.dirty(), false);
});
