import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectStore } from '../dist/project-store.mjs';
import { createProjectPersistence } from '../dist/project-persistence.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
// Models close-pending, late transaction completion and forced aborts, not native IndexedDB.
function fixture() {
  const records = new Map(), connections = [], transactions = [], writes = [], openFailures = [];
  let hold = false, opens = 0;
  const factory = { open() {
    const request = {}, failure = openFailures.shift(); opens++;
    queueMicrotask(() => {
      if (failure) { request.error = failure; request.onerror(); return; }
      const db = { closed: false, close() { this.closed = true; }, transaction(_name, mode) {
        if (db.closed) throw new DOMException('Connection is closed', 'InvalidStateError');
        const tx = { db, requests: [], changes: [], done: false };
        tx.objectStore = () => ({
          get(key) { const request = {}; tx.requests.push({key, request}); return request; },
          put(value, key) { tx.changes.push([key, structuredClone(value)]); },
          delete(key) { tx.changes.push([key, null]); },
        });
        tx.finish = () => {
          if (tx.done) return;
          tx.done = true;
          for (const [key, value] of tx.changes) value === null ? records.delete(key) : records.set(key, value);
          for (const {key, request} of tx.requests) {
            request.result = structuredClone(records.get(key)); request.onsuccess?.();
          }
          tx.oncomplete?.();
        };
        tx.abort = () => {
          if (tx.done) return;
          tx.done = true; tx.error = new DOMException('Forced connection close', 'AbortError');
          for (const {request} of tx.requests) { request.error = tx.error; request.onerror?.(); }
          tx.onabort?.();
        };
        transactions.push(tx);
        if (mode === 'readwrite') writes.push(tx.changes);
        if (!hold) queueMicrotask(tx.finish);
        return tx;
      } };
      connections.push(db); request.result = db; request.onsuccess();
    });
    return request;
  } };
  const invalidate = (type, db = connections.at(-1)) => {
    if (type === 'versionchange') db.onversionchange({newVersion:null});
    else {
      db.closed = true;
      for (const tx of transactions.filter(tx => tx.db === db)) tx.abort();
      db.onclose?.();
    }
  };
  return { store:createProjectStore(factory), records, connections, transactions, writes, openFailures, invalidate,
    hold(value = true) { hold = value; }, get opens() { return opens; } };
}
const media = () => [{name:'original.mp4'}, {name:'voice.wav'}];

for (const type of ['versionchange', 'close']) {
  test(`${type}: a requested save reopens and rewrites the same media after connection invalidation`, async () => {
    const f = fixture(), [video, audio] = media(); await f.store.setMedia(video, audio);
    f.invalidate(type); f.records.clear();
    assert.equal(f.opens, 1, 'invalidation does not itself reopen or save');
    assert.equal(f.writes.length, 1);
    await f.store.setMedia(video, audio);
    assert.equal(f.opens, 2);
    assert.deepEqual(Object.fromEntries(f.records), {video,audio});
    assert.deepEqual(f.writes[1], [['video',video], ['audio',audio]]);
    await f.store.setMedia(video, audio);
    assert.equal(f.writes.length, 2, 'deduplication resumes only for the current connection');
  });

  test(`${type}: the next changed-audio save cannot omit the invalidated cached video`, async () => {
    const f = fixture(), [video, audio] = media(); await f.store.setMedia(video, audio);
    f.invalidate(type); f.records.clear();
    const replacement = {name:'replacement.wav'};
    await f.store.setMedia(video, replacement);
    assert.deepEqual(Object.fromEntries(f.records), {video,audio:replacement});
    assert.deepEqual(f.writes[1], [['video',video], ['audio',replacement]]);
  });

  test(`${type}: cached absence cannot skip requested deletes in a recreated store`, async () => {
    const f = fixture(); await f.store.setMedia(null, null); f.invalidate(type);
    f.records.set('video', {name:'external.mp4'}); f.records.set('audio', {name:'external.wav'});
    await f.store.setMedia(null, null);
    assert.equal(f.records.size, 0);
    assert.equal(f.opens, 2);
  });
}

