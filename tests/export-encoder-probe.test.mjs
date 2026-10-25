import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSilentEncoderProbe } from '../qa/export-encoder-probe.mjs';
import { silentFrameSchedule } from '../qa/export-schedule.mjs';
import { outputDimensions, SUPPORTED_ASPECT_RATIOS } from '../dist/core/aspect-ratio.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const task = () => new Promise(resolve => setImmediate(resolve));

// These are controlled contracts, NOT a browser or native codec test.
function harness(options = {}) {
  const controller = new AbortController();
  const h = { frames: [], encoders: [], timers: new Set(), abortListeners: new Set(),
    calls: [], drawn: [], encoded: [], observedQueue: 0, clock: 0,
    failure: new Error('injected stage failure'), controller };
  function hit(stage) {
    h.calls.push(stage);
    options.entered?.[stage]?.resolve();
    if (options.throwAt === stage) throw h.failure;
  }
  h.signal = {
    get aborted() { return controller.signal.aborted; },
    addEventListener(type, callback, settings) {
      h.abortListeners.add(callback);
      controller.signal.addEventListener(type, callback, settings);
      hit('addAbort');
    },
    removeEventListener(type, callback) {
      h.abortListeners.delete(callback);
      controller.signal.removeEventListener(type, callback);
      hit('removeAbort');
    },
  };
  class VideoFrame {
    constructor(canvas, init) {
      hit('frameConstruct');
      this.init = { ...init };
      this.closed = false;
      h.frames.push(this);
      options.frameConstruct?.(this, h);
    }
    close() {
      assert.equal(this.closed, false, 'frame closes once');
      this.closed = true;
      hit('frameClose');
      options.frameClose?.(this, h);
    }
  }
  class VideoEncoder {
    static isConfigSupported(config) {
      hit('support');
      h.supportRequest = { ...config };
      return options.support ? options.support(config, h) : Promise.resolve({ supported: true, config });
    }
    constructor(callbacks) {
      hit('construct');
      this.callbacks = callbacks;
      this.state = 'unconfigured';
      this.encodeQueueSize = 0;
      this.listeners = new Set();
      h.encoders.push(this);
    }
    addEventListener(type, callback) { this.listeners.add(callback); hit('addDequeue'); }
    removeEventListener(type, callback) { this.listeners.delete(callback); hit('removeDequeue'); }
    configure(config) {
      hit('configure');
      this.state = 'configured';
      h.configured = { ...config };
      options.configure?.(this, h);
    }
    encode(frame, settings) {
      hit('encode');
      assert.equal(frame.closed, false);
      this.encodeQueueSize++;
      h.observedQueue = Math.max(h.observedQueue, this.encodeQueueSize);
      const chunk = { timestamp: frame.init.timestamp, duration: frame.init.duration,
        byteLength: 8, type: settings.keyFrame ? 'key' : 'delta' };
      h.encoded.push(chunk);
      options.encode?.(chunk, this, h);
      if (!options.holdQueue) this.encodeQueueSize--;
      if (!options.outputMode) this.callbacks.output(options.chunk ? options.chunk(chunk, h) : chunk);
    }
    flush() {
      hit('flush');
      if (options.outputMode === 'flush') {
        const chunks = options.reverse ? [...h.encoded].reverse() : h.encoded;
        for (const chunk of chunks) this.callbacks.output(options.chunk ? options.chunk(chunk, h) : chunk);
      }
      return options.flush ? options.flush(this, h) : Promise.resolve();
    }
    close() {
      assert.notEqual(this.state, 'closed', 'encoder closes once');
      this.state = 'closed';
      hit('encoderClose');
      options.encoderClose?.(this, h);
    }
  }
  const dependencies = {
    VideoEncoder, VideoFrame, now: () => h.clock,
    setTimer(callback, delay) {
      hit(delay ? 'setDeadline' : 'setYield');
      const token = { callback, delay };
      h.timers.add(token);
      if (!delay && !options.holdYields) token.task = setImmediate(callback);
      return token;
    },
    clearTimer(token) {
      h.timers.delete(token);
      if (token.task) clearImmediate(token.task);
      hit(token.delay ? 'clearDeadline' : 'clearYield');
    },
  };
  const input = { canvas: { ...outputDimensions('16:9', 720), getContext() {} },
    quality: 720, ratio: '16:9', outputDuration: 1 / 30, signal: h.signal,
    drawFrame(canvas, frame) {
      hit('draw');
      assert.ok(h.frames.every(item => item.closed), 'previous frames already closed');
      h.drawn.push(frame);
      return options.draw?.(canvas, frame, h);
    } };
  h.input = input;
  h.dependencies = dependencies;
  h.run = (changes = {}, seams = {}) => runSilentEncoderProbe({ ...input, ...changes }, { ...dependencies, ...seams });
  h.deadline = () => [...h.timers].find(token => token.delay === 30_000).callback();
  h.emit = chunk => h.encoders[0].callbacks.output(chunk);
  h.error = error => h.encoders[0].callbacks.error(error);
  h.drain = () => {
    const encoder = h.encoders[0];
    encoder.encodeQueueSize = 0;
    for (const listener of encoder.listeners) listener();
  };
  h.clean = () => {
    assert.equal(h.timers.size, 0, 'no timer retained');
    assert.equal(h.abortListeners.size, 0, 'no abort listener retained');
    assert.ok(h.frames.every(frame => frame.closed), 'all created frames closed');
    assert.ok(h.encoders.every(encoder => encoder.state === 'closed' && encoder.listeners.size === 0));
  };
  return h;
}

