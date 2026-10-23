import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioRecording } from '../dist/audio-recording.mjs';

function fixture({ acquire, makeRecorder, onReady } = {}) {
  const timers = new Map(), events = [], recorders = [];
  const track = { stops: 0, stop() { this.stops++; } };
  const stream = { getTracks: () => [track] };
  let nextTimer = 0;
  const session = createAudioRecording({
    prepare: () => events.push('prepare'),
    onProgress: seconds => events.push(['progress', seconds]),
    onReady: async (file, owner) => {
      events.push(['file', file, owner]);
      await onReady?.(file, owner);
    },
    onError: message => events.push(['error', message]),
    onIdle: () => events.push('idle'),
  }, {
    acquireStream: acquire || (async () => stream),
    createRecorder: input => {
      const recorder = makeRecorder?.(input) || {
        state: 'inactive', mimeType: 'audio/webm', stopCalls: 0,
        start() { this.state = 'recording'; },
        stop() { this.stopCalls++; this.state = 'inactive'; },
      };
      recorders.push(recorder);
      return recorder;
    },
    createFile: (parts, name, options) => ({ parts, name, ...options }),
    setTimer: (callback, delay) => { assert.equal(delay, 1000); timers.set(++nextTimer, callback); return nextTimer; },
    clearTimer: timer => timers.delete(timer),
  });
  return { session, timers, events, recorders, stream, track };
}

test('capture hands off the final file once and owns its resources until handoff finishes', async () => {
  let release;
  const f = fixture({ onReady: () => new Promise(resolve => { release = resolve; }) });
  await f.session.start(() => true);
  assert.equal(f.session.requesting, false);
  const recorder = f.session.current;
  const lateData = recorder.ondataavailable, lateStop = recorder.onstop;
  const chunk = { size: 3 };
  recorder.ondataavailable({ data: chunk });
  f.session.stop();
  const handoff = lateStop();
  assert.equal(recorder.stopCalls, 1);
  assert.equal(f.track.stops, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.session.current, recorder);
  lateData({ data: { size: 99 } });
  await lateStop();
  const files = f.events.filter(event => event[0] === 'file');
  assert.equal(files.length, 1);
  assert.deepEqual(files[0][1], { parts: [chunk], name: '내 목소리.webm', type: 'audio/webm' });
  assert.equal(files[0][2], recorder);
  release();
  await handoff;
  assert.equal(f.session.current, null);
  assert.equal(recorder.ondataavailable, null);
  assert.equal(recorder.onstop, null);
  assert.equal(f.events.filter(event => event === 'idle').length, 1);
});

test('late microphone acquisition is released when the app rejects its original context', async () => {
  let resolve;
  const f = fixture({ acquire: () => new Promise(done => { resolve = done; }) });
  const pending = f.session.start(() => false);
  assert.equal(f.session.requesting, true);
  resolve(f.stream);
  await pending;
  assert.equal(f.session.requesting, false);
  assert.equal(f.session.current, null);
  assert.equal(f.track.stops, 1);
  assert.equal(f.recorders.length, 0);
  assert.equal(f.events.length, 1);
});

test('native failure releases tracks once and explicit retry ignores stale callbacks', async () => {
  const f = fixture();
  await f.session.start(() => true);
  const old = f.session.current, lateError = old.onerror, lateStop = old.onstop;
  lateError();
  lateError();
  await lateStop();
  assert.equal(f.track.stops, 1);
  assert.equal(old.stopCalls, 1);
  assert.equal(f.session.current, null);
  assert.equal(f.recorders.length, 1, 'No automatic retry');
  await f.session.start(() => true);
  const current = f.session.current;
  lateError();
  await lateStop();
  assert.equal(f.session.current, current);
  assert.equal(current.state, 'recording');
  assert.equal(f.track.stops, 1);
  assert.equal(f.events.filter(event => event[0] === 'error').length, 1);
  current.onerror();
});
