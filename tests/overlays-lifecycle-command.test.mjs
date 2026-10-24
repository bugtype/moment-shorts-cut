import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {newCard} from '../dist/effects.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createAppFixture} from './fixtures/app.mjs';

const args={id:'hook',patch:{text:'시작🎬',start:0,end:2}};
test('add appends new-card defaults with stable IDs; remove preserves all unrelated data and order',()=>{
 const p=createDemoProject();p.speed=2;p.overlays=[{...newCard(6),id:'existing'}];const before=structuredClone(p);
 const added=prepareCommand(p,'overlays.add',args);
 assert.deepEqual(added.data,{updated:true,outputDuration:6,id:'hook'});
 assert.deepEqual(added.project,{...before,overlays:[...before.overlays,{...newCard(6),...args.patch,id:'hook'}]});
 assert.deepEqual(p,before);
 const removed=prepareCommand(added.project,'overlays.remove',{id:'existing'});
 assert.deepEqual(removed.data,{updated:true,outputDuration:6,id:'existing'});
 assert.deepEqual(removed.project,{...before,overlays:[added.project.overlays[1]]});
 assert.equal(added.project.overlays.length,2);
 const legacy={...p,overlays:[{...newCard(6),id:'  '}]};
 assert.deepEqual(prepareCommand(legacy,'overlays.remove',{id:'  '}).project.overlays,[]);
 const long=createDemoProject();long.duration=86400;long.clips=[{start:0,end:86400},{start:0,end:86400}];
 assert.equal(prepareCommand(long,'overlays.add',{id:'long',patch:{text:'',start:100000,end:150000}}).project.overlays[0].end,150000);
});

test('invalid IDs, patch fields, output intervals and capacity reject atomically; disabled cards count',async()=>{
 let p=createDemoProject();p.speed=2;p.overlays=[{...newCard(6),id:'existing'}];const before=structuredClone(p);let commits=0;
 const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 const invalid=[{...args,id:''},{...args,id:' \n'},{...args,id:'a'.repeat(2001)},{...args,id:'existing'},
  {id:'a',patch:{start:0,end:1}},{id:'a',patch:{text:'x',end:1}},{id:'a',patch:{text:'x',start:0}},
  {...args,patch:{...args.patch,start:-1}},{...args,patch:{...args.patch,end:0}},
  {...args,patch:{...args.patch,end:7}},{...args,patch:{...args.patch,id:'overwrite'}},
  {...args,patch:{...args.patch,color:'invalid'}},{...args,patch:{...args.patch,text:'x'.repeat(2001)}}];
 for(const input of invalid){const r=await service.execute('overlays.add',input);assert.equal(r.error?.code,'INVALID_ARGUMENT',JSON.stringify(input));}
 assert.equal((await service.execute('overlays.remove',{id:'missing'})).error.code,'NOT_FOUND');
 assert.equal((await service.execute('overlays.remove',{id:''})).error.code,'INVALID_ARGUMENT');
 assert.deepEqual(p,before);assert.equal(commits,0);
 p.overlays=Array.from({length:12},(_,i)=>({...newCard(6),id:`card-${i}`,enabled:false}));
 const full=structuredClone(p);assert.equal((await service.execute('overlays.add',args)).error.code,'INVALID_ARGUMENT');assert.deepEqual(p,full);
 assert.equal((await service.execute('overlays.remove',{id:'card-5'})).ok,true);
 assert.equal((await service.execute('overlays.add',{id:'a'.repeat(2000),patch:args.patch})).ok,true);
 assert.equal(p.overlays.length,12);
});

