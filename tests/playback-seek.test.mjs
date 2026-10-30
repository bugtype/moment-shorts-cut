import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayback} from '../dist/playback.mjs';

function fixture() {
  const timers = new Map(), listeners = new Set(), assignments = [];
  let timerId = 0, position = 0;
  const f = {timers, listeners, assignments, failure:null, getterFailure:null, cleanupFailure:false, synchronous:false};
  const video = {
    duration:12, readyState:2, seeking:false,
    get currentTime() { if (f.getterFailure) throw f.getterFailure; return position; },
    set currentTime(value) {
      assignments.push(value);
      if (f.synchronous) f.emit();
      if (f.failure) throw f.failure;
      position = value;
    },
    addEventListener(type, callback, options) {
      assert.equal(type, 'seeked'); assert.equal(options.once, true); listeners.add(callback);
    },
    removeEventListener(type, callback) {
      assert.equal(type, 'seeked'); listeners.delete(callback);
      if (f.cleanupFailure) throw new Error('secondary listener cleanup');
    },
  };
  f.video = video;
  f.emit = () => { for (const callback of [...listeners]) callback(); };
  f.expire = () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  };
  f.playback = createPlayback({video}, {
    setTimer(callback, delay) { assert.equal(delay, 10000); timers.set(++timerId, callback); return timerId; },
    clearTimer(id) { timers.delete(id); if (f.cleanupFailure) throw new Error('secondary timer cleanup'); },
  });
  return f;
}
const empty = f => assert.deepEqual([f.timers.size, f.listeners.size], [0, 0]);

test('failed seek setup releases its timer and listener with the original error, then permits retry', async () => {
  const f = fixture(), failure = new TypeError('synthetic currentTime failure');
  f.failure = failure;
  await assert.rejects(f.playback.seekVideo(2), error => error === failure);
  empty(f);
  f.failure = null;
  const retry = f.playback.seekVideo(3);
  assert.deepEqual([f.timers.size, f.listeners.size], [1, 1]);
  f.emit(); await retry; empty(f);
  assert.deepEqual(f.assignments, [2, 3]);

  f.getterFailure = failure;
  await assert.rejects(f.playback.seekVideo(4), error => error === failure);
  empty(f); assert.deepEqual(f.assignments, [2, 3]);

  f.getterFailure = null; f.failure = failure; f.cleanupFailure = true;
  await assert.rejects(f.playback.seekVideo(4), error => error === failure);
  empty(f); // Each cleanup was attempted even when the other threw.
});

test('seek success, ready fast path, clamping, timeout and synchronous first settlement remain unchanged', async () => {
  const f = fixture();
  await f.playback.seekVideo(0); empty(f); assert.deepEqual(f.assignments, []);
  for (const [time, expected] of [[-2, 0], [20, 11.999]]) {
    const pending = f.playback.seekVideo(time);
    assert.equal(f.assignments.at(-1), expected);
    f.emit(); await pending; empty(f);
  }
  const pending = f.playback.seekVideo(2);
  const rejected = assert.rejects(pending, error => error.messageKey === 'shell.seekTimeout');
  f.expire(); await rejected; empty(f);

  f.synchronous = true; f.failure = new Error('after synchronous seeked');
  await f.playback.seekVideo(3); empty(f);
});

test('failed seek setup removes only its own resources while another seek remains pending', async () => {
  const f = fixture(), first = f.playback.seekVideo(2);
  const [listener] = f.listeners, [timer] = f.timers.keys();
  f.failure = new Error('second seek failure');
  await assert.rejects(f.playback.seekVideo(3), error => error === f.failure);
  assert.deepEqual([...f.listeners], [listener]);
  assert.deepEqual([...f.timers.keys()], [timer]);
  f.failure = null; f.emit(); await first; empty(f);
});