test('late successful read from a closing connection cannot refill the new committed cache', async () => {
  const f = fixture(), [video] = media(); await f.store.setMedia(video, null);
  f.hold(); const reading = f.store.get('video'); await settle();
  const pending = f.transactions.at(-1); f.invalidate('versionchange');
  pending.finish(); const loaded = await reading;
  f.records.clear(); f.hold(false); // Delete completes only after the old read transaction finishes.
  await f.store.setMedia(loaded, null);
  assert.equal(f.opens, 2);
  assert.deepEqual(f.records.get('video'), video);
});

test('late committed write cannot refill the new cache or make a queued repair skip media', async () => {
  const f = fixture(), [video, audio] = media(); await f.store.setMedia(video, null);
  f.hold(); const first = f.store.setMedia(video, audio); await settle();
  const pending = f.transactions.at(-1); f.invalidate('versionchange');
  const latest = f.store.setMedia(video, audio);
  pending.finish(); f.records.clear(); f.hold(false);
  await first; await latest;
  assert.equal(f.opens, 2);
  assert.deepEqual(Object.fromEntries(f.records), {video,audio});
  assert.deepEqual(f.writes.at(-1), [['video',video], ['audio',audio]]);
});

test('forced close aborts the in-flight save and the next explicit save can reconnect', async () => {
  const f = fixture(), [video, audio] = media(); await f.store.setMedia(video, null);
  f.hold(); const failed = assert.rejects(f.store.setMedia(video, audio), {name:'AbortError'}); await settle();
  f.invalidate('close'); await failed; f.hold(false);
  await f.store.setMedia(video, audio);
  assert.equal(f.opens, 2);
  assert.deepEqual(Object.fromEntries(f.records), {video,audio});
});

test('a delayed old close callback cannot invalidate a replacement connection or its dedup cache', async () => {
  const f = fixture(), [video, audio] = media(); await f.store.setMedia(video, audio);
  const old = f.connections[0], oldClose = old.onclose;
  f.invalidate('versionchange'); f.records.clear(); await f.store.setMedia(video, audio);
  assert.equal(typeof oldClose, 'function'); oldClose();
  await f.store.setMedia(video, audio);
  assert.equal(f.opens, 2); assert.equal(f.writes.length, 2);
  assert.equal(f.connections[1].closed, false);
});

test('failed reopen is not reported as saved and the next requested save retries normally', async () => {
  const f = fixture(), [video, audio] = media(); await f.store.setMedia(video, audio);
  f.invalidate('versionchange'); f.records.clear();
  f.openFailures.push(new DOMException('Storage unavailable', 'UnknownError'));
  await assert.rejects(f.store.setMedia(video, audio), {name:'UnknownError'});
  assert.equal(f.records.size, 0); assert.equal(f.writes.length, 1);
  await f.store.setMedia(video, audio);
  assert.equal(f.opens, 3); assert.deepEqual(Object.fromEntries(f.records), {video,audio});
});

test('get after abnormal closure uses a fresh connection instead of a permanently closed handle', async () => {
  const f = fixture(), [video] = media(); await f.store.setMedia(video, null); f.invalidate('close');
  assert.deepEqual(await f.store.get('video'), video);
  assert.equal(f.opens, 2);
});

for (const type of ['versionchange', 'close']) {
  test(`${type}: explicit project Save cannot report success with missing media after invalidation`, async () => {
    const f = fixture(), [video, audio] = media(), writes = [], statuses = [];
    const project = {...createDemoProject(), kind:'video', fileName:video.name, audioName:audio.name};
    const persistence = createProjectPersistence({
      store:f.store, sources:{videoFile:video,audioFile:audio}, getProject:() => project,
      saveStatus:value => statuses.push(value), toast() {}, pause() {},
    }, {
      clearTimer() {}, writeSettings:(key,value) => writes.push([key,JSON.parse(value)]),
    });
    persistence.restorePhase = 'ready';
    await persistence.saveProject(true);
    f.invalidate(type); f.records.clear();
    assert.equal(writes.length, 1, 'connection notification does not write project settings');
    await persistence.saveProject(true);
    assert.equal(writes.length, 2);
    assert.equal(statuses.at(-1).messageKey, 'errors.saved');
    assert.deepEqual(Object.fromEntries(f.records), {video,audio});
    assert.deepEqual(writes[1], ['moment-state-v1',project]);
  });
}