for (const duration of [0.000001, 1.001, 12]) {
  test(`one-frame, partial-end or full-budget schedule: ${duration}s`, async () => {
    const h = harness();
    const result = await h.run({ outputDuration: duration });
    const schedule = silentFrameSchedule(duration);
    assert.equal(result.status, 'completed');
    assert.equal(result.executionMode, 'injected-test');
    assert.equal(result.verification, 'injected-contract-only');
    assert.equal(result.audioTracks, 0);
    assert.equal(result.fileProduced, false);
    assert.equal(result.expectedFrames, schedule.frameCount);
    assert.equal(result.encodedFrames, schedule.frameCount);
    assert.equal(result.submittedFrames, schedule.frameCount);
    assert.equal(result.encodedBytes, schedule.frameCount * 8);
    assert.deepEqual(result.chunks.map(({ index, timestampUs, durationUs }) => ({ index, timestampUs, durationUs })),
      schedule.frames.map(({ index, timestampUs, durationUs }) => ({ index, timestampUs, durationUs })));
    assert.ok(result.chunks.every(chunk => Object.keys(chunk).length === 5));
    assert.deepEqual(h.drawn, schedule.frames);
    assert.ok(h.drawn.every(Object.isFrozen));
    assert.ok(h.calls.indexOf('encoderClose') > h.calls.indexOf('flush'));
    assert.equal(h.calls.filter(call => call === 'setYield').length, Math.floor(schedule.frameCount / 4));
    h.clean();
  });
}

test('all supported ratios and qualities use exact requested support/configure dimensions', async () => {
  for (const quality of [720, 1080]) {
    for (const ratio of SUPPORTED_ASPECT_RATIOS) {
      const h = harness(), dimensions = outputDimensions(ratio, quality);
      const result = await h.run({ quality, ratio, canvas: { ...dimensions, getContext() {} } });
      assert.deepEqual(h.supportRequest, { codec: 'vp8', ...dimensions,
        bitrate: quality === 1080 ? 8_000_000 : 4_500_000, framerate: 30,
        latencyMode: 'quality', hardwareAcceleration: 'no-preference' });
      assert.deepEqual(result.requestedConfig, h.supportRequest);
      assert.deepEqual(result.supportedConfig, h.supportRequest);
      assert.deepEqual(h.configured, h.supportRequest);
      assert.match(result.limitations.join(' '), /Hardware selection.*unmeasured/);
      h.clean();
    }
  }
});