test('app add/remove preserve active trim drafts, single undo/redo and busy protection',async()=>{
 const {context,evaluate,element}=await createAppFixture();
 vm.runInContext('history=[];future=[];selected=0;renderTimeline();',context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';element('#trimStart').focus();
 context.addArgs=args;const before=evaluate('state');
 assert.equal(vm.runInContext('runEditorCommand("overlays.add",addArgs)',context),true);
 const added=evaluate('state');assert.equal(evaluate('history.length'),1);
 assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
 vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),added);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';element('#trimStart').focus();
 assert.equal(vm.runInContext('runEditorCommand("overlays.remove",{id:"hook"})',context),true);
 assert.deepEqual(evaluate('state'),before);assert.equal(evaluate('history.length'),2);
 assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),added);
 for(const busy of ['exporting','loadingMedia']){
  vm.runInContext(`${busy}=true`,context);const history=evaluate('history.length');
  assert.equal(vm.runInContext('runEditorCommand("overlays.remove",{id:"hook"})',context),false);
  assert.equal(vm.runInContext('runEditorCommand("overlays.add",{...addArgs,id:"busy"})',context),false);
  assert.deepEqual(evaluate('state'),added);assert.equal(evaluate('history.length'),history);vm.runInContext(`${busy}=false`,context);
 }
});

test('CLI add dry-run/save and remove round trip protect files on duplicate and missing ID',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-cards-'));
 try{
  const input=path.join(dir,'input.json'),output=path.join(dir,'output.json'),removed=path.join(dir,'removed.json');
  const original=JSON.stringify(createProjectDocument(createDemoProject()));await fs.writeFile(input,original);
  const run=(command,file,args,extra=[])=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec',command,'--project',file,'--json',JSON.stringify(args),...extra],{encoding:'utf8'});
  let r=run('overlays.add',input,args,['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.overlays[0].id,'hook');
  r=run('overlays.add',input,args,['--out',output]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(output,'utf8');
  r=run('overlays.add',output,args,['--out',output,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(output,'utf8'),saved);
  r=run('overlays.remove',output,{id:'hook'},['--out',removed]);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(await fs.readFile(removed,'utf8')).project.overlays,[]);
  const restored=await fs.readFile(removed,'utf8');r=run('overlays.remove',removed,{id:'hook'},['--out',removed,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(removed,'utf8'),restored);
  assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('removing the selected card reconciles panel, preview guide and drag target through undo/redo',async()=>{
 const {context,evaluate,element}=await createAppFixture();
 context.cardA={...newCard(12),id:'first',role:'free',start:0,end:12};
 context.cardB={...newCard(12),id:'selected',role:'free',start:0,end:12};
 vm.runInContext('state.overlays=[cardA,cardB]; panel="effects";effectTab="cards";selectedCard="selected";current=1;history=[];future=[];changed();',context);
 assert.equal(evaluate('selectedSceneLayer().id'),'selected');
 assert.equal(vm.runInContext('runEditorCommand("overlays.remove",{id:"selected"})',context),true);
 assert.equal(evaluate('selectedCard'),'first');assert.equal(evaluate('selectedSceneLayer()?.id'),'first');
 assert.equal(element('#layerSelection').hidden,false);
 assert.match(element('#moveHint').textContent,/글자/);
 vm.runInContext('undo()',context);assert.equal(evaluate('selectedCard'),'first');assert.equal(evaluate('selectedSceneLayer()?.id'),'first');
 vm.runInContext('undo(true)',context);assert.equal(evaluate('selectedSceneLayer()?.id'),'first');
 assert.equal(vm.runInContext('runEditorCommand("overlays.remove",{id:"first"})',context),true);
 assert.equal(evaluate('selectedCard'),null);assert.equal(evaluate('selectedSceneLayer()?.id ?? null'),null);assert.equal(element('#layerSelection').hidden,true);
 vm.runInContext('undo()',context);assert.equal(evaluate('selectedSceneLayer()?.id'),'first');
 // A valid explicit selection remains unchanged across unrelated commands.
 assert.equal(vm.runInContext('runEditorCommand("overlays.add",{id:"other",patch:{text:"x",start:0,end:2}})',context),true);
 assert.equal(evaluate('selectedCard'),'first');
});