function persistenceFixture(storage, video = null, audio = null) {
  const sources = {videoFile:video, audioFile:audio}, settings = [], statuses = [], notices = [], timers = [];
  const project = {...createDemoProject(), ...(video ? {kind:'video', fileName:video.name} : {}), audioName:audio?.name || ''};
  const persistence = createProjectPersistence({
    store:storage.store, sources, getProject:() => project,
    saveStatus:(value, ok) => statuses.push([value, ok]), toast:value => notices.push(value), pause() {},
  }, {
    clearTimer() {}, setTimer:callback => { timers.push(callback); return callback; },
    writeSettings:(key,value) => settings.push([key,JSON.parse(value)]),
  });
  persistence.restorePhase = 'ready';
  return {persistence, sources, project, settings, statuses, notices, timers};
}
const statusKey = f => f.statuses.at(-1)?.[0].messageKey;

for (const type of ['versionchange', 'close']) for (const kind of ['video', 'audio', 'both']) {
  test(`${type}: ${kind} metadata autosave warns without repopulating invalidated media; explicit Save repairs it`, async () => {
    const storage = fixture(), [video,audio] = media();
    const f = persistenceFixture(storage, kind === 'audio' ? null : video, kind === 'video' ? null : audio);
    await f.persistence.saveProject(true);
    assert.equal(statusKey(f), 'errors.saved');
    storage.invalidate(type); storage.records.clear(); f.project.name = 'Edited after invalidation';
    f.notices.length = 0;
    f.persistence.scheduleSave(); await f.timers.at(-1)();
    assert.equal(f.settings.at(-1)[1].name, f.project.name, 'metadata edits still persist');
    assert.equal(statusKey(f), 'errors.checkStorage');
    assert.equal(f.statuses.at(-1)[1], false);
    await f.persistence.saveProject();
    assert.equal(statusKey(f), 'errors.checkStorage');
    assert.equal(storage.opens, 1, 'metadata autosave must not reopen browser media storage');
    assert.equal(storage.writes.length, 1);
    assert.equal(storage.records.size, 0, 'cleared media must not be silently repopulated');
    assert.deepEqual(f.notices, [], 'background autosaves do not create repeated toasts');
    await f.persistence.saveProject(true);
    assert.equal(statusKey(f), 'errors.saved');
    assert.equal(f.notices.at(-1).messageKey, 'errors.savedNotice');
    assert.equal(storage.opens, 2);
    assert.deepEqual(Object.fromEntries(storage.records), {
      ...(f.sources.videoFile ? {video} : {}), ...(f.sources.audioFile ? {audio} : {}),
    });
    await f.persistence.saveProject();
    assert.equal(statusKey(f), 'errors.saved');
    assert.equal(storage.writes.length, 2, 'healthy metadata autosave still does not rewrite media');
  });
}

for (const show of [false, true]) {
  test(`late old media commit cannot report saved after invalidation (explicit=${show})`, async () => {
    const storage = fixture(), [video,audio] = media(), f = persistenceFixture(storage, video);
    await f.persistence.saveProject(true);
    f.sources.audioFile = audio; f.project.audioName = audio.name; f.notices.length = 0;
    storage.hold();
    if (!show) f.persistence.persistMedia();
    const saving = f.persistence.saveProject(show); await settle();
    const pending = storage.transactions.at(-1); storage.invalidate('versionchange');
    pending.finish(); storage.records.clear(); await saving;
    assert.equal(statusKey(f), 'errors.checkStorage');
    assert.equal(f.statuses.at(-1)[1], false);
    assert.equal(f.settings.length, 2, 'completed metadata write is retained');
    assert.equal(storage.opens, 1); assert.equal(storage.records.size, 0);
    assert.deepEqual(f.notices.map(value => value.messageKey), show ? ['errors.checkStorage'] : []);
  });
}

