import test from 'node:test';
import assert from 'node:assert/strict';
import {captionOccurrences,MAX_CAPTIONS,MAX_SUBTITLE_BYTES} from '../dist/captions.mjs';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';

// Deliberately retain the old exhaustive traversal as an independent ordering oracle.
function exhaustive(captions,clips,speed=1) {
  const out=[];let offset=0,bytes=0;
  const sizes=new Map(),encoder=new TextEncoder();
  const append=(cap,captionIndex,start,end,clipIndex)=>{
    if(out.length>=MAX_CAPTIONS)throw new Error('count');
    if(!sizes.has(captionIndex)){
      if(cap.text.length>MAX_SUBTITLE_BYTES)throw new Error('bytes');
      sizes.set(captionIndex,encoder.encode(cap.text).byteLength);
    }
    bytes+=sizes.get(captionIndex);if(bytes>MAX_SUBTITLE_BYTES)throw new Error('bytes');
    out.push({start:start/speed,end:end/speed,text:cap.text,captionIndex,...(clipIndex===undefined?{}:{clipIndex})});
  };
  for(const [clipIndex,clip] of clips.entries()){
    for(const [index,cap] of captions.entries())if(cap.basis!=='timeline'){
      const start=Math.max(clip.start,cap.start),end=Math.min(clip.end,cap.end);
      if(end>start)append(cap,index,offset+start-clip.start,offset+end-clip.start,clipIndex);
    }
    offset+=clip.end-clip.start;
  }
  for(const [index,cap] of captions.entries())if(cap.basis==='timeline'){
    const start=Math.max(0,cap.start),end=Math.min(offset,cap.end);
    if(end>start)append(cap,index,start,end);
  }
  return out.sort((a,b)=>a.start-b.start);
}

test('interval candidates preserve exhaustive mixed-clock results across deterministic unsorted overlapping inputs',()=>{
  let seed=0x64abcd;
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let trial=0;trial<300;trial++){
    const captions=Array.from({length:random(80)},(_,i)=>{const start=random(100)/10,basis=[undefined,'source','timeline'][random(3)];return{start,end:start+(1+random(80))/10,text:`${i} 한🎬`,...(basis?{basis}:{}),speaker:'0',timing:'estimated'};});
    const clips=Array.from({length:random(25)},()=>{const start=random(100)/10;return{start,end:start+(1+random(80))/10};});
    const before=structuredClone({captions,clips});
    for(const speed of [.25,1,2,4])assert.deepEqual(captionOccurrences(captions,clips,speed),exhaustive(captions,clips,speed));
    assert.deepEqual({captions,clips},before);
  }
});
test('touching edges, repeated/reordered clips and stable source-before-timeline ties preserve authored priority',()=>{
  const captions=[{start:1,end:4,text:'first'},{start:0,end:8,text:'second'}, {start:0,end:2,text:'narration',basis:'timeline'},{start:2,end:3,text:'touch'}];
  const clips=[{start:3,end:4},{start:1,end:2},{start:3,end:4}];
  const result=captionOccurrences(captions,clips,2);assert.deepEqual(result,exhaustive(captions,clips,2));
  assert.deepEqual(result.filter(c=>c.start===0).map(c=>c.captionIndex),[0,1,2]);
});
test('raw coercible/nonfinite helper bounds retain exhaustive behavior instead of imposing new validation',()=>{
  for(const value of [NaN,Infinity,-Infinity,undefined,'1',null]){
    const captions=[{start:value,end:3,text:'raw'},{start:0,end:2,text:'finite'}];
    const clips=[{start:0,end:2},{start:1,end:3}];
    assert.deepEqual(captionOccurrences(captions,clips),exhaustive(captions,clips));
    const rawClips=[{start:value,end:2},{start:1,end:3}];
    assert.deepEqual(captionOccurrences(captions.slice(1),rawClips),exhaustive(captions.slice(1),rawClips));
  }
});
test('count and UTF-8 failures retain authored append order and never access later payloads',()=>{
  const clips=[{start:0,end:3},{start:0,end:3}];
  const caps=Array.from({length:5000},(_,i)=>({start:i%2,end:3,text:'a'}));
  assert.equal(captionOccurrences(caps,clips).length,10000);
  const unread={start:0,end:3,get text(){throw new Error('later payload read');}};
  assert.throws(()=>captionOccurrences([...caps,{start:0,end:3,text:'overflow'},unread],clips),e=>e.message==='later payload read'); // first pass has not hit count yet
  const full=Array.from({length:10000},(_,i)=>({start:i%2,end:3,text:'a'}));
  assert.throws(()=>captionOccurrences([...full,unread],clips),e=>e.code==='CAPTION_OUTPUT_LIMIT'&&e.messageKey==='errors.derivedCount');
  const exact=Array.from({length:Math.floor(MAX_SUBTITLE_BYTES/2000)},(_,i)=>({start:i%2,end:3,text:'한'.repeat(666)+'aa'}));
  exact.push({start:0,end:3,text:'a'.repeat(MAX_SUBTITLE_BYTES%2000)});
  assert.equal(exhaustive(exact,[clips[0]]).length,exact.length);
  assert.throws(()=>captionOccurrences([...exact,{start:0,end:3,text:'a'},unread],clips),e=>e.code==='CAPTION_OUTPUT_LIMIT'&&e.messageKey==='errors.derivedBytes');
  assert.throws(()=>exhaustive([...exact,{start:0,end:3,text:'a'},unread],clips),/bytes/);
});
test('supported maximum disjoint project maps exactly once per cue and observes later in-place changes',()=>{
  const p=createDemoProject();p.duration=10000;p.clips=Array.from({length:1000},(_,i)=>({start:i*10,end:i*10+10}));p.captions=Array.from({length:10000},(_,i)=>({start:i,end:i+.5,text:String(i)}));
  createProjectDocument(p);
  assert.deepEqual(captionOccurrences(p.captions,p.clips,4),exhaustive(p.captions,p.clips,4));
  p.captions[0].start=15;p.captions[0].end=16;p.clips.reverse();
  assert.deepEqual(captionOccurrences(p.captions,p.clips),exhaustive(p.captions,p.clips));
});

