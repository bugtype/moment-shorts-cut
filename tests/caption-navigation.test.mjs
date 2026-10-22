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
