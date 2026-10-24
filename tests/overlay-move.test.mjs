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
import {newCard,activeSceneLayers,drawSceneCards} from '../dist/effects.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {mountEffectsPanel} from '../dist/effects-panel.mjs';
const project=()=>({...createDemoProject(),overlays:['a','b','c'].map(id=>({...newCard(12),id,text:id,start:0,end:12,animation:'none'}))});
test('move uses final index, preserves exact fields and changes headline winner/free draw order',()=>{
 const p=project(),before=structuredClone(p),r=prepareCommand(p,'overlays.move',{id:'a',toIndex:2});
 assert.deepEqual(r.data,{updated:true,id:'a',toIndex:2,outputDuration:12});
 assert.deepEqual(r.project,{...before,overlays:[before.overlays[1],before.overlays[2],before.overlays[0]]});assert.deepEqual(p,before);
 assert.equal(activeSceneLayers(p,1)[0].id,'c');assert.equal(activeSceneLayers(r.project,1)[0].id,'a');
 r.project.overlays.forEach(c=>c.role='free');const trace=[];
 const canvas=new Proxy({},{get:()=>()=>{}});drawSceneCards(canvas,540,960,r.project,1,12,{label:(_c,text)=>trace.push(text)});
 assert.deepEqual(trace.filter(text=>['a','b','c'].includes(text)),['b','c','a']);
 const back=prepareCommand(r.project,'overlays.move',{id:'a',toIndex:0});assert.deepEqual(back.project.overlays.map(c=>c.id),['a','b','c']);
});
test('same-index/one-card no-op and invalid destinations/missing IDs never mutate',()=>{
 const p=project(),before=structuredClone(p);
 assert.equal(prepareCommand(p,'overlays.move',{id:'a',toIndex:0}).project,undefined);
 for(const toIndex of [-1,3,.5,NaN,Infinity,'1'])assert.throws(()=>prepareCommand(p,'overlays.move',{id:'a',toIndex}),e=>e.code==='INVALID_ARGUMENT');
 assert.throws(()=>prepareCommand(p,'overlays.move',{id:'missing',toIndex:0}),e=>e.code==='NOT_FOUND');
 assert.throws(()=>prepareCommand(p,'overlays.move',{id:'',toIndex:0}));assert.deepEqual(p,before);
 p.overlays=[{...p.overlays[0],id:'  '}];assert.equal(prepareCommand(p,'overlays.move',{id:'  ',toIndex:0}).data.updated,false);
 p.overlays=[];assert.throws(()=>prepareCommand(p,'overlays.move',{id:'a',toIndex:0}),e=>e.code==='NOT_FOUND');
});
test('app card-order controls preserve selection/current/trim with one undo and reject busy or detached actions',async()=>{
 const f=await createAppFixture(),{context,evaluate,element}=f;context.seed=project();
 vm.runInContext('state=seed;selectedCard="a";current=2;selected=0;history=[];future=[];renderInspector();switchPanel("effects");',context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';
 const button=element('#panelContent #effectControls #sceneToFront'),stale=button.onclick;button.onclick();
 assert.deepEqual(evaluate('state.overlays.map(c=>c.id)'),['b','c','a']);assert.equal(evaluate('history.length'),1);assert.equal(evaluate('current'),2);assert.equal(evaluate('selectedCard'),'a');
 assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);
 stale();assert.equal(evaluate('history.length'),1);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state.overlays.map(c=>c.id)'),['a','b','c']);
 vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state.overlays.map(c=>c.id)'),['b','c','a']);
 vm.runInContext('exporting=true',context);element('#panelContent #effectControls #sceneToBack').onclick();assert.equal(evaluate('history.length'),1);assert.deepEqual(evaluate('state.overlays.map(c=>c.id)'),['b','c','a']);
});
test('mounted card controls disable boundary moves and focus an enabled opposite control',()=>{
 let p=project(),selected='a',controls,focus=null;const root={querySelector:()=>controls,querySelectorAll:()=>[]};
 Object.defineProperty(root,'innerHTML',{set(){controls={nodes:new Map(),querySelector(id){return this.nodes.get(id)||null;},querySelectorAll(){return [];}};
 Object.defineProperty(controls,'innerHTML',{set(html){for(const m of html.matchAll(/<button[^>]*id="([^"]+)"[^>]*>/g))controls.nodes.set('#'+m[1],{disabled:/\bdisabled/.test(m[0]),focus(){if(!this.disabled)focus=m[1];}});}});}});
 const render=()=>mountEffectsPanel(root,{state:p,total:12,tab:'cards',selected,move(id,toIndex){const r=prepareCommand(p,'overlays.move',{id,toIndex});if(r.project)p=r.project;render();return true;}});
 render();assert.equal(controls.querySelector('#sceneToBack').disabled,true);const stale=controls.querySelector('#sceneToFront').onclick;
 stale();assert.equal(controls.querySelector('#sceneToFront').disabled,true);assert.equal(focus,'sceneToBack');
 stale();assert.deepEqual(p.overlays.map(c=>c.id),['b','c','a']);controls.querySelector('#sceneToBack').onclick();assert.equal(focus,'sceneToFront');
});
test('real CLI move previews/saves new order and failed index protects existing output',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-order-'));try{
  const input=path.join(dir,'in.json'),out=path.join(dir,'out.json');await fs.writeFile(input,JSON.stringify(createProjectDocument(project())));
  const run=(toIndex,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','overlays.move','--project',input,'--json',JSON.stringify({id:'a',toIndex}),...flags],{encoding:'utf8'});
  let r=run(2,['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.overlays[2].id,'a');
  r=run(2,['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');r=run(3,['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
