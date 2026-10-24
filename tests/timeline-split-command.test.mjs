import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createDemoProject,createProjectDocument,outputDuration,MAX_CLIPS} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createAppFixture} from './fixtures/app.mjs';

function project(){return {...createDemoProject(),clips:[{start:8,end:9},{start:2,end:6},{start:8,end:9}],speed:2,captions:[{start:8,end:9,text:'반복',basis:'source'},{start:1,end:2,text:'내레이션',basis:'timeline'}]};}
test('split uses occurrence index and original source time while preserving unrelated project data',()=>{
 const p=project(),before=structuredClone(p);
 const result=prepareCommand(p,'timeline.split',{clipIndex:2,sourceTime:8.5});
 assert.deepEqual(result.project.clips,[...p.clips.slice(0,2),{start:8,end:8.5},{start:8.5,end:9}]);
 assert.deepEqual({...result.project,clips:p.clips},p);assert.deepEqual(p,before);
 assert.deepEqual(result.data,{updated:true,outputDuration:3});
 assert.equal(outputDuration(result.project),outputDuration(p));
});
test('split accepts decimal minimum halves and rejects boundaries, invalid indices and clip overflow atomically',()=>{
 const p=project(),before=structuredClone(p);
 for(const sourceTime of [8.1,8.9])assert.doesNotThrow(()=>prepareCommand(p,'timeline.split',{clipIndex:0,sourceTime}));
 for(const [start,end,sourceTime] of [[.2,.4,.3],[.1,.3,.2],[86399.8,86400,86399.9]]){
  const exact={...createDemoProject(),duration:86400,clips:[{start,end}]};
  const result=prepareCommand(exact,'timeline.split',{clipIndex:0,sourceTime});
  assert.deepEqual(result.project.clips,[{start,end:sourceTime},{start:sourceTime,end}]);
  for(const tooClose of [start+.1-1e-7,end-.1+1e-7])assert.throws(()=>prepareCommand(exact,'timeline.split',{clipIndex:0,sourceTime:tooClose}),/0.1/);
 }
 for(const args of [
  {clipIndex:0,sourceTime:8},{clipIndex:0,sourceTime:9},{clipIndex:0,sourceTime:8.099},{clipIndex:0,sourceTime:8.901},
  {clipIndex:-1,sourceTime:8.5},{clipIndex:3,sourceTime:8.5},{clipIndex:.5,sourceTime:8.5},{clipIndex:'0',sourceTime:8.5},
  {clipIndex:null,sourceTime:8.5},{clipIndex:0,sourceTime:'8.5'},{clipIndex:0,sourceTime:NaN},{clipIndex:0,sourceTime:Infinity},
  {clipIndex:0},{sourceTime:8.5},{clipIndex:0,sourceTime:8.5,extra:true},
 ]){assert.throws(()=>prepareCommand(p,'timeline.split',args),e=>e.code==='INVALID_ARGUMENT');assert.deepEqual(p,before);}
 const full={...p,clips:Array.from({length:MAX_CLIPS},()=>({start:8,end:9}))};
 assert.throws(()=>prepareCommand(full,'timeline.split',{clipIndex:0,sourceTime:8.5}),/1,000/);
 const almost={...p,clips:full.clips.slice(1)};
 assert.equal(prepareCommand(almost,'timeline.split',{clipIndex:998,sourceTime:8.5}).project.clips.length,1000);
});
test('split service makes one commit, preserves authored timing, and rejects errors without a second commit',async()=>{
 let p=project(),commits=0;const before=structuredClone(p);
 const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 assert.equal((await service.execute('timeline.split',{clipIndex:1,sourceTime:3})).ok,true);assert.equal(commits,1);
 assert.deepEqual(p.captions,before.captions);assert.deepEqual(p.design,before.design);assert.deepEqual(p.overlays,before.overlays);
 const saved=structuredClone(p);assert.equal((await service.execute('timeline.split',{clipIndex:1,sourceTime:2})).ok,false);assert.equal(commits,1);assert.deepEqual(p,saved);
});
test('UI split shares busy/validation boundary, selects right half and is one undoable edit',async()=>{
 const {context,evaluate,element}=await createAppFixture();
 vm.runInContext('state=initial();state.clips=[{start:8,end:9}];current=.1;selected=0;history=[];future=[];renderTimeline();',context);
 const before=evaluate('state');
 element('#splitButton').onclick();assert.equal(evaluate('state.clips.length'),2);assert.equal(evaluate('selected'),1);assert.equal(evaluate('history.length'),1);
 assert.equal(element('#trimStart').value,'8.1');assert.equal(element('#trimEnd').value,'9.0');
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
 vm.runInContext('undo(true)',context);assert.equal(evaluate('state.clips.length'),2);
 for(const flag of ['exporting','loadingMedia','transcribing']){
  vm.runInContext(`state=initial();current=6;selected=0;history=[];future=[];${flag}=true;`,context);
  const unchanged=evaluate('({state,selected,history,future})');element('#splitButton').onclick();assert.deepEqual(evaluate('({state,selected,history,future})'),unchanged);
  assert.match(element('#toast').textContent,/진행 중/);vm.runInContext(`${flag}=false`,context);
 }
});
test('CLI split dry-run/save preserve input and invalid output refuses to overwrite',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-split-'));
 try{
  const input=path.join(dir,'project.json'),output=path.join(dir,'split.json');
  const original=JSON.stringify(createProjectDocument(project()));await fs.writeFile(input,original);
  const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','timeline.split','--project',input,...args],{encoding:'utf8'});
  const args=['--json','{"clipIndex":2,"sourceTime":8.5}'];
  let result=run([...args,'--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).preview.project.clips.length,4);
  result=run([...args,'--out',output]);assert.equal(result.status,0,result.stderr);const saved=await fs.readFile(output,'utf8');assert.deepEqual(JSON.parse(saved).project.clips[2],{start:8,end:8.5});
  result=run(['--json','{"clipIndex":2,"sourceTime":8}','--out',output,'--overwrite']);assert.equal(result.status,1);assert.equal(await fs.readFile(output,'utf8'),saved);assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
