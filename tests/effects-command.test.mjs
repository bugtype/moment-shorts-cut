import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createCompositionRenderer} from '../dist/composition-renderer.mjs';
import {clipEffects} from '../dist/effects.mjs';
import {createCanvasTrace} from './fixtures/canvas-trace.mjs';
import {createAppFixture} from './fixtures/app.mjs';

const patch={motion:'in',strength:.2,transition:'flash',transitionDuration:.2,brightness:1.1,contrast:1.2,saturation:.8,vignette:.2,progress:true,progressPosition:'top',progressColor:'#aAbBcC80'};
test('effects update changes only supplied effect settings with no timeline or subtitle changes',()=>{
 const p=createDemoProject(),before=structuredClone(p),result=prepareCommand(p,'effects.update',{patch});
 assert.deepEqual(result.project,{...p,effects:{...p.effects,...patch}});assert.deepEqual(p,before);assert.deepEqual(result.data,{updated:true,outputDuration:12});
 for(const format of ['srt','vtt'])assert.equal(projectSubtitles(result.project,{format}),projectSubtitles(p,{format}));
 assert.deepEqual(prepareCommand(p,'effects.update',{patch:{}}).project,p);
 assert.equal(prepareCommand(p,'effects.update',{patch:{brightness:1.2}}).project.effects.contrast,p.effects.contrast);
});
test('effect boundaries and enums reuse project rules; all invalid patches are atomic',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 for(const values of [
  {strength:0,transitionDuration:.05,brightness:.7,contrast:.7,saturation:0,vignette:0,progress:false},
  {strength:.4,transitionDuration:.7,brightness:1.3,contrast:1.5,saturation:1.6,vignette:.6,progress:true},
 ])assert.doesNotThrow(()=>prepareCommand(p,'effects.update',{patch:values}));
 for(const motion of ['none','in','out'])assert.doesNotThrow(()=>prepareCommand(p,'effects.update',{patch:{motion}}));
 for(const transition of ['none','fadeBlack','flash'])assert.doesNotThrow(()=>prepareCommand(p,'effects.update',{patch:{transition}}));
 for(const invalid of [{strength:.41},{transitionDuration:0},{brightness:1.31},{contrast:.69},{saturation:-.1},{vignette:.61},{motion:'pan'},{transition:'crossfade'},{progress:1},{progressPosition:'left'},{progressColor:'red'},{progressColor:'#fff'},{duration:3},{overlays:[]},{brightness:NaN}]){
  assert.throws(()=>prepareCommand(p,'effects.update',{patch:{contrast:1.2,...invalid}}),e=>e.code==='INVALID_ARGUMENT');assert.deepEqual(p,before);
 }
});
test('updated effects reach the existing compositor as filter, zoom, vignette and per-clip overlay commands',()=>{
 const p=createDemoProject();p.design.layout='full';p.fit='contain';p.zoom=1;p.panX=p.panY=0;
 const next=prepareCommand(p,'effects.update',{patch}).project,trace=createCanvasTrace();
 createCompositionRenderer(trace.makeCanvas).draw(trace.context,200,200,next,{source:{traceName:'video'},sw:100,sh:200,ready:true,sourceTime:1,time:1,total:12,elapsed:.1,remaining:.9,progress:.5});
 assert.ok(trace.events.some(e=>e[1]==='filter'&&e[2]==='brightness(1.1) contrast(1.2) saturate(0.8)'));
 const image=trace.events.find(e=>e[1]==='drawImage'&&e[2]==='video');assert.ok(Math.abs(image[5]-110)<1e-10);assert.ok(Math.abs(image[6]-220)<1e-10);
 assert.ok(trace.events.some(e=>e[1]==='createRadialGradient'));assert.ok(trace.events.some(e=>e[1]==='globalAlpha'&&e[2]===.375));
 assert.equal(clipEffects({...next.effects,transitionDuration:.7},.05,.05,.5).opacity,0,'transition capped to half a short output clip');
});
test('effects service commits once and rejects malformed color without replacing prior state',async()=>{
 let p=createDemoProject(),commits=0;const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 assert.equal((await service.execute('effects.update',{patch})).ok,true);assert.equal(commits,1);const before=structuredClone(p);
 assert.equal((await service.execute('effects.update',{patch:{brightness:1.2,progressColor:'invalid'}})).ok,false);assert.equal(commits,1);assert.deepEqual(p,before);
});
test('effects command preserves active trim draft and supports app undo and busy protection',async()=>{
 const {context,evaluate,element}=await createAppFixture();vm.runInContext('history=[];future=[];renderTimeline();',context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';element('#trimStart').focus();const before=evaluate('state');
 assert.equal(vm.runInContext('runEditorCommand("effects.update",{patch:{brightness:1.2}})',context),true);assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);assert.equal(evaluate('history.length'),1);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
 vm.runInContext('exporting=true',context);assert.equal(vm.runInContext('runEditorCommand("effects.update",{patch:{brightness:1.2}})',context),false);assert.deepEqual(evaluate('state'),before);
});
test('CLI effects dry-run and saved output preserve input; failed patches cannot replace output',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-effects-'));
 try{
  const input=path.join(dir,'project.json'),output=path.join(dir,'effects.json'),original=JSON.stringify(createProjectDocument(createDemoProject()));await fs.writeFile(input,original);
  const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','effects.update','--project',input,...args],{encoding:'utf8'});
  const args=['--json',JSON.stringify({patch})];let result=run([...args,'--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).preview.project.effects.brightness,1.1);
  result=run([...args,'--out',output]);assert.equal(result.status,0,result.stderr);const saved=await fs.readFile(output,'utf8');assert.deepEqual(JSON.parse(saved).project.effects,patch);
  result=run(['--json','{"patch":{"motion":"invalid"}}','--out',output,'--overwrite']);assert.equal(result.status,1);assert.equal(await fs.readFile(output,'utf8'),saved);assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