test('configuration input is captured before support resolves, not read again later', async () => {
  const gate = deferred(), h = harness({ support: () => gate.promise });
  const pending = runSilentEncoderProbe(h.input, h.dependencies);
  h.input.quality = 1080;
  h.input.ratio = '9:16';
  gate.resolve({ supported: true, config: h.supportRequest });
  const result = await pending;
  assert.equal(result.requestedConfig.width, 1280);
  assert.equal(result.requestedConfig.bitrate, 4_500_000);
  h.clean();
});

for (const changes of [
  { quality: 480 }, { quality: '720' }, { ratio: '100000:1' }, { ratio: '3:2' },
  { outputDuration: 12.01 }, { outputDuration: Infinity }, { outputDuration: 0 },
  { outputDuration: 0.0000001 }, { drawFrame: null }, { signal: {} },
  { canvas: { width: 3840, height: 2160, getContext() {} } },
  { canvas: { width: 1280, height: 720 } },
]) {
  test(`malformed request allocates no resources: ${JSON.stringify(changes)}`, async () => {
    const h = harness();
    await assert.rejects(h.run(changes));
    assert.deepEqual(h.calls, []);
    h.clean();
  });
}

test('missing APIs and absent support method explicitly return unsupported', async () => {
  for (const seams of [{ VideoEncoder: 0 }, { VideoFrame: 0 }, { VideoEncoder: class {} }]) {
    const h = harness();
    const result = await h.run({}, seams);
    assert.equal(result.status, 'unsupported');
    assert.equal(result.verification, 'not-run');
    assert.equal(result.reason, 'webcodecs-api-unavailable');
    assert.deepEqual(h.calls, []);
  }
});

for (const mutation of [
  config => ({ supported: false, config }),
  config => ({ supported: true, config: { ...config, width: 640 } }),
  config => ({ supported: true, config: { ...config, height: 360 } }),
  config => ({ supported: true, config: { ...config, bitrate: 1 } }),
  config => ({ supported: true, config: { ...config, framerate: 60 } }),
  config => ({ supported: true, config: { ...config, codec: 'avc1' } }),
  config => ({ supported: true, config: { ...config, latencyMode: 'realtime' } }),
  config => ({ supported: true, config: { ...config, hardwareAcceleration: undefined } }),
]) {
  test('unsupported or changed actual support configuration cannot count as completed', async () => {
    const h = harness({ support: config => Promise.resolve(mutation(config)) });
    const result = await h.run();
    assert.equal(result.status, 'unsupported');
    assert.equal(result.verification, 'not-run');
    assert.equal(h.encoders.length, 0);
    h.clean();
  });
}

test('capability promise rejection is observed and cleaned up', async () => {
  const error = new Error('capability rejected');
  const h = harness({ support: () => Promise.reject(error) });
  await assert.rejects(h.run(), candidate => candidate === error);
  h.clean();
});

for (const phase of ['support', 'queue', 'flush', 'yield']) {
  test(`cancel wakes a pending ${phase}, closes resources and ignores late callbacks`, async () => {
    const gate = deferred(), entered = deferred();
    const options = phase === 'support' ? { support: () => gate.promise } :
      phase === 'flush' ? { flush: () => { entered.resolve(); return gate.promise; } } :
        phase === 'yield' ? { holdYields: true } : { holdQueue: true };
    const h = harness(options);
    const pending = h.run({ outputDuration: phase === 'queue' || phase === 'yield' ? 1 : 1 / 30 });
    if (phase === 'flush') await entered.promise;
    else await task();
    if (phase === 'queue') {
      await task(); // Let the fourth-frame yield finish and enter queue waiting.
      assert.equal(h.encoders[0].encodeQueueSize, 4);
      assert.equal(h.frames.length, 4);
    }
    h.controller.abort();
    const result = await pending;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.verification, 'not-completed');
    h.clean();
    if (h.encoders.length) {
      assert.doesNotThrow(() => h.emit({ get timestamp() { throw new Error('stale'); } }));
      assert.doesNotThrow(() => h.error(new Error('late error')));
    }
    // A retry has independent callbacks and does not await the old native promise.
    const retry = harness();
    assert.equal((await retry.run()).status, 'completed');
    if (phase === 'support' || phase === 'flush') gate.reject(new Error('late stage rejection'));
    await task();
    h.clean();
    retry.clean();
  });
}

