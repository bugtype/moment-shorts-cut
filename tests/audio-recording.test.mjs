import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioRecording } from '../dist/audio-recording.mjs';

function fixture({ acquire, makeRecorder, onReady, onStateChange, clock } = {}) {
  const timers = new Map(), events = [], recorders = [];
  const track = { stops: 0, stop() { this.stops++; } };
  const stream = { getTracks: () => [track] };
  let nextTimer = 0, now = 0;
  const session = createAudioRecording({
    prepare: () => events.push('prepare'),
    onProgress: seconds => events.push(['progress', seconds]),
    onReady: async (file, owner) => {
      events.push(['file', file, owner]);
      await onReady?.(file, owner);
    },
    onError: message => events.push(['error', message]),
    onIdle: () => events.push('idle'),
    onStateChange,
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
    setTimer: (callback, delay) => { assert.equal(delay, 1000); timers.set(++nextTimer, () => {now += 1000; callback();}); return nextTimer; },
    clearTimer: timer => timers.delete(timer),
    clock: clock || (() => now),
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

for (const [mimeType, extension] of [
  ['audio/ogg', 'oga'],
  ['audio/ogg;codecs=opus', 'oga'],
  [' Audio/Ogg ; codecs=vorbis', 'oga'],
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
  ['video/mp4', 'm4a'],
  ['audio/unknown', 'webm'],
  ['', 'webm'],
]) {
  test(`recording MIME ${JSON.stringify(mimeType)} uses the expected filename without changing data`, async () => {
    const f = fixture();
    await f.session.start(() => true);
    const recorder = f.session.current, chunk = { size: 5 };
    recorder.mimeType = mimeType;
    recorder.ondataavailable({ data: chunk });
    f.session.stop();
    await recorder.onstop();
    const files = f.events.filter(event => event[0] === 'file');
    assert.equal(files.length, 1);
    assert.equal(files[0][1].name, `내 목소리.${extension}`);
    assert.equal(files[0][1].type, mimeType, 'Do not rewrite MIME parameters');
    assert.equal(files[0][1].parts[0], chunk, 'Do not read or transcode chunks');
    assert.equal(f.track.stops, 1);
    assert.equal(f.timers.size, 0);
    assert.equal(f.session.current, null);
    assert.equal(f.session.requesting, false);
    assert.equal(f.events.filter(event => event[0] === 'error').length, 0);
  });
}

test('final data supplies the recording MIME only when the inactive recorder has cleared it', async () => {
  for (const [mime, extension, reset, manual] of [
    ['audio/ogg;codecs=opus', 'oga', true, true],
    ['audio/mp4;codecs=mp4a.40.2', 'm4a', true, false],
    ['audio/webm', 'webm', false, true],
  ]) {
    const f = fixture();
    await f.session.start(() => true);
    const recorder = f.session.current, stopped = recorder.onstop;
    recorder.mimeType = mime;
    const empty = new Blob([], {type: 'audio/mp4'}), untyped = new Blob(['head']);
    const chunk = new Blob(['synthetic recording'], {type: reset ? mime : 'audio/ogg'});
    recorder.ondataavailable({data: empty}); recorder.ondataavailable({data: untyped});
    if (manual) f.session.stop(); else recorder.state = 'inactive';
    if (reset) recorder.mimeType = '';
    recorder.ondataavailable({data: chunk});
    await stopped(); await stopped();
    const files = f.events.filter(event => event[0] === 'file');
    assert.equal(files.length, 1); assert.equal(files[0][1].name, `내 목소리.${extension}`);
    assert.equal(files[0][1].type, mime, 'Existing recorder MIME stays authoritative when nonempty');
    assert.deepEqual(files[0][1].parts, [untyped, chunk]);
    assert.equal(files[0][1].parts[0], untyped); assert.equal(files[0][1].parts[1], chunk);
    assert.equal(f.track.stops, 1); assert.equal(f.timers.size, 0); assert.equal(f.session.current, null);
    assert.equal(f.events.filter(event => event[0] === 'error').length, 0);
  }
});


test('elapsed time is read-only recorder state, retained through handoff and reset for a new recording', async () => {
  let finish;
  const states = [], f = fixture({onStateChange: () => states.push([
    f.session.requesting, f.session.current?.state ?? null, f.session.elapsed,
  ]), onReady: () => new Promise(resolve => {finish = resolve;})});
  assert.equal(f.session.elapsed, 0);
  assert.throws(() => {f.session.elapsed = 42;}, TypeError);
  await f.session.start(() => true);
  const tick = [...f.timers.values()][0], recorder = f.session.current;
  tick(); tick();
  assert.equal(f.session.elapsed, 2);
  recorder.ondataavailable({data: {size: 1}});
  f.session.stop();
  const pending = recorder.onstop();
  assert.equal(f.session.elapsed, 2);
  assert.deepEqual(states, [[true, null, 0], [false, 'recording', 0],
    [false, 'inactive', 2], [false, 'inactive', 2]]);
  assert.deepEqual(f.events.filter(event => event[0] === 'progress'),
    [['progress', 0], ['progress', 1], ['progress', 2]], 'State notifications are not extra timer ticks');
  finish(); await pending;
  assert.equal(f.session.elapsed, 0);
  await f.session.start(() => true);
  assert.equal(f.session.elapsed, 0);
  tick();
  assert.equal(f.session.elapsed, 0, 'Old timer cannot advance the new recording');
  f.session.current.onerror();
});

test('delayed recording callbacks measure active time and stop at the existing elapsed threshold', async () => {
  let now = 0, grant, reads = 0;
  const f = fixture({acquire: () => new Promise(resolve => {grant = resolve;}),
    clock: () => {reads++; return now;}});
  const pending = f.session.start(() => true);
  now = 200000; grant(f.stream); await pending;
  assert.equal(f.session.elapsed, 0, 'Permission wait is not recording time');
  const recorder = f.session.current, tick = [...f.timers.values()][0], stopped = recorder.onstop;
  for (const [time, elapsed] of [[200000, 0], [205000, 5], [205000, 5], [379999, 179]]) {
    now = time; tick(); assert.equal(f.session.elapsed, elapsed); assert.equal(recorder.stopCalls, 0);
  }
  now = 380250; tick();
  assert.equal(f.session.elapsed, 180); assert.equal(recorder.stopCalls, 1); assert.equal(f.timers.size, 0);
  const beforeLate = reads; now = 500000; tick(); f.session.stop();
  assert.equal(reads, beforeLate); assert.equal(recorder.stopCalls, 1);
  recorder.ondataavailable({data: {size: 1}}); await stopped();
  assert.equal(f.track.stops, 1); assert.equal(f.session.current, null);
  assert.deepEqual(f.events.filter(event => event[0] === 'progress'),
    [['progress', 0], ['progress', 0], ['progress', 5], ['progress', 5], ['progress', 179], ['progress', 180]]);
  now = 600000; const retry = f.session.start(() => true);
  now = 700000; grant(f.stream); await retry;
  assert.equal(f.session.elapsed, 0);
  const current = f.session.current, nextTick = [...f.timers.values()][0];
  now = 701000; nextTick(); assert.equal(f.session.elapsed, 1);
  const beforeStale = reads; tick(); await stopped();
  assert.equal(reads, beforeStale); assert.equal(f.session.current, current); assert.equal(f.session.elapsed, 1);
  current.ondataavailable({data: {size: 2}}); f.session.stop(); await current.onstop();
  assert.equal(f.track.stops, 2); assert.equal(f.events.filter(event => event[0] === 'file').length, 2);

  const failed = fixture({clock: () => {throw new Error('Synthetic initial clock failure');}});
  await failed.session.start(() => true);
  assert.equal(failed.session.current, null); assert.equal(failed.session.requesting, false);
  assert.equal(failed.track.stops, 1); assert.equal(failed.recorders[0].stopCalls, 1);
  assert.equal(failed.timers.size, 0); assert.equal(failed.events.filter(event => event[0] === 'error').length, 1);
});

test('optional presentation observers cannot strand requests, finalization or native cleanup', async () => {
  const f = fixture({onStateChange: () => {throw new Error('Synthetic UI observer failure');}});
  await f.session.start(() => true);
  assert.equal(f.session.requesting, false);
  const recorder = f.session.current;
  recorder.ondataavailable({data: {size: 1}});
  f.session.stop(); await recorder.onstop();
  assert.equal(f.track.stops, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.session.current, null);
  assert.equal(f.events.filter(event => event === 'idle').length, 1);
  assert.equal(f.events.filter(event => event[0] === 'error').length, 0);
  const rejected = fixture({acquire: async () => {throw new Error('Synthetic denial');},
    onStateChange: () => {throw new Error('Synthetic UI observer failure');}});
  await rejected.session.start(() => true);
  assert.equal(rejected.session.requesting, false);
  assert.equal(rejected.session.current, null);
  assert.equal(rejected.events.filter(event => event[0] === 'error').length, 1);
});

test('a null state observer retains the existing progress and idle lifecycle', async () => {
  const f = fixture({onStateChange: null});
  await f.session.start(() => true);
  f.session.current.onerror();
  assert.deepEqual(f.events.filter(event => event[0] === 'progress'), [['progress', 0]]);
  assert.equal(f.events.filter(event => event === 'idle').length, 1);
  assert.equal(f.track.stops, 1);
});
