import test from 'node:test';
import assert from 'node:assert/strict';
import { captionOccurrences, editedCaptions } from '../dist/captions.mjs';

const clips=[{start:8,end:12},{start:2,end:5},{start:8,end:10}];
const captions=[
  {start:1,end:3,text:'same'},
  {start:9,end:11,text:'same'},
  {start:6,end:7,text:'removed'},
  {start:0,end:2,text:'same',basis:'timeline'},
  {start:8,end:10,text:'overlap'},
  {start:8,end:20,text:'tail',basis:'timeline'},
];

test('caption occurrences retain row identity across cuts, repeats, overlaps and narration',()=>{
  const original=structuredClone({captions,clips});
  const occurrences=captionOccurrences(captions,clips);
  assert.deepEqual(occurrences.map(({start,end,captionIndex})=>[start,end,captionIndex]),[
    [0,2,4],[0,2,3],[1,3,1],[4,5,0],[7,9,4],[8,9,1],[8,9,5],
  ]);
  assert.deepEqual({captions,clips},original);
  assert.ok(!occurrences.some(c=>c.captionIndex===2));
  assert.equal(occurrences.filter(c=>c.captionIndex===3).length,1);
});

test('speed changes output times without changing row identity or export shape',()=>{
  const normal=captionOccurrences(captions,clips);
  for(const speed of [.5,2]){
    const output=captionOccurrences(captions,clips,speed);
    assert.deepEqual(output,normal.map(c=>({...c,start:c.start/speed,end:c.end/speed})));
    assert.deepEqual(editedCaptions(captions,clips,speed),output.map(({start,end,text})=>({start,end,text})));
  }
  assert.deepEqual(captionOccurrences([],clips),[]);
  assert.deepEqual(captionOccurrences(captions,[]),[]);
});

// Pre-classification implementation is the oracle for ordering and clock semantics.
function previousOccurrences(captions, clips, speed = 1) {
  const out = []; let offset = 0;
  for (const [clipIndex, clip] of clips.entries()) {
    for (const [captionIndex, cap] of captions.entries()) {
      if (cap.basis === 'timeline') continue;
      const start = Math.max(clip.start, cap.start), end = Math.min(clip.end, cap.end);
      if (end > start) out.push({start:(offset+start-clip.start)/speed,end:(offset+end-clip.start)/speed,text:cap.text,captionIndex,clipIndex});
    }
    offset += clip.end - clip.start;
  }
  for (const [captionIndex, cap] of captions.entries()) if (cap.basis === 'timeline') {
    const start = Math.max(0, cap.start), end = Math.min(offset, cap.end);
    if (end > start) out.push({start:start/speed,end:end/speed,text:cap.text,captionIndex});
  }
  return out.sort((a,b) => a.start-b.start);
}

test('classification preserves prior output for deterministic mixed clocks, overlaps and equal-time ties',()=>{
  let seed=0x51a7;
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const fixtures=[{captions,clips}];
  for(let trial=0;trial<200;trial++){
    fixtures.push({
      captions:Array.from({length:random(30)},()=>{
        const start=random(20)/4,basis=[undefined,'source','timeline'][random(3)];
        return {start,end:start+(1+random(12))/4,text:['same','한글 🎬','& <literal>'][random(3)],...(basis?{basis}:{})};
      }),
      clips:Array.from({length:random(15)},()=>{const start=random(20)/4;return {start,end:start+(1+random(12))/4};}),
    });
  }
  for(const fixture of fixtures){
    const original=structuredClone(fixture);
    for(const speed of [.25,.5,1,2,4]){
      const expected=previousOccurrences(fixture.captions,fixture.clips,speed);
      assert.deepEqual(captionOccurrences(fixture.captions,fixture.clips,speed),expected);
      assert.deepEqual(editedCaptions(fixture.captions,fixture.clips,speed),expected.map(({start,end,text})=>({start,end,text})));
    }
    assert.deepEqual(fixture,original);
  }
});

test('classification is linear in captions, including narration-only projects at supported limits',()=>{
  for(const mixed of [false,true]){
    let reads=0;
    const items=Array.from({length:10000},(_,i)=>({start:2,end:3,text:'caption',get basis(){reads++;return mixed&&i%2?'source':'timeline';}}));
    const repeated=Array.from({length:1000},()=>({start:0,end:1}));
    const result=captionOccurrences(items,repeated);
    assert.equal(result.length,mixed?5000:10000);
    assert.equal(reads,items.length*2,'narration classification must not repeat for every clip');
    assert.ok(result.every(c=>c.clipIndex===undefined));
    assert.deepEqual(result.map(c=>c.captionIndex),items.map((_,i)=>i).filter(i=>!mixed||i%2===0));
  }
});

test('in-place caption and clip changes are reflected on the next mapping call',()=>{
  const fixture=structuredClone({captions,clips});
  captionOccurrences(fixture.captions,fixture.clips);
  Object.assign(fixture.captions[0],{start:0,end:2,text:'changed',basis:'timeline'});
  Object.assign(fixture.captions[3],{start:8,end:9,text:'source now',basis:'source'});
  fixture.clips.reverse();fixture.clips[0].end=9;
  assert.deepEqual(captionOccurrences(fixture.captions,fixture.clips),previousOccurrences(fixture.captions,fixture.clips));
});