test('pre-aborted probe never queries support or allocates native resources', async () => {
  const h = harness();
  h.controller.abort();
  const result = await h.run();
  assert.equal(result.status, 'cancelled');
  assert.equal(result.verification, 'not-run');
  assert.deepEqual(h.calls, []);
});

for (const phase of ['support', 'queue', 'flush', 'yield']) {
  test(`deadline wakes a pending ${phase}`, async () => {
    const gate = deferred();
    const h = harness(phase === 'support' ? { support: () => gate.promise } :
      phase === 'flush' ? { flush: () => gate.promise } :
        phase === 'yield' ? { holdYields: true } : { holdQueue: true });
    const pending = h.run({ outputDuration: phase === 'queue' || phase === 'yield' ? 1 : 1 / 30 });
    const assertion = assert.rejects(pending, error => error.name === 'TimeoutError');
    await task();
    if (phase === 'queue') await task();
    h.deadline();
    await assertion;
    h.clean();
  });
}

for (const stage of ['support', 'construct', 'configure', 'frameConstruct', 'encode', 'draw',
  'frameClose', 'flush', 'encoderClose', 'addAbort', 'removeAbort', 'addDequeue', 'removeDequeue',
  'setDeadline', 'clearDeadline', 'setYield', 'clearYield']) {
  test(`${stage} exception prevents success and attempts every owned cleanup`, async () => {
    const h = harness({ throwAt: stage });
    await assert.rejects(h.run({ outputDuration: 1 }), error => error === h.failure);
    h.clean();
  });
}

test('callback error during flush rejects without throwing into the event loop', async () => {
  const entered = deferred(), gate = deferred(), error = new Error('native callback');
  const h = harness({ flush: () => { entered.resolve(); return gate.promise; } });
  const pending = h.run();
  const assertion = assert.rejects(pending, candidate => candidate === error);
  await entered.promise;
  assert.doesNotThrow(() => h.error(error));
  await assertion;
  h.clean();
});

test('synchronous error callback closes encoder even while encode is on stack', async () => {
  const error = new Error('codec error');
  const h = harness({ encode: (_chunk, encoder) => encoder.callbacks.error(error) });
  await assert.rejects(h.run(), candidate => candidate === error);
  h.clean();
});

test('original encode error survives frame and encoder cleanup failures', async () => {
  const primary = new Error('encode failed'), frameClose = new Error('frame close'), encoderClose = new Error('encoder close');
  const h = harness({ encode() { throw primary; }, frameClose() { throw frameClose; }, encoderClose() { throw encoderClose; } });
  await assert.rejects(h.run(), error => {
    assert.equal(error.cause.cause, primary);
    assert.deepEqual(error.cause.errors, [primary, frameClose]);
    assert.deepEqual(error.errors, [error.cause, encoderClose]);
    return true;
  });
  h.clean();
});

test('a failed native close during cancellation is reported, not a cleanup success', async () => {
  const h = harness({ holdYields: true, throwAt: 'encoderClose' });
  const pending = h.run({ outputDuration: 1 });
  const assertion = assert.rejects(pending, error => error === h.failure);
  await task();
  h.controller.abort();
  await assertion;
  h.clean();
});

test('queue never exceeds four; dequeue permits progress but flush is still awaited', async () => {
  const gate = deferred(), entered = deferred();
  const h = harness({ holdQueue: true, flush: () => { entered.resolve(); return gate.promise; } });
  let settled = false;
  const pending = h.run({ outputDuration: 5 / 30 }).then(result => { settled = true; return result; });
  await task();
  assert.equal(h.frames.length, 4);
  h.drain();
  await entered.promise;
  h.drain();
  await task();
  assert.equal(settled, false, 'empty queue is not flush completion');
  gate.resolve();
  const result = await pending;
  assert.equal(result.maxQueueSize, 4);
  assert.equal(h.observedQueue, 4);
  h.clean();
});

test('out-of-order callback arrival is matched by timestamp and sorted in the report', async () => {
  const h = harness({ outputMode: 'flush', reverse: true });
  const result = await h.run({ outputDuration: 0.1 });
  assert.deepEqual(result.chunks.map(chunk => chunk.timestampUs), [0, 33_333, 66_667]);
  h.clean();
});