test('finite zero/reversed raw intervals and nested long spans match exhaustive checks',()=>{
  const captions=[{start:0,end:100,text:'long'},{start:4,end:4,text:'zero'},{start:5,end:2,text:'reversed'},{start:2,end:3,text:'short'}];
  const clips=[{start:1,end:1},{start:4,end:2},{start:2,end:3},{start:50,end:51}];
  assert.deepEqual(captionOccurrences(captions,clips),exhaustive(captions,clips));
});

test('disjoint interval lookup prunes source timing reads without a timing threshold',()=>{
  let reads=0;
  const captions=Array.from({length:1000},(_,i)=>({get start(){reads++;return i;},get end(){reads++;return i+.5;},text:String(i)}));
  const clips=Array.from({length:100},(_,i)=>({start:i*10,end:i*10+10}));
  assert.equal(captionOccurrences(captions,clips).length,1000);
  assert.ok(reads<50000,`indexed mapping read ${reads} endpoints; exhaustive overlap checks alone require 200000`);
});
test('broad shuffled candidate windows preserve authored ties through linear fallback',()=>{
  const captions=[{start:0,end:100,text:'long'},...Array.from({length:99},(_,i)=>({start:i,end:i+.5,text:String(i)}))];
  let seed=81723;for(let i=captions.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[captions[i],captions[j]]=[captions[j],captions[i]];}
  const clips=Array.from({length:10},(_,i)=>({start:i*10,end:i*10+10}));
  assert.deepEqual(captionOccurrences(captions,clips),exhaustive(captions,clips));
});

