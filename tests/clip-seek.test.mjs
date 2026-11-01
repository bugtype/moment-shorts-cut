import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSeekTime } from '../dist/clip-seek.mjs';
import { buildTimelineEntries, locateTimelineEntry } from '../dist/timeline-index.mjs';

test('clip navigation preserves valid targets and rejects missing occurrence indices', () => {
  const clips = [{start:8,end:10},{start:1,end:4},{start:8,end:10}];
  for (const [index, preferred] of [[0,0],[0,.25],[1,2],[1,3.125],[2,5],[2,6.999]])
    assert.equal(clipSeekTime(clips,index,preferred), preferred);
  for (const index of [-1,3,.5,NaN,Infinity,'1']) assert.equal(clipSeekTime(clips,index), null);
  assert.equal(clipSeekTime([],0), null);
});

test('clip navigation uses a representable lookup boundary without changing the index contract', () => {
  const clips = [{start:0,end:.1},{start:80000,end:80000.1},{start:1,end:2}];
  const {entries} = buildTimelineEntries(clips);
  assert.equal(locateTimelineEntry(entries, entries[2].offset).index, 1);
  const target = clipSeekTime(clips,2);
  assert.equal(target, .20000000001164153);
  assert.equal(locateTimelineEntry(entries,target).index, 2);
  assert.equal(clipSeekTime(clips,0,NaN), 0);
  assert.equal(clipSeekTime(clips,1,Infinity), .1);
});

test('fractional, repeated and large-source occurrences resolve without modifying authored data', () => {
  const clips = Array.from({length:1000}, (_,index) => Object.freeze([
    {start:0,end:.1}, {start:1.1,end:1.2}, {start:80000,end:80000.1},
    {start:0,end:86400}, {start:12.866667,end:18.4},
  ][index % 5]));
  Object.freeze(clips);
  const {entries} = buildTimelineEntries(clips), before = JSON.stringify(clips);
  for (let index=0; index<clips.length; index++) {
    const target = clipSeekTime(clips,index);
    assert.notEqual(target,null);
    const position = locateTimelineEntry(entries,target);
    assert.equal(position.index,index);
    assert.ok(position.source >= clips[index].start && position.source < clips[index].end);
  }
  assert.equal(JSON.stringify(clips),before);
});