for (const [name, mutate] of [
  ['missing duration', chunk => ({ ...chunk, duration: undefined })],
  ['wrong duration', chunk => ({ ...chunk, duration: chunk.duration + 1 })],
  ['wrong timestamp', chunk => ({ ...chunk, timestamp: chunk.timestamp + 1 })],
  ['noninteger timestamp', chunk => ({ ...chunk, timestamp: 0.1 })],
  ['first delta', chunk => ({ ...chunk, type: 'delta' })],
  ['invalid type', chunk => ({ ...chunk, type: 'unknown' })],
  ['zero bytes', chunk => ({ ...chunk, byteLength: 0 })],
  ['noninteger bytes', chunk => ({ ...chunk, byteLength: 1.5 })],
  ['NaN bytes', chunk => ({ ...chunk, byteLength: NaN })],
  ['excess bytes', chunk => ({ ...chunk, byteLength: 64 * 1024 * 1024 + 1 })],
  ['throwing getter', () => ({ get timestamp() { throw new Error('metadata'); } })],
]) {
  test(`reject malformed output: ${name}`, async () => {
    const h = harness({ chunk: mutate });
    await assert.rejects(h.run());
    h.clean();
  });
}

test('byte budget is accumulated and its exact boundary is accepted', async () => {
  const h = harness({ chunk: chunk => ({ ...chunk, byteLength: 32 * 1024 * 1024 }) });
  assert.equal((await h.run({ outputDuration: 2 / 30 })).encodedBytes, 64 * 1024 * 1024);
  const excess = harness({ chunk: chunk => ({ ...chunk, byteLength: 32 * 1024 * 1024 }) });
  await assert.rejects(excess.run({ outputDuration: 3 / 30 }), /byte budget/);
  h.clean();
  excess.clean();
});

for (const kind of ['missing', 'duplicate', 'extra', 'unsubmitted', 'queue-overflow']) {
  test(`reject ${kind} output or requests`, async () => {
    const h = harness(kind === 'missing' ? { outputMode: 'none' } :
      kind === 'duplicate' ? { chunk: chunk => ({ ...chunk, timestamp: 0 }) } :
        { encode(chunk, encoder) {
          if (kind === 'queue-overflow') encoder.encodeQueueSize = 6;
          else if (kind === 'unsubmitted') encoder.callbacks.output({ ...chunk, timestamp: 33_333 });
          else encoder.callbacks.output(chunk);
        } });
    await assert.rejects(h.run({ outputDuration: kind === 'extra' ? 1 / 30 : 2 / 30 }));
    h.clean();
  });
}

test('synchronous draw contract rejects thenables and observes their rejection', async () => {
  const h = harness({ draw: () => Promise.reject(new Error('async draw')) });
  await assert.rejects(h.run(), /thenable/);
  await task();
  assert.equal(h.frames.length, 0);
  h.clean();
});

test('deadline is checked after a long synchronous draw even without timer dispatch', async () => {
  const h = harness({ draw: (_canvas, _frame, state) => { state.clock = 30_000; } });
  await assert.rejects(h.run(), error => error.name === 'TimeoutError');
  assert.equal(h.frames.length, 0);
  h.clean();
});

test('draw cannot mutate the expected schedule or silently resize the capture', async () => {
  for (const draw of [(_canvas, frame) => { frame.timestampUs = 7; }, canvas => { canvas.width = 1; }]) {
    const h = harness({ draw });
    await assert.rejects(h.run());
    assert.equal(h.frames.length, 0);
    h.clean();
  }
});

test('a queued UI task can cancel even if encode drains synchronously', async () => {
  const h = harness();
  setImmediate(() => h.controller.abort());
  const result = await h.run({ outputDuration: 12 });
  assert.equal(result.status, 'cancelled');
  assert.equal(h.drawn.length, 4);
  h.clean();
});

