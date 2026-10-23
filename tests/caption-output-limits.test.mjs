import test from 'node:test';
import assert from 'node:assert/strict';
import { captionOccurrences, MAX_CAPTIONS, MAX_SUBTITLE_BYTES } from '../dist/captions.mjs';
import { createDemoProject, projectSrt, createProjectDocument, readProjectDocument } from '../dist/core/project.mjs';

const cap=text=>({start:0,end:1,text});
const clip=()=>({start:0,end:1});
const limit=error=>error.code==='CAPTION_OUTPUT_LIMIT'&&error.path==='project.captions';
const project=(captions,clips=[clip()])=>({...createDemoProject(),captions,clips});

// Keep each authored cue within the existing 2,000-character input limit.
function textBudget(bytes){
 const captions=[];
 while(bytes){const size=Math.min(bytes,1900);captions.push(cap('a'.repeat(size)));bytes-=size;}
 return captions;
}
function exactSrt(bytes,bom){
 const captions=Array.from({length:1100},()=>cap('한🎬e\u0301&<>\u00a0\r\n끝'));
 const p=project(captions);
 let remaining=bytes-Buffer.byteLength(projectSrt(p,{bom}));
 for(const c of captions){const size=Math.min(remaining,1999-c.text.length);c.text+='a'.repeat(size);remaining-=size;}
 assert.equal(remaining,0);
 return p;
}

test('occurrence count includes repeats and overlaps, but timeline captions occur once',()=>{
 const captions=Array.from({length:100},()=>cap('same'));
 const clips=Array.from({length:100},clip);
 const before=structuredClone({captions,clips});
 assert.equal(captionOccurrences(captions,clips).length,MAX_CAPTIONS);
 assert.match(projectSrt(project(captions,clips)),/10000\n/);
 const timeline={...cap('narration'),basis:'timeline'};
 assert.throws(()=>captionOccurrences([...captions,timeline],clips),limit);
 assert.equal(captionOccurrences([...captions.slice(1),timeline],clips).length,9901);
 assert.equal(captionOccurrences(captions,[{start:2,end:3}]).length,0);
 assert.deepEqual({captions,clips},before);
 // Abort without reading payloads after the first over-budget occurrence.
 const late={start:0,end:1,get text(){throw new Error('read beyond count limit');}};
 assert.throws(()=>captionOccurrences([...captions,...Array.from({length:9900},()=>cap('x')),late],[clip()]),limit);
});

test('raw occurrence bytes use UTF-8, count repeated text, and reject before reading later payloads',()=>{
 const captions=textBudget(MAX_SUBTITLE_BYTES-Buffer.byteLength('한🎬e\u0301\r\n&<>'));
 captions.push(cap('한🎬e\u0301\r\n&<>'));
 assert.equal(captionOccurrences(captions,[clip()]).length,captions.length);
 const before=structuredClone(captions);
 const late={start:0,end:1,get text(){throw new Error('read beyond byte limit');}};
 assert.throws(()=>captionOccurrences([...captions,cap('a'),late],[clip()]),limit);
 assert.deepEqual(captions,before);
 assert.throws(()=>captionOccurrences(captions,[clip(),clip()]),limit);
 const narration=captions.map(c=>({...c,basis:'timeline'}));
 assert.equal(captionOccurrences(narration,[clip(),clip()]).length,captions.length);
});

test('completed SRT budget includes escaped UTF-8 text, LF separators, timestamps and emitted BOM',()=>{
 for(const bom of [false,true]){
  const p=exactSrt(MAX_SUBTITLE_BYTES,bom),before=structuredClone(p);
  const srt=projectSrt(p,{bom});
  assert.equal(Buffer.byteLength(srt),MAX_SUBTITLE_BYTES);
  assert.equal(srt.startsWith('\ufeff'),bom);
  assert.ok(srt.includes('한🎬e\u0301&amp;&lt;&gt;&nbsp;\n끝'));
  assert.ok(!srt.includes('\r'));
  assert.deepEqual(readProjectDocument(createProjectDocument(p)),p);
  p.captions.at(-1).text+='a';
  assert.throws(()=>projectSrt(p,{bom}),limit);
  p.captions.at(-1).text=p.captions.at(-1).text.slice(0,-1);
  assert.deepEqual(p,before);
  assert.equal(projectSrt(p,{bom}),srt);
 }
 const p=exactSrt(MAX_SUBTITLE_BYTES,false);
 assert.throws(()=>projectSrt(p,{bom:true}),limit,'browser BOM cannot exceed file budget');
 p.captions[0].text=p.captions[0].text.slice(0,-3);
 assert.equal(Buffer.byteLength(projectSrt(p,{bom:true})),MAX_SUBTITLE_BYTES);
 assert.equal(projectSrt(project([]),{bom:true}),'');
});

test('raw byte and serialized byte budgets are distinct and errors never mutate original projects',()=>{
 const p=project(Array.from({length:300},()=>cap('&'.repeat(1600))));
 const before=structuredClone(p);
 assert.equal(captionOccurrences(p.captions,p.clips).length,300);
 assert.throws(()=>projectSrt(p),limit);
 assert.deepEqual(p,before);
 assert.deepEqual(readProjectDocument(createProjectDocument(p)),before);
});