test('late old read cannot confirm media for metadata autosave after invalidation', async () => {
  const storage = fixture(), [video] = media(), f = persistenceFixture(storage, video);
  await f.persistence.saveProject(true);
  storage.hold(); const reading = storage.store.get('video'); await settle();
  const pending = storage.transactions.at(-1); storage.invalidate('versionchange'); pending.finish();
  f.sources.videoFile = await reading; storage.records.clear();
  await f.persistence.saveProject();
  assert.equal(statusKey(f), 'errors.checkStorage');
  assert.equal(storage.opens, 1); assert.equal(storage.records.size, 0);
});

test('reopening and reading only one file cannot confirm all attached media', async () => {
  const storage = fixture(), [video,audio] = media(), f = persistenceFixture(storage, video, audio);
  await f.persistence.saveProject(true); storage.invalidate('close');
  f.sources.videoFile = await storage.store.get('video');
  await f.persistence.saveProject();
  assert.equal(statusKey(f), 'errors.checkStorage');
  f.sources.audioFile = await storage.store.get('audio');
  await f.persistence.saveProject();
  assert.equal(statusKey(f), 'errors.saved', 'both current-connection restored references are confirmed');
  assert.equal(storage.writes.length, 1, 'read-only reconfirmation does not rewrite media');
});

test('a stale close notification cannot replace a repaired save status with a warning', async () => {
  const storage = fixture(), [video,audio] = media(), f = persistenceFixture(storage, video, audio);
  await f.persistence.saveProject(true); const oldClose = storage.connections[0].onclose;
  storage.invalidate('versionchange'); storage.records.clear(); await f.persistence.saveProject(true);
  oldClose(); await f.persistence.saveProject();
  assert.equal(statusKey(f), 'errors.saved');
  assert.equal(storage.opens, 2); assert.equal(storage.writes.length, 2);
});

for (const previouslyOpened of [false, true]) {
  test(`media-free demo metadata save needs no media connection (previously opened=${previouslyOpened})`, async () => {
    const storage = fixture(), f = persistenceFixture(storage);
    if (previouslyOpened) { await storage.store.setMedia(null, null); storage.invalidate('close'); }
    await f.persistence.saveProject(); await f.persistence.saveProject(true);
    assert.equal(statusKey(f), 'errors.saved');
    assert.equal(storage.opens, Number(previouslyOpened));
    assert.equal(storage.writes.length, Number(previouslyOpened));
    assert.equal(f.settings.length, 2);
  });
}

test('failed explicit repair keeps the warning and a later explicit Save can recover', async () => {
  const storage = fixture(), [video] = media(), f = persistenceFixture(storage, video);
  await f.persistence.saveProject(true); storage.invalidate('versionchange'); storage.records.clear();
  await f.persistence.saveProject(); f.notices.length = 0;
  storage.openFailures.push(new DOMException('Storage unavailable', 'UnknownError'));
  await f.persistence.saveProject(true);
  assert.equal(statusKey(f), 'errors.checkStorage');
  assert.equal(f.notices.at(-1).messageKey, 'errors.storageBlocked');
  assert.equal(storage.records.size, 0);
  await f.persistence.saveProject(true);
  assert.equal(statusKey(f), 'errors.saved');
  assert.deepEqual(storage.records.get('video'), video);
});

test('metadata autosave still waits for the newest queued media replacement before confirming storage', async () => {
  const storage = fixture(), [video,audio] = media(), f = persistenceFixture(storage, video);
  await f.persistence.saveProject(true); storage.hold();
  f.sources.audioFile = audio; f.project.audioName = audio.name; f.persistence.persistMedia();
  const saving = f.persistence.saveProject(); await settle();
  const first = storage.transactions.at(-1), latest = {name:'latest.wav'};
  f.sources.audioFile = latest; f.project.audioName = latest.name; f.persistence.persistMedia();
  first.finish(); storage.hold(false); await saving;
  assert.equal(statusKey(f), 'errors.saved');
  assert.equal(f.settings.at(-1)[1].audioName, latest.name);
  assert.deepEqual(storage.records.get('audio'), latest);
});
