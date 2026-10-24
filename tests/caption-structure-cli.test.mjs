import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';

test('browser insert/remove preserve trim and unrelated state with one undo per command',async()=>{
  const {context,evaluate,element}=await createAppFixture();
  vm.runInContext('history=[];future=[];current=2;selected=0;renderInspector();',context);
  element('#trimStart').value='1.25';element('#trimEnd').value='4.25';
  const before=evaluate('state');
  assert.equal(vm.runInContext("runEditorCommand('captions.insert',{captionIndex:1,caption:{start:1,end:2,text:'Inserted',basis:'timeline'}})",context),true);
  const inserted=evaluate('state');assert.equal(inserted.captions[1].text,'Inserted');
  assert.deepEqual(inserted.captions.filter((_,index)=>index!==1),before.captions);
  assert.equal(evaluate('history.length'),1);assert.equal(evaluate('current'),2);
  assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.25','4.25']);
  vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
  vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),inserted);
  assert.equal(vm.runInContext("runEditorCommand('captions.remove',{captionIndex:1})",context),true);
  assert.deepEqual(evaluate('state'),before);assert.equal(evaluate('history.length'),2);
  vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),inserted);
  for(const busy of ['exporting','loadingMedia','transcribing']){
    vm.runInContext(busy+'=true',context);const snapshot=evaluate('({state,history,future,current})');
    assert.equal(vm.runInContext("runEditorCommand('captions.remove',{captionIndex:0})",context),false);
    assert.equal(vm.runInContext("runEditorCommand('captions.insert',{captionIndex:0,caption:{start:0,end:1,text:'Blocked'}})",context),false);
    assert.deepEqual(evaluate('({state,history,future,current})'),snapshot);
    vm.runInContext(busy+'=false',context);
  }
});

test('CLI inserts/removes one of 10000 cues with bounded arguments and protected output',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-caption-structure-'));
  try {
    const project=createDemoProject();project.captions=Array.from({length:10000},(_,index)=>({start:0,end:1,text:String(index)}));
    const input=path.join(directory,'input.json'),removed=path.join(directory,'removed.json'),inserted=path.join(directory,'inserted.json');
    const source=JSON.stringify(createProjectDocument(project));await fs.writeFile(input,source);
    const run=(command,file,args,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),
      'exec',command,'--project',file,'--json',JSON.stringify(args),...flags],{encoding:'utf8',maxBuffer:4*1024*1024});
    let result=run('captions.remove',input,{captionIndex:5000},['--out',removed]);
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).data.totalCaptions,9999);
    const reduced=JSON.parse(await fs.readFile(removed,'utf8')).project;
    assert.deepEqual(reduced.captions,[...project.captions.slice(0,5000),...project.captions.slice(5001)]);
    const caption={start:2,end:3,text:'Literal 😀 <b>&',basis:'timeline',speaker:'1',keywords:'Literal',timing:'estimated'};
    result=run('captions.insert',removed,{captionIndex:5000,caption},['--out',inserted]);
    assert.equal(result.status,0,result.stderr);
    const restored=JSON.parse(await fs.readFile(inserted,'utf8')).project;
    assert.deepEqual(restored.captions[5000],caption);assert.equal(restored.captions.length,10000);
    assert.deepEqual(restored.captions.filter((_,index)=>index!==5000),reduced.captions);
    const saved=await fs.readFile(inserted,'utf8');
    result=run('captions.insert',inserted,{captionIndex:0,caption},['--out',inserted,'--overwrite']);
    assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).error.code,'INVALID_ARGUMENT');
    assert.equal(await fs.readFile(inserted,'utf8'),saved);
    result=run('captions.remove',removed,{captionIndex:9999},['--out',inserted,'--overwrite']);
    assert.equal(result.status,1);assert.equal(await fs.readFile(inserted,'utf8'),saved);
    result=run('captions.remove',input,{captionIndex:0},['--out',inserted,'--overwrite','--dry-run']);
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).preview.project.captions.length,9999);
    assert.equal(await fs.readFile(inserted,'utf8'),saved);assert.equal(await fs.readFile(input,'utf8'),source);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});
