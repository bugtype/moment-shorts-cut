import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createDemoProject, createProjectDocument} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';

test('browser command reading captions preserves playback, selection, undo and saves',async()=>{
  const {context,evaluate}=await createAppFixture();
  vm.runInContext('history=[];future=[];current=2;selected=0;globalThis.listSaves=0;scheduleSave=()=>listSaves++;',context);
  const before=evaluate('({state,history,future,current,selected})');
  const result=await context.window.moment.execute('captions.list',{offset:1,limit:1});
  assert.equal(result.ok,true);assert.equal(result.data.captions[0].captionIndex,1);
  assert.deepEqual(result.data.captions[0].caption,before.state.captions[1]);
  result.data.captions[0].caption.text='Client-only change';
  assert.deepEqual(evaluate('({state,history,future,current,selected})'),before);
  assert.equal(evaluate('listSaves'),0);
});

test('CLI pages authored captions without resubmitting, rewriting or exporting their timing', async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'moment-caption-pages-'));
  try {
    const project=createDemoProject();
    project.clips=[{start:0,end:4},{start:0,end:4}];project.speed=2;
    project.captions=Array.from({length:10000},(_,index)=>({
      start:0,end:1,text:`${index}: literal <b>& 😀 `+'x'.repeat(100),
      ...(index%2?{basis:'timeline',speaker:'1',keywords:'literal',timing:'estimated'}:{}),
    }));
    const input=path.join(directory,'project.json'),output=path.join(directory,'page.json');
    const original=JSON.stringify(createProjectDocument(project));await fs.writeFile(input,original);
    const run=(args,flags=[])=>spawnSync(process.execPath,[
      fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),
      'exec','captions.list','--project',input,'--json',JSON.stringify(args),...flags,
    ],{encoding:'utf8',maxBuffer:1024*1024});
    let result=run({offset:9998,limit:20},['--out',output]);
    assert.equal(result.status,0,result.stderr);
    const envelope=JSON.parse(result.stdout),page=JSON.parse(await fs.readFile(output,'utf8'));
    assert.deepEqual(page,envelope.data);
    assert.deepEqual(page,{totalCaptions:10000,offset:9998,limit:20,nextOffset:null,
      captions:project.captions.slice(9998).map((caption,index)=>({captionIndex:9998+index,caption}))});
    assert.equal(Object.hasOwn(page.captions[0].caption,'basis'),false);
    assert.equal(Buffer.byteLength(result.stdout)<10000,true,'response contains only the selected rows');
    assert.equal(await fs.readFile(input,'utf8'),original);
    const saved=await fs.readFile(output,'utf8');
    result=run({offset:0,limit:2},['--out',output]);
    assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).error.code,'FILE_EXISTS');
    assert.equal(await fs.readFile(output,'utf8'),saved);
    result=run({offset:.5},['--out',output,'--overwrite']);
    assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).error.code,'INVALID_ARGUMENT');
    assert.equal(await fs.readFile(output,'utf8'),saved);
    result=run({offset:10000},['--out',output,'--overwrite','--dry-run']);
    assert.equal(result.status,0,result.stderr);
    const dry=JSON.parse(result.stdout);assert.deepEqual(dry.preview,dry.data);
    assert.deepEqual(dry.data.captions,[]);assert.equal(dry.data.nextOffset,null);
    assert.equal(await fs.readFile(output,'utf8'),saved);
    assert.equal(await fs.readFile(input,'utf8'),original);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
