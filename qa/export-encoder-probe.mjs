// QA-only raw VP8 probe. No editor integration, muxer, audio, file or byte payload.
import { outputDimensions, SUPPORTED_ASPECT_RATIOS } from '../dist/core/aspect-ratio.mjs';
import { silentFrameSchedule } from './export-schedule.mjs';

const LIMITS = Object.freeze({ frames: 360, queue: 4, bytes: 64 * 1024 * 1024,
  deadlineMs: 30_000, dimension: 1920, pixels: 2_073_600 });
const CANCELLED = Symbol('cancelled');
const INTERRUPTED = Symbol('interrupted');
const CONFIG_KEYS = ['codec', 'width', 'height', 'bitrate', 'framerate',
  'latencyMode', 'hardwareAcceleration'];

function timeoutError() {
  const error = new Error('Silent encoder probe exceeded its 30 second deadline.');
  error.name = 'TimeoutError';
  return error;
}

function withCleanupError(primary, cleanup, message) {
  return new AggregateError([primary, cleanup], message, { cause: primary });
}

function validateInput({ canvas, drawFrame, outputDuration, quality, ratio, signal }) {
  if (![720, 1080].includes(quality) || !SUPPORTED_ASPECT_RATIOS.includes(ratio))
    throw new RangeError('Choose quality 720 or 1080 and a supported Moment aspect ratio.');
  const dimensions = outputDimensions(ratio, quality);
  if (!canvas || typeof canvas.getContext !== 'function' ||
      canvas.width !== dimensions.width || canvas.height !== dimensions.height)
    throw new RangeError('Provide a canvas at the exact requested output dimensions.');
  if (dimensions.width > LIMITS.dimension || dimensions.height > LIMITS.dimension ||
      dimensions.width * dimensions.height > LIMITS.pixels)
    throw new RangeError('Requested dimensions exceed this probe budget.');
  if (typeof drawFrame !== 'function') throw new TypeError('drawFrame must be synchronous.');
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
    throw new TypeError('signal must be an AbortSignal.');
  const schedule = silentFrameSchedule(outputDuration);
  if (schedule.frameCount > LIMITS.frames) throw new RangeError('Too many frames.');
  schedule.frames.forEach(Object.freeze);
  return { dimensions, schedule };
}

/**
 * Encode caller-drawn frames, retaining only bounded chunk descriptors.
 * drawFrame(canvas, frozenScheduleFrame) MUST return synchronously. Keep it short:
 * timers cannot preempt a blocking callback; the deadline is checked around it.
 * Dependencies are test seams, not options for widening any resource limit.
 * Injected runs establish contract behavior, never native codec validation.
 */