for (const cause of ['cancel', 'error', 'deadline']) {
  test(`native close rejection cannot replace terminal ${cause} while flush is pending`, async () => {
    const gate = deferred(), entered = deferred(), original = new Error('original encoder error');
    const h = harness({ flush: () => { entered.resolve(); return gate.promise; },
      encoderClose: () => gate.reject(new Error('native close rejected flush')) });
    const pending = h.run();
    const assertion = cause === 'cancel' ? pending.then(result => assert.equal(result.status, 'cancelled')) :
      assert.rejects(pending, error => cause === 'error' ? error === original : error.name === 'TimeoutError');
    await entered.promise;
    if (cause === 'cancel') h.controller.abort();
    else if (cause === 'error') h.error(original);
    else h.deadline();
    await assertion;
    h.clean();
  });
}

test('payload methods and arbitrary output metadata are never read or retained', async () => {
  const h = harness({ outputMode: 'none', encode(chunk, encoder) {
    encoder.callbacks.output({ ...chunk, copyTo() { throw new Error('payload read'); } },
      { get decoderConfig() { throw new Error('metadata retained'); } });
  } });
  const result = await h.run();
  assert.deepEqual(Object.keys(result.chunks[0]), ['index', 'timestampUs', 'durationUs', 'type', 'byteLength']);
  h.clean();
});

test('already-closed native encoder is not closed a second time after its error callback', async () => {
  const original = new Error('native encoder shut itself down');
  const h = harness({ encode(_chunk, encoder) {
    encoder.state = 'closed';
    encoder.callbacks.error(original);
  } });
  await assert.rejects(h.run(), error => error === original);
  assert.equal(h.calls.includes('encoderClose'), false);
  h.clean();
});

test('synchronous draw cancellation captures no frame and asynchronous flush rejection is reported', async () => {
  const cancelled = harness({ draw: (_canvas, _frame, state) => state.controller.abort() });
  assert.equal((await cancelled.run()).status, 'cancelled');
  assert.equal(cancelled.frames.length, 0);
  const original = new Error('flush rejected');
  const failed = harness({ flush: () => Promise.reject(original) });
  await assert.rejects(failed.run(), error => error === original);
  cancelled.clean();
  failed.clean();
});

test('inherited constructor seams remain explicitly injected, never native evidence', async () => {
  const h = harness();
  const result = await runSilentEncoderProbe(h.input, Object.create(h.dependencies));
  assert.equal(result.executionMode, 'injected-test');
  assert.equal(result.verification, 'injected-contract-only');
  h.clean();
});

test('clock function is captured and must remain finite and monotonic', async () => {
  const gate = deferred(), h = harness({ support: () => gate.promise });
  const pending = runSilentEncoderProbe(h.input, h.dependencies);
  h.dependencies.now = () => Infinity;
  gate.resolve({ supported: true, config: h.supportRequest });
  assert.equal((await pending).status, 'completed');
  h.clean();
  for (const clock of [-1, NaN]) {
    const bad = harness({ draw: (_canvas, _frame, state) => { state.clock = clock; } });
    await assert.rejects(bad.run(), /finite and monotonic/);
    bad.clean();
  }
});

test('a close failure before release still removes listeners and timers and cannot complete', async () => {
  const h = harness(), original = new Error('native close did not release');
  let attempts = 0;
  h.dependencies.VideoEncoder.prototype.close = () => { attempts++; throw original; };
  await assert.rejects(h.run(), error => error === original);
  assert.equal(attempts, 1);
  assert.equal(h.encoders[0].state, 'configured', 'failed close is not evidence of release');
  assert.equal(h.encoders[0].listeners.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.abortListeners.size, 0);
  assert.ok(h.frames.every(frame => frame.closed));
});

test('completion checks the total clock after cleanup and ignores later output callbacks', async () => {
  const slow = harness({ encoderClose: (_encoder, state) => { state.clock = 30_000; } });
  await assert.rejects(slow.run(), error => error.name === 'TimeoutError');
  slow.clean();
  const h = harness(), result = await h.run();
  h.emit({ get timestamp() { throw new Error('late metadata'); } });
  h.error(new Error('late error'));
  assert.equal(result.chunks.length, 1);
  assert.equal(result.encodedBytes, 8);
  h.clean();
});
