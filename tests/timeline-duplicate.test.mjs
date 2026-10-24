import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {newCard} from '../dist/effects.mjs';
import {createAppFixture} from './fixtures/app.mjs';
const project=()=>{const p=createDemoProject();p.clips=[{start:2,end:4},{start:6,end:8},{start:9,end:10}];return p;};
test('duplicate first/middle/last preserves source intervals and matches existing replacement semantics',()=>{
 for(const clipIndex of [0,1,2]){
  const p=project(),before=structuredClone(p),clips=structuredClone(p.clips);clips.splice(clipIndex+1,0,{...clips[clipIndex]});
  const r=prepareCommand(p,'timeline.duplicate',{clipIndex});assert.deepEqual(r,prepareCommand(p,'timeline.replace',{clips}));assert.deepEqual(p,before);
 }
});
test('source speech repeats; timeline speech/audio remain absolute and output layers scale with speed',()=>{
 const p=project();p.speed=2;p.audioOffset=1;p.captions=[{start:2,end:3,text:'source',speaker:'0',keywords:'source'},{start:1,end:2,text:'narration',basis:'timeline'}];
 p.overlays=[{...newCard(2.5),start:.5,end:1.5}];p.design.credit.start=2;p.design.credit.end=null;
 const r=prepareCommand(p,'timeline.duplicate',{clipIndex:0});assert.equal(r.data.outputDuration,3.5);
 assert.deepEqual(r.project.captions,p.captions);assert.equal(r.project.audioOffset,1);
 assert.equal(r.project.overlays[0].start,.7);assert.equal(r.project.overlays[0].end,2.0999999999999996);assert.equal(r.project.design.credit.start,2.8);assert.equal(r.project.design.credit.end,null);
 assert.equal(projectSubtitles(r.project,{format:'txt'}),'source\n\nnarration\n\nsource\n');
});
test('1000-clip limit and invalid indices reject atomically',()=>{
 const p=createDemoProject();p.clips=Array.from({length:999},()=>({start:0,end:1}));
 assert.equal(prepareCommand(p,'timeline.duplicate',{clipIndex:998}).project.clips.length,1000);
 p.clips.push({start:0,end:1});const before=structuredClone(p);assert.throws(()=>prepareCommand(p,'timeline.duplicate',{clipIndex:0}),e=>e.code==='INVALID_ARGUMENT');assert.deepEqual(p,before);
 const small=project();for(const clipIndex of [-1,3,.5,NaN,Infinity,'1',null])assert.throws(()=>prepareCommand(small,'timeline.duplicate',{clipIndex}),e=>e.code==='INVALID_ARGUMENT');
});
test('actual duplicate button selects inserted occurrence/seeks its start, one undo, structural trim reset and busy protection',async()=>{
 const {context,evaluate,element}=await createAppFixture();context.seed=project();
 vm.runInContext('state=seed;selected=1;current=1;history=[];future=[];renderTimeline();renderInspector();',context);
 element('#trimStart').value='6.25';element('#trimEnd').value='7.75';const before=evaluate('state');
 element('#duplicateClipButton').onclick();assert.deepEqual(evaluate('state.clips'),[{start:2,end:4},{start:6,end:8},{start:6,end:8},{start:9,end:10}]);
 assert.equal(evaluate('selected'),2);assert.equal(evaluate('current'),4);assert.equal(evaluate('history.length'),1);assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['6.0','8.0']);
 const once=evaluate('state');vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),once);
 element('#duplicateClipButton').onclick();assert.equal(evaluate('state.clips.length'),5);assert.equal(evaluate('selected'),3);assert.equal(evaluate('current'),6);assert.equal(evaluate('history.length'),2);
 vm.runInContext('exporting=true',context);const blocked=evaluate('({state,current,selected,history})');element('#duplicateClipButton').onclick();assert.deepEqual(evaluate('({state,current,selected,history})'),blocked);
 vm.runInContext('exporting=false;state.clips=Array.from({length:1000},()=>({start:0,end:1}));renderInspector();',context);assert.equal(element('#duplicateClipButton').disabled,true);
 vm.runInContext('state=initial();renderInspector();',context);assert.equal(element('#duplicateClipButton').disabled,false);
});
test('real CLI duplicates preview/save and protects output on invalid source index',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-duplicate-'));try{
  const input=path.join(dir,'in.json'),out=path.join(dir,'out.json');await fs.writeFile(input,JSON.stringify(createProjectDocument(project())));
  const run=(clipIndex,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','timeline.duplicate','--project',input,'--json',JSON.stringify({clipIndex}),...flags],{encoding:'utf8'});
  let r=run(0,['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.clips.length,4);
  r=run(0,['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');r=run(4,['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
