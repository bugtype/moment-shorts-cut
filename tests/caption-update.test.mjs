import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';
import {createAppFixture} from './fixtures/app.mjs';
const project=()=>{const p=createDemoProject();p.captions=[{start:0,end:2,text:'Original',basis:'source',timing:'estimated',speaker:'0',keywords:'old'},{start:2,end:3,text:'Other'}];return p;};
const update=(p,patch,captionIndex=0)=>prepareCommand(p,'captions.update',{captionIndex,patch});
test('targeted partial update preserves ownership/warning and every unrelated field without input mutation',()=>{
 const p=project(),before=structuredClone(p),patch={text:'New',start:1,end:3,speaker:'1',keywords:'new'};
 const r=update(p,patch);const expected=structuredClone(p);Object.assign(expected.captions[0],patch);
 assert.deepEqual(r.project,expected);assert.deepEqual(p,before);assert.deepEqual(patch,{text:'New',start:1,end:3,speaker:'1',keywords:'new'});assert.deepEqual(r.data,{updated:true,outputDuration:12,captionIndex:0});
 for(const text of ['', '  ', '😀'.repeat(1000)])assert.equal(update(p,{text}).project.captions[0].text,text);
 assert.ok(update(p,{}).project);assert.equal(update(p,{text:p.captions[0].text}).data.updated,true);
});
test('all bad indices and invalid patches reject atomically',()=>{
 const p=project(),before=structuredClone(p);
 for(const index of [-1,2,9999,.5,'0',NaN,Infinity,null])assert.throws(()=>update(p,{},index),e=>e.code==='INVALID_ARGUMENT');
 for(const patch of [{basis:'timeline'},{timing:'estimated'},{unknown:true},{text:null},{text:'x'.repeat(2001)},{speaker:'2'},{keywords:'x'.repeat(501)},{start:-1},{end:86401},{start:2,end:1},{text:'Valid',end:13},{end:NaN}])assert.throws(()=>update(p,patch),e=>e.code==='INVALID_ARGUMENT');
 assert.deepEqual(p,before);p.captions=[];assert.throws(()=>update(p,{}));
});
test('explicit timing edits use current pre-speed basis while content-only keeps valid out-of-range intervals',()=>{
 const p=project();p.clips=[{start:0,end:2},{start:0,end:2}];p.speed=4;
 assert.equal(update(p,{start:10,end:12}).project.captions[0].end,12);
 p.captions[0].basis='timeline';assert.equal(update(p,{start:3,end:4}).project.captions[0].end,4);assert.throws(()=>update(p,{end:5}));
 p.captions[0].start=10;p.captions[0].end=12;assert.equal(update(p,{text:'Kept'}).project.captions[0].end,12);assert.throws(()=>update(p,{end:12}));
 p.duration=86400;p.clips=Array.from({length:2},()=>({start:0,end:86400}));assert.throws(()=>update(p,{end:86401}));
});
test('single patch on10000 cues works through service/MCP/batch with tiny request and one commit',async()=>{
 let p=project();p.captions=Array.from({length:10000},()=>({start:0,end:1,text:'Same'}));const before=structuredClone(p);let commits=0;
 const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 const adapter=createMcpToolAdapter({resolveService:()=>service});const result=await adapter.callTool('moment_captions_update',{projectId:'test',captionIndex:9999,patch:{text:'Unique'}});
 assert.equal(result.isError,false);assert.equal(p.captions[9999].text,'Unique');assert.deepEqual(p.captions.slice(0,9999),before.captions.slice(0,9999));assert.equal(commits,1);
 const r=await service.execute('project.batch',{operations:[{command:'captions.update',arguments:{captionIndex:9999,patch:{speaker:'1'}}},{command:'captions.update',arguments:{captionIndex:0,patch:{text:'First'}}}]});
 assert.equal(r.ok,true);assert.equal(commits,2);assert.equal(p.captions[9999].speaker,'1');assert.equal(p.captions[0].text,'First');
});
test('actual app targeted update preserves trim/current, one undo and busy protection',async()=>{
 const {context,evaluate,element}=await createAppFixture();context.seed=project();vm.runInContext('state=seed;history=[];future=[];current=2;selected=0;renderTimeline();renderInspector();',context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';const before=evaluate('state');
 assert.equal(vm.runInContext("runEditorCommand('captions.update',{captionIndex:0,patch:{text:'Changed'}})",context),true);assert.equal(evaluate('history.length'),1);assert.equal(evaluate('current'),2);assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);vm.runInContext('undo(true);exporting=true',context);const blocked=evaluate('({state,history,current})');
 assert.equal(vm.runInContext("runEditorCommand('captions.update',{captionIndex:0,patch:{text:'Blocked'}})",context),false);assert.deepEqual(evaluate('({state,history,current})'),blocked);
});
test('CLI updates one of10000 cues without resubmitting them and preserves output after invalid patch',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-cue-update-'));try{
 const p=project();p.captions=Array.from({length:10000},()=>({start:0,end:1,text:'Same'}));const input=path.join(dir,'in.json'),out=path.join(dir,'out.json');await fs.writeFile(input,JSON.stringify(createProjectDocument(p)));
 const run=(patch,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.update','--project',input,'--json',JSON.stringify({captionIndex:9999,patch}),...flags],{encoding:'utf8',maxBuffer:4*1024*1024});
 let r=run({text:'Last'},['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.captions[9999].text,'Last');
 r=run({text:'Last'},['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');r=run({basis:'timeline'},['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
