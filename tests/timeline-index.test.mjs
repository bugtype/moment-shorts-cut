import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimelineEntries, locateTimelineEntry } from '../dist/timeline-index.mjs';

test('timeline entries retain frozen authored clip references and create independent indexes', () => {
  const clips = Object.freeze([
    Object.freeze({start:8,end:10}), Object.freeze({start:1,end:4}), Object.freeze({start:8,end:10}),
  ]);
  const first = buildTimelineEntries(clips), second = buildTimelineEntries(clips);
  assert.deepEqual(first.entries.map(({index,offset}) => ({index,offset})), [
    {index:0,offset:0}, {index:1,offset:2}, {index:2,offset:5},
  ]);
  assert.equal(first.total, 7);
  assert.notEqual(first, second);
  assert.notEqual(first.entries, second.entries);
  first.entries.forEach((entry, index) => {
    assert.equal(entry.clip, clips[index]);
    assert.equal(second.entries[index].clip, clips[index]);
    assert.notEqual(entry, second.entries[index]);
  });
});

test('timeline lookup preserves repeated-range boundaries, clamping and nonfinite behavior', () => {
  const {entries} = buildTimelineEntries([{start:8,end:10},{start:1,end:4},{start:8,end:10}]);
  for (const [time,index,source,offset] of [
    [-Infinity,0,8,0], [-1,0,8,0], [0,0,8,0], [1,0,9,0],
    [2,1,1,2], [4,1,3,2], [5,2,8,5], [7,2,10,5], [Infinity,2,10,5], [NaN,2,NaN,5],
  ]) assert.deepEqual(locateTimelineEntry(entries,time), {index,source,offset});
  assert.throws(() => locateTimelineEntry([],0), TypeError);
});

test('timeline mapping retains historical floating-point grouping rather than normalizing boundaries', () => {
  const small = buildTimelineEntries([{start:0,end:.1},{start:.2,end:.3}]);
  assert.equal(small.total, .19999999999999998);
  const {entries,total} = buildTimelineEntries([{start:0,end:.1},{start:80000,end:80000.1},{start:1,end:2}]);
  assert.equal(entries[2].offset, .20000000000582077);
  assert.equal(total, 1.2000000000058209);
  // The search's (offset + end) - start threshold differs from offset + (end - start).
  assert.deepEqual(locateTimelineEntry(entries,entries[2].offset), {index:1,source:80000.1,offset:.1});
  assert.deepEqual(locateTimelineEntry(entries,.20000000001164153), {index:2,source:1.0000000000058207,offset:entries[2].offset});
  const tiny = buildTimelineEntries([{start:0,end:Number.MIN_VALUE},{start:0,end:1}]);
  assert.equal(tiny.entries[1].offset, Number.MIN_VALUE);
  assert.deepEqual(locateTimelineEntry(tiny.entries,0), {index:0,source:0,offset:0});
  assert.deepEqual(locateTimelineEntry(tiny.entries,Number.MIN_VALUE), {index:1,source:0,offset:Number.MIN_VALUE});
});
