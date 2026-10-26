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
