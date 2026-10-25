import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silentFrameSchedule } from '../qa/export-schedule.mjs';

test('12 seconds contains 360 frames and no endpoint frame', () => {
  const result = silentFrameSchedule(12);
  assert.equal(result.rendered, false);
  assert.equal(result.audioTracks, 0);
  assert.equal(result.frameCount, 360);
  assert.equal(result.frames[359].time, 359 / 30);
  assert.equal(result.frames[359].timestampUs, 11_966_667);
  assert.equal(result.frames[359].durationUs, 33_333);
  assert.equal(result.frames.reduce((sum, frame) => sum + frame.durationUs, 0), 12_000_000);
});

test('integer-microsecond quantization keeps contiguous rational frame boundaries', () => {
  const frames = silentFrameSchedule(12).frames;
  assert.deepEqual(frames.slice(0, 4).map(frame => frame.timestampUs), [0, 33_333, 66_667, 100_000]);
  for (let i = 1; i < frames.length; i++) {
    const previous = frames[i - 1];
    assert.equal(previous.timestampUs + previous.durationUs, frames[i].timestampUs);
    assert.ok(Math.abs(frames[i].timestampUs / 1e6 - frames[i].time) <= 0.0000005);
  }
});

test('partial final frame keeps its positive shorter duration', () => {
  const result = silentFrameSchedule(1.001);
  assert.equal(result.frameCount, 31);
  assert.deepEqual(result.frames.at(-1), { index: 30, time: 1, timestampUs: 1_000_000, durationUs: 1_000 });
  assert.equal(result.frames.reduce((sum, frame) => sum + frame.durationUs, 0), 1_001_000);
  assert.equal(silentFrameSchedule(0.000001).frames[0].durationUs, 1);
});

test('frame count follows the rounded microsecond endpoint', () => {
  assert.equal(silentFrameSchedule(1.0000004).frameCount, 30);
  const above = silentFrameSchedule(1.0000006);
  assert.equal(above.frameCount, 31);
  assert.equal(above.frames.at(-1).durationUs, 1);
});

test('longer input needs an explicit range; invalid or widened experiment is rejected', () => {
  assert.throws(() => silentFrameSchedule(60), RangeError);
  for (const duration of [0, -1, NaN, Infinity, -Infinity, '12', 0.0000001])
    assert.throws(() => silentFrameSchedule(duration), RangeError);
  assert.throws(() => silentFrameSchedule(12, { fps: 60 }), RangeError);
  assert.throws(() => silentFrameSchedule(12, { limit: 60 }), RangeError);
});
