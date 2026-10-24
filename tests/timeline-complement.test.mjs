import test from 'node:test';
import assert from 'node:assert/strict';
import {complementSourceClips} from '../dist/core/timeline-complement.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
const project=(clips,duration=12)=>({...createDemoProject(),duration,clips});
test('complement merges overlap/nesting/duplicates/adjacency without mutating original order',()=>{
 const p=project([{start:8,end:10},{start:2,end:4},{start:3,end:6},{start:2,end:4},{start:2.5,end:3},{start:6,end:7}]);
 const before=structuredClone(p);Object.freeze(p.clips);p.clips.forEach(Object.freeze);
 assert.deepEqual(complementSourceClips(p),[{start:0,end:2},{start:7,end:8},{start:10,end:12}]);assert.deepEqual(p,before);
 assert.deepEqual(complementSourceClips(project([{start:1,end:2},{start:0,end:1},{start:10,end:12}])),[{start:2,end:10}]);
});
test('full coverage and every too-short positive gap reject the entire operation',()=>{
 for(const clips of [[{start:0,end:12}],[{start:6,end:12},{start:0,end:7}]])assert.throws(()=>complementSourceClips(project(clips)),e=>e.messageKey==='panels.keepGapsEmpty');
 for(const clips of [[{start:.01,end:5}],[{start:0,end:5},{start:5.01,end:10}],[{start:0,end:11.99}]])assert.throws(()=>complementSourceClips(project(clips)),e=>e.messageKey==='panels.keepGapsTooShort');
 assert.deepEqual(complementSourceClips(project([{start:0,end:.2},{start:.3,end:12}])),[{start:.2,end:.3}]);
});
test('1000 valid gaps are allowed, but1001 are rejected without dropping any',()=>{
 const clips=Array.from({length:1000},(_,i)=>({start:i*2+1,end:i*2+2}));
 assert.equal(complementSourceClips(project(clips,2000)).length,1000);
 assert.throws(()=>complementSourceClips(project(clips,2001)),e=>e.messageKey==='panels.keepGapsLimit');
});
test('invalid source ranges do not get silently clamped or reordered into validity',()=>{
 for(const clips of [[{start:2,end:1}],[{start:-1,end:1}],[{start:0,end:13}],[{start:NaN,end:1}]])assert.throws(()=>complementSourceClips(project(clips)));
});