export async function runSilentEncoderProbe(input, dependencies = {}) {
  const { canvas, drawFrame, outputDuration, quality, ratio, signal } = input;
  const { dimensions, schedule } = validateInput({ canvas, drawFrame, outputDuration, quality, ratio, signal });
  const Encoder = dependencies.VideoEncoder ?? globalThis.VideoEncoder;
  const Frame = dependencies.VideoFrame ?? globalThis.VideoFrame;
  const now = dependencies.now ?? (() => globalThis.performance.now());
  const setTimer = dependencies.setTimer ?? globalThis.setTimeout.bind(globalThis);
  const clearTimer = dependencies.clearTimer ?? globalThis.clearTimeout.bind(globalThis);
  if ([now, setTimer, clearTimer].some(value => typeof value !== 'function'))
    throw new TypeError('Clock and timer dependencies must be functions.');
  const injected = ['VideoEncoder', 'VideoFrame', 'now', 'setTimer', 'clearTimer']
    .some(key => key in dependencies);
  const executionMode = injected ? 'injected-test' : 'runtime-webcodecs';
  const requestedConfig = Object.freeze({ codec: 'vp8', ...dimensions,
    bitrate: quality === 1080 ? 8_000_000 : 4_500_000, framerate: 30,
    latencyMode: 'quality', hardwareAcceleration: 'no-preference' });
  const summary = {
    scope: 'QA-only silent raw VP8 encoded-chunk observations; not a Moment export.',
    executionMode, requestedConfig, audioTracks: 0, fileProduced: false,
    limitations: ['No decoded-pixel, compositor, muxed-file or audio validation.',
      'Queue limit bounds pending encode requests, not native memory.',
      'Hardware selection, native memory release and export speed are unmeasured.',
      'Synchronous drawing must be bounded; a timer cannot interrupt it.'],
    limits: LIMITS, expectedFrames: schedule.frameCount, endUs: schedule.endUs,
  };
  if (signal?.aborted) return { ...summary, status: 'cancelled', verification: 'not-run' };
  if (typeof Encoder !== 'function' || typeof Frame !== 'function' ||
      typeof Encoder.isConfigSupported !== 'function')
    return { ...summary, status: 'unsupported', reason: 'webcodecs-api-unavailable', verification: 'not-run' };

  const startedAt = now();
  if (!Number.isFinite(startedAt)) throw new TypeError('Clock must return finite milliseconds.');
  let lastTime = startedAt;
  let active = true, terminal = null, encoder = null, closeAttempted = false;
  let deadlineTimer, deadlineActive = false, yieldTimer, yieldActive = false;
  let abortAttached = false, dequeueAttached = false, queueWaiter = null;
  let submittedFrames = 0, encodedBytes = 0, maxQueueSize = 0;
  const chunks = [], cleanupErrors = [];
  const expectedByTimestamp = new Map(schedule.frames.map(frame => [frame.timestampUs, frame]));
  const seenTimestamps = new Set();
  let interrupt;
  const interrupted = new Promise(resolve => { interrupt = () => resolve(INTERRUPTED); });

  function closeEncoder() {
    if (!encoder || closeAttempted) return;
    closeAttempted = true;
    try { if (encoder.state !== 'closed') encoder.close(); }
    catch (error) { cleanupErrors.push(error); }
  }

  function stop(kind, error) {
    if (!active || terminal) return;
    terminal = { kind, error };
    active = false; // Invalidate this run before native close can dispatch callbacks.
    interrupt(); // Settle ownership before close can reject a pending native flush.
    closeEncoder();
    queueWaiter?.();
  }

  function check() {
    if (terminal?.kind === 'cancelled') throw CANCELLED;
    if (terminal?.kind === 'failed') throw terminal.error;
    const time = now();
    if (!Number.isFinite(time) || time < lastTime) throw new TypeError('Clock must be finite and monotonic.');
    lastTime = time;
    if (time - startedAt >= LIMITS.deadlineMs) {
      const error = timeoutError();
      stop('failed', error);
      throw error;
    }
  }

  async function guarded(promise) {
    try {
      const value = await Promise.race([Promise.resolve(promise), interrupted]);
      check();
      return value;
    } catch (error) {
      // close() may reject native work. The terminal cause still owns this run.
      if (terminal) check();
      throw error;
    }
  }

  function onAbort() { stop('cancelled'); }
  function onDequeue() { if (active) queueWaiter?.(); }
  function onError(error) { stop('failed', error); }

  function onOutput(chunk) {
    if (!active) return;
    try {
      check();
      if (chunks.length >= schedule.frameCount)
        throw new Error('Unexpected encoded frame or descriptor budget exceeded.');
      const { timestamp, duration, byteLength, type } = chunk;
      const expected = expectedByTimestamp.get(timestamp);
      if (!Number.isSafeInteger(timestamp) || !expected || seenTimestamps.has(timestamp))
        throw new Error('Missing, duplicate or unexpected encoded timestamp.');
      const index = expected.index;
      if (index >= submittedFrames) throw new Error('Encoded frame was not submitted.');
      if (!Number.isSafeInteger(duration) || duration !== expected.durationUs)
        throw new Error('Encoded duration is absent or does not match the schedule; unverified.');
      if (!['key', 'delta'].includes(type) || (index === 0 && type !== 'key'))
        throw new Error('Invalid encoded chunk type or missing first key frame.');
      if (!Number.isSafeInteger(byteLength) || byteLength <= 0)
        throw new Error('Invalid encoded chunk byteLength.');
      if (byteLength > LIMITS.bytes - encodedBytes)
        throw new RangeError('Encoded byte budget exceeded.');
      encodedBytes += byteLength;
      seenTimestamps.add(timestamp);
      chunks.push({ index, timestampUs: timestamp, durationUs: duration, type, byteLength });
    } catch (error) {
      // WebCodecs invokes callbacks outside the caller's stack. Never throw here.
      stop('failed', error);
    }
  }

  function queueSize() {
    const size = encoder.encodeQueueSize;
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.queue)
      throw new RangeError('Invalid encode queue size or queue budget exceeded.');
    maxQueueSize = Math.max(maxQueueSize, size);
    return size;
  }

  async function waitForQueue() {
    while (queueSize() >= LIMITS.queue) {
      const ready = new Promise(resolve => { queueWaiter = resolve; });
      try {
        // Recheck after arming the waiter; a dequeue event need not be repeated.
        if (queueSize() < LIMITS.queue) queueWaiter();
        await guarded(ready);
      } finally { queueWaiter = null; }
    }
    check();
  }

  async function yieldToTask() {
    // A timer yields to a macrotask, unlike an already-resolved promise.
    const ready = new Promise(resolve => {
      yieldTimer = setTimer(resolve, 0);
      yieldActive = true;
    });
    let failed = false, primary;
    try { await guarded(ready); }
    catch (error) { failed = true; primary = error; throw error; }
    finally {
      if (yieldActive) {
        yieldActive = false;
        try { clearTimer(yieldTimer); }
        catch (error) {
          if (failed && primary !== CANCELLED)
            throw withCleanupError(primary, error, 'Probe wait and timer cleanup failed.');
          throw error;
        }
      }
    }
  }

  function checkCanvas() {
    if (canvas.width !== dimensions.width || canvas.height !== dimensions.height)
      throw new Error('Canvas dimensions changed during the probe.');
  }

  function encodeFrame(frameInfo) {
    let frame, failed = false, primary;
    try {
      frame = new Frame(canvas, { timestamp: frameInfo.timestampUs, duration: frameInfo.durationUs });
      check();
      submittedFrames++;
      encoder.encode(frame, { keyFrame: frameInfo.index === 0 });
      check();
      queueSize();
    } catch (error) {
      failed = true;
      primary = error;
      throw error;
    } finally {
      if (frame) {
        try { frame.close(); }
        catch (error) {
          if (failed) throw withCleanupError(primary, error, 'Frame operation and frame close failed.');
          throw error;
        }
      }
    }
  }

  let result, failed = false, primary;
  try {
    if (signal) {
      abortAttached = true;
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
    check();
    deadlineTimer = setTimer(() => stop('failed', timeoutError()), LIMITS.deadlineMs);
    deadlineActive = true;
    check();
    const support = await guarded(Encoder.isConfigSupported({ ...requestedConfig }));
    // A support check describes recognized configuration, not actual hardware.
    const supportedConfig = Object.fromEntries(CONFIG_KEYS.map(key => {
      const value = support?.config?.[key];
      const bounded = (typeof value === 'string' && value.length <= 64) ||
        (typeof value === 'number' && Number.isFinite(value));
      return [key, bounded ? value : null];
    }));
    if (support?.supported !== true || CONFIG_KEYS.some(key => supportedConfig[key] !== requestedConfig[key])) {
      result = { ...summary, status: 'unsupported', reason: 'requested-configuration-not-supported',
        supportedConfig, verification: 'not-run' };
    } else {
      checkCanvas();
      encoder = new Encoder({ output: onOutput, error: onError });
      check();
      dequeueAttached = true;
      encoder.addEventListener('dequeue', onDequeue);
      encoder.configure({ ...requestedConfig });
      check();
      for (const frameInfo of schedule.frames) {
        await waitForQueue();
        checkCanvas();
        check();
        const drawn = drawFrame(canvas, frameInfo);
        if (drawn && typeof drawn.then === 'function') {
          // Observe a rejected async callback without waiting for or trusting it.
          Promise.resolve(drawn).catch(() => {});
          throw new TypeError('drawFrame returned a thenable; synchronous drawing is required.');
        }
        check();
        checkCanvas();
        encodeFrame(frameInfo);
        if (submittedFrames % LIMITS.queue === 0) await yieldToTask();
      }
      // Queue size zero is not output completion. Flush owns this boundary.
      await guarded(encoder.flush());
      check();
      if (chunks.length !== schedule.frameCount)
        throw new Error('Flush completed with missing encoded frames.');
      result = { ...summary, status: 'completed', supportedConfig,
        verification: executionMode === 'injected-test' ? 'injected-contract-only' : 'runtime-encoded-chunk-metadata',
        submittedFrames, encodedFrames: chunks.length, encodedBytes, maxQueueSize,
        chunks: chunks.sort((a, b) => a.index - b.index) };
    }
  } catch (error) {
    if (error === CANCELLED) result = { ...summary, status: 'cancelled', verification: 'not-completed' };
    else { failed = true; primary = error; }
    stop(failed ? 'failed' : 'cancelled', primary);
  } finally {
    active = false;
    closeEncoder();
    if (dequeueAttached) {
      try { encoder.removeEventListener('dequeue', onDequeue); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (abortAttached) {
      try { signal.removeEventListener('abort', onAbort); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (deadlineActive) {
      try { clearTimer(deadlineTimer); }
      catch (error) { cleanupErrors.push(error); }
    }
    queueWaiter = null;
  }
  if (cleanupErrors.length) {
    if (failed) throw new AggregateError([primary, ...cleanupErrors],
      'Probe and cleanup failed.', { cause: primary });
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    throw new AggregateError(cleanupErrors, 'Probe cleanup failed.');
  }
  if (failed) throw primary;
  if (result.status === 'completed') check();
  return result; // Native close and all cleanup must succeed before completion.
}
