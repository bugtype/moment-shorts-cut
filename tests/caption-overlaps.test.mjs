import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {inspectCaptionOverlaps} from '../dist/core/caption-overlaps.mjs';
import {captionOccurrences} from '../dist/captions.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
const project=cues=>({...createDemoProject(),captions:cues.map(c=>({text:'',...c}))});
function verify(p){
 const before=structuredClone(p),occ=captionOccurrences(p.captions,p.clips,p.speed),flagged=[];
 for(let i=0;i<occ.length;i++)if(occ.some((b,j)=>i!==j&&Math.max(occ[i].start,b.start)<Math.min(occ[i].end,b.end)))flagged.push(i);
 const result=inspectCaptionOverlaps(p,{limit:100});assert.equal(result.flaggedOccurrences,flagged.length);
 assert.deepEqual(result.issues.map(i=>i.occurrenceIndex),flagged.slice(0,100));assert.equal(result.omittedOccurrences,Math.max(0,flagged.length-100));
 for(const issue of result.issues){
  const a=occ[issue.occurrenceIndex],b=occ[issue.otherOccurrenceIndex];assert.notEqual(issue.occurrenceIndex,issue.otherOccurrenceIndex);
  assert.equal(issue.captionIndex,a.captionIndex);assert.equal(issue.otherCaptionIndex,b.captionIndex);
  assert.equal(issue.start,a.start);assert.equal(issue.end,a.end);assert.equal(issue.otherStart,b.start);assert.equal(issue.otherEnd,b.end);
  assert.equal(issue.overlapStart,Math.max(a.start,b.start));assert.equal(issue.overlapEnd,Math.min(a.end,b.end));assert.ok(issue.overlapEnd>issue.overlapStart);
  assert.equal(Object.hasOwn(issue,'text'),false);assert.equal(issue.clipIndex,a.clipIndex);assert.equal(issue.otherClipIndex,b.clipIndex);
 }
 assert.deepEqual(p,before);return result;
}
test('nesting, chains, equal starts/ends and endpoint touching flag every affected occurrence once',()=>{
 for(const intervals of [[[0,10],[1,2],[3,4]],[[0,2],[1,3],[2,4]],[[0,2],[0,2],[0,3]],[[0,1],[1,2],[2,3]],[[0,10],[1,2],[2,3],[10,11]]])verify(project(intervals.map(([start,end])=>({start,end}))));
 const nested=verify(project([{start:0,end:10},{start:1,end:2},{start:3,end:4}]));
 assert.deepEqual(nested.issues.map(i=>i.otherOccurrenceIndex),[1,0,0]);
 assert.equal(inspectCaptionOverlaps(project([])).flaggedOccurrences,0);
});
test('mixed clocks, cuts, repeated sources and speed preserve occurrence mapping and omit optional timeline clip indices',()=>{
 for(const speed of [.25,1,4]){
  const p=project([{start:0,end:2},{start:.5,end:1.5,basis:'timeline'},{start:2,end:3,basis:'source'}]);
  p.clips=[{start:2,end:3},{start:0,end:2},{start:0,end:2}];p.speed=speed;verify(p);
 }
 const repeated=project([{start:0,end:1}]);repeated.clips=[{start:0,end:1},{start:0,end:1}];assert.equal(verify(repeated).flaggedOccurrences,0);
});
test('400 seeded small projects match exhaustive pair oracle without mutating input',()=>{
 let seed=1847;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let trial=0;trial<400;trial++){
  const p=project(Array.from({length:Math.floor(random()*20)},()=>{const start=Math.floor(random()*100)/10;return{start,end:Math.min(12,start+.1+Math.floor(random()*20)/10),basis:random()<.5?'source':'timeline'};}));
  p.speed=[.25,1,2,4][Math.floor(random()*4)];p.clips=Array.from({length:1+Math.floor(random()*4)},()=>{const start=Math.floor(random()*8);return{start,end:start+1+Math.floor(random()*3)};});verify(p);
 }
});
test('10000 dense occurrences retain exact counts with bounded results and no all-pairs allocation',()=>{
 const p=project(Array.from({length:10000},()=>({start:0,end:12,text:'x'}))),report=inspectCaptionOverlaps(p);
 assert.equal(report.totalOccurrences,10000);assert.equal(report.flaggedOccurrences,10000);assert.equal(report.omittedOccurrences,9980);assert.equal(report.issues.length,20);
 assert.ok(JSON.stringify(report).length<10000);assert.deepEqual(report.issues.map(i=>i.occurrenceIndex),Array.from({length:20},(_,i)=>i));
});
test('invalid limit/null/unknown arguments and batch admission reject while shared projection budgets stay enforced',()=>{
 const p=project([{start:0,end:1}]);for(const limit of [0,101,.5,null,'20',NaN,Infinity])assert.throws(()=>prepareCommand(p,'captions.overlaps',{limit}),e=>e.code==='INVALID_ARGUMENT');
 assert.throws(()=>prepareCommand(p,'captions.overlaps',{extra:true}));
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[{command:'captions.overlaps',arguments:{}}]}));
 const many=project(Array.from({length:5001},()=>({start:0,end:1})));many.clips=[{start:0,end:1},{start:0,end:1}];assert.throws(()=>inspectCaptionOverlaps(many),e=>e.code==='CAPTION_OUTPUT_LIMIT');
 const bytes=project(Array.from({length:400},()=>({start:0,end:1,text:'가'.repeat(2000)})));assert.throws(()=>inspectCaptionOverlaps(bytes),e=>e.code==='CAPTION_OUTPUT_LIMIT');
});
test('service and MCP are read-only, default limit works and output envelope contains no caption text',async()=>{
 const p=project([{start:0,end:4,text:'private A'},{start:1,end:3,text:'private B',basis:'timeline'}]);let commits=0;
 const service=createEditorService({getProject:()=>p,commitProject:()=>commits++});
 const result=await service.execute('captions.overlaps');assert.equal(result.ok,true);assert.equal(result.data.flaggedOccurrences,2);assert.equal(commits,0);
 const adapter=createMcpToolAdapter({resolveService:()=>service});const tool=adapter.listTools().tools.find(t=>t.name==='moment_captions_overlaps');assert.equal(tool.annotations.readOnlyHint,true);
 const called=await adapter.callTool('moment_captions_overlaps',{projectId:'test',limit:1});assert.equal(called.isError,false);assert.equal(called.structuredContent.data.omittedOccurrences,1);assert.equal(commits,0);
 assert.equal(JSON.stringify(result).includes('private'),false);
});

test('tiny positive projections retain exact comparisons while collapsed output intervals reject clearly',()=>{
 const p=project([{start:0,end:Number.MIN_VALUE}]);p.speed=4;
 assert.throws(()=>inspectCaptionOverlaps(p),error=>error.code==='INVALID_ARGUMENT'&&error.path==='project.captions[0]');
 const tiny=project([{start:0,end:1e-10},{start:5e-11,end:2e-10}]);tiny.speed=4;assert.equal(verify(tiny).flaggedOccurrences,2);
});