test('long spanning cues do not force repeated scans of already-ended blocks',()=>{
  for(const reverse of [false,true]){
    const plain=[{start:0,end:1000,text:'long'},...Array.from({length:1000},(_,i)=>({start:i,end:i+.5,text:String(i)}))];
    if(reverse)plain.reverse();
    let reads=0;
    const captions=plain.map(cap=>({get start(){reads++;return cap.start;},get end(){reads++;return cap.end;},text:cap.text}));
    const clips=Array.from({length:100},(_,i)=>({start:i*10,end:i*10+10}));
    const result=captionOccurrences(captions,clips,2),endpointReads=reads;
    assert.equal(result.length,1100);
    assert.deepEqual(result,exhaustive(plain,clips,2));
    // Stable getter instrumentation measures work, not an accessor-call-order contract.
    assert.ok(endpointReads<50000,`long-span mapping read ${endpointReads} endpoints (reverse=${reverse})`);
  }
});

test('partial blocks and long-cue positions preserve raw boundaries, clocks and authored ties',()=>{
  const clips=[{start:0,end:1},{start:30.75,end:33.25},{start:63,end:65},{start:95.5,end:98},
    {start:1,end:1},{start:80,end:70},{start:200,end:201},{start:30.75,end:33.25}];
  for(const count of [31,32,33,63,64,65,95,96,97])for(const position of [0,Math.floor(count/2),count]){
    const captions=Array.from({length:count},(_,i)=>({start:i,end:i+.75,text:`${i} e\u0301 한🎬`}));
    captions.splice(position,0,{start:0,end:128,text:'long'});
    captions.push({start:0,end:3,text:'narration',basis:'timeline'});
    for(const ordered of [captions,[...captions].reverse()])for(const cuts of [clips,[...clips].reverse()])
      for(const speed of [.25,1,2,4]){
        const before=structuredClone({ordered,cuts}),result=captionOccurrences(ordered,cuts,speed);
        assert.ok(result.length>0);
        assert.deepEqual(result,exhaustive(ordered,cuts,speed));
        assert.deepEqual({ordered,cuts},before);
      }
  }
});

test('broad-window metadata is rebuilt after in-place cue and clip edits',()=>{
  const captions=[{start:0,end:160,text:'long'},...Array.from({length:128},(_,i)=>({start:i,end:i+.5,text:String(i)}))];
  const clips=[{start:0,end:40},{start:40,end:80},{start:80,end:128}];
  const check=()=>{const before=structuredClone({captions,clips});assert.deepEqual(captionOccurrences(captions,clips),exhaustive(captions,clips));assert.deepEqual({captions,clips},before);};
  check();captions[0].end=20;check();captions[1].start=70;captions[1].end=71;check();
  captions[1].text='changed 한😀';captions[1].basis='timeline';check();
  clips.reverse();check();clips[1].start=45;check();captions.reverse();check();
});

test('pruned broad windows preserve count-before-text and UTF-8 failure priority',()=>{
  const captions=[{start:0,end:9000,text:'long'},...Array.from({length:9000},(_,i)=>({start:i,end:i+.5,text:'a'}))];
  const clips=Array.from({length:1000},(_,i)=>({start:i*9,end:i*9+9}));
  assert.equal(captionOccurrences(captions,clips).length,10000);
  let reads=0;
  const late={start:0,end:1,basis:'timeline',get text(){reads++;throw new Error('late payload');}};
  assert.throws(()=>captionOccurrences([...captions,late],clips),e=>e.code==='CAPTION_OUTPUT_LIMIT'&&e.messageKey==='errors.derivedCount'&&e.path==='project.captions');
  assert.equal(reads,0);
  const text='한'.repeat(600)+'a'.repeat(100);assert.equal(new TextEncoder().encode(text).byteLength,1900);
  const bytes=[{start:0,end:1100,text},...Array.from({length:1100},(_,i)=>({start:i,end:i+.5,text}))];
  const byteClips=Array.from({length:110},(_,i)=>({start:i*10,end:i*10+10}));
  bytes[1100]={start:1099,end:1099.5,get text(){reads++;throw new Error('late byte payload');}};
  assert.throws(()=>captionOccurrences(bytes,byteClips),e=>e.code==='CAPTION_OUTPUT_LIMIT'&&e.messageKey==='errors.derivedBytes'&&e.path==='project.captions');
  assert.throws(()=>exhaustive(bytes,byteClips),/bytes/);assert.equal(reads,0);
});
