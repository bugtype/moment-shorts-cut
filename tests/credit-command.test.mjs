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
import {createCompositionRenderer} from '../dist/composition-renderer.mjs';
import {createCanvasTrace} from './fixtures/canvas-trace.mjs';
import {createAppFixture} from './fixtures/app.mjs';

test('credit partial updates preserve every unrelated field and subtitle byte across all formats',()=>{
 const p=createDemoProject();p.speed=2;const before=structuredClone(p);
 const patch={text:'출처: 🎬',color:'#AABBCC88',x:.2,y:.9,size:30,italic:false,enabled:true,start:4,end:null};
 const r=prepareCommand(p,'credit.update',{patch});
 assert.deepEqual(r.project,{...before,design:{...before.design,credit:{...before.design.credit,...patch}}});
 assert.deepEqual(r.data,{updated:true,outputDuration:6});assert.deepEqual(p,before);
 for(const format of ['srt','vtt','txt'])assert.equal(projectSubtitles(r.project,{format}),projectSubtitles(p,{format}));
 assert.equal(prepareCommand(p,'credit.update',{patch:{}}).data.updated,true);
 assert.equal(prepareCommand(p,'credit.update',{patch:{text:''}}).project.design.credit.text,'');
 assert.equal(prepareCommand(p,'credit.update',{patch:{text:'😀'.repeat(50)}}).project.design.credit.text.length,100);
});
test('explicit output times enforce bounds, content-only preserves valid offscreen timing and long timelines remain supported',()=>{
 const p=createDemoProject();p.speed=2;
 for(const patch of [{start:6},{start:6,end:null},{start:4,end:4},{end:7},{start:-1},{end:Infinity},{text:'x'.repeat(101)},{color:'red'},{x:2},{size:9},{size:121},{enabled:1},{italic:'yes'},{stroke:2}])assert.throws(()=>prepareCommand(p,'credit.update',{patch}),e=>e.code==='INVALID_ARGUMENT');
 const before=structuredClone(p);assert.throws(()=>prepareCommand(p,'credit.update',{patch:{text:'new',end:8}}));assert.deepEqual(p,before);
 p.design.credit.start=10;p.design.credit.end=11;
 assert.equal(prepareCommand(p,'credit.update',{patch:{text:'still authored'}}).project.design.credit.end,11);
 assert.throws(()=>prepareCommand(p,'credit.update',{patch:{end:null}}));
 p.duration=86400;p.clips=[{start:0,end:86400},{start:0,end:86400}];p.speed=1;
 assert.equal(prepareCommand(p,'credit.update',{patch:{start:100000,end:150000}}).project.design.credit.start,100000);
});
test('shared composition trace renders credit only inside its output-time interval',()=>{
 const p=prepareCommand(createDemoProject(),'credit.update',{patch:{text:'SOURCE',start:2,end:4}}).project;
 p.design.title.enabled=false;p.captions=[];
 for(const [time,visible] of [[1,false],[2,true],[3.99,true],[4,false]]){
  const trace=createCanvasTrace(),renderer=createCompositionRenderer(trace.makeCanvas);
  renderer.draw(trace.context,540,960,p,{source:null,sw:0,sh:0,ready:false,sourceTime:time,time,total:12,elapsed:time,remaining:12-time,progress:time/12});
  assert.equal(trace.events.some(e=>e[1]==='fillText'&&e[2]==='SOURCE'),visible);
 }
});
test('app credit command preserves trim/current and one undo/redo while busy errors do not edit',async()=>{
 const {context,evaluate,element}=await createAppFixture();vm.runInContext('selected=0;current=2;history=[];future=[];renderInspector();',context);
 element('#trimStart').value='1.5';element('#trimEnd').value='3.5';const before=evaluate('state');
 assert.equal(vm.runInContext('runEditorCommand("credit.update",{patch:{text:"출처",start:10,end:12}})',context),true);
 const after=evaluate('state');assert.equal(evaluate('current'),2);assert.equal(evaluate('history.length'),1);assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.5','3.5']);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),after);
 vm.runInContext('exporting=true',context);assert.equal(vm.runInContext('runEditorCommand("credit.update",{patch:{text:"blocked"}})',context),false);assert.deepEqual(evaluate('state'),after);assert.equal(evaluate('history.length'),1);
});
test('real CLI previews and saves narrow credits; invalid edit leaves output intact',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-credit-'));try{
  const input=path.join(dir,'input.json'),out=path.join(dir,'out.json');await fs.writeFile(input,JSON.stringify(createProjectDocument(createDemoProject())));
  const run=(patch,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','credit.update','--project',input,'--json',JSON.stringify({patch}),...flags],{encoding:'utf8'});
  let r=run({text:'channel',start:10,end:null},['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.design.credit.start,10);
  r=run({text:'channel'},['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');r=run({start:12},['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
