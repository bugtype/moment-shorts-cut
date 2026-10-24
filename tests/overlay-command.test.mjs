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
import {newCard,activeSceneLayers} from '../dist/effects.mjs';
import {createAppFixture} from './fixtures/app.mjs';

function project(){const p=createDemoProject();p.speed=2;p.overlays=[{...newCard(6),id:'first',start:0,end:2},{...newCard(6),id:'second',start:1,end:4}];return p;}
const patch={text:'새 문구',detail:'설명',label:'STEP',color:'#aAbBcC',accent:'#12345678',background:'#000000',x:.4,y:.2,width:.7,size:40,stroke:2,backgroundOpacity:.5,presentation:'panel',role:'free',animation:'fade',kind:'countdown',enabled:true,start:2,end:5};
test('overlay patch targets exact ID and preserves order, other cards and all other project data',()=>{
 const p=project(),before=structuredClone(p),result=prepareCommand(p,'overlays.update',{id:'second',patch});
 assert.deepEqual(result.data,{updated:true,outputDuration:6});assert.deepEqual(result.project.overlays,[p.overlays[0],{...p.overlays[1],...patch}]);
 assert.deepEqual({...result.project,overlays:p.overlays},p);assert.deepEqual(p,before);
 for(const format of ['srt','vtt'])assert.equal(projectSubtitles(result.project,{format}),projectSubtitles(p,{format}));
 assert.deepEqual(prepareCommand(p,'overlays.update',{id:'second',patch:{}}).project,p);
 assert.deepEqual(activeSceneLayers(result.project,2.5).map(c=>c.id),['second']);
});
test('explicit card timing uses output seconds, while content-only updates preserve existing out-of-output timings',()=>{
 const p=project();p.overlays[0].end=20;
 assert.equal(prepareCommand(p,'overlays.update',{id:'first',patch:{text:'수정'}}).project.overlays[0].end,20);
 assert.throws(()=>prepareCommand(p,'overlays.update',{id:'first',patch:{start:.5}}),/표시 시간/);
 assert.equal(prepareCommand(p,'overlays.update',{id:'first',patch:{end:6}}).project.overlays[0].end,6);
 const long={...p,duration:86400,clips:[{start:0,end:86400},{start:0,end:86400}],speed:.25};
 assert.equal(prepareCommand(long,'overlays.update',{id:'first',patch:{start:90000,end:100000}}).project.overlays[0].end,100000);
});
test('overlay validation rejects unknown IDs, changes to identity and malformed fields atomically',()=>{
 const p=project(),before=structuredClone(p);
 assert.throws(()=>prepareCommand(p,'overlays.update',{id:'missing',patch:{text:'x'}}),e=>e.code==='NOT_FOUND');
 const opaque=project();opaque.overlays[0].id='   ';
 assert.equal(prepareCommand(opaque,'overlays.update',{id:'   ',patch:{text:'opaque ID'}}).project.overlays[0].text,'opaque ID');
 for(const id of [''])assert.throws(()=>prepareCommand(p,'overlays.update',{id,patch:{}}),e=>e.code==='INVALID_ARGUMENT');
 for(const invalid of [{id:'new'},{start:-1},{start:4,end:4},{end:7},{start:NaN},{text:'a'.repeat(2001)},{color:'red'},{x:1.1},{width:-.1},{size:9},{stroke:21},{backgroundOpacity:1.1},{presentation:'unknown'},{role:'unknown'},{animation:'spin'},{kind:'quiz'},{enabled:1}]){
  assert.throws(()=>prepareCommand(p,'overlays.update',{id:'second',patch:{text:'partial',...invalid}}),e=>e.code==='INVALID_ARGUMENT');assert.deepEqual(p,before);
 }
});
test('overlay service commits one targeted update and failed edits preserve previous content',async()=>{
 let p=project(),commits=0;const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 assert.equal((await service.execute('overlays.update',{id:'first',patch:{text:'교정'}})).ok,true);assert.equal(commits,1);const before=structuredClone(p);
 assert.equal((await service.execute('overlays.update',{id:'first',patch:{text:'손실',end:99}})).ok,false);assert.deepEqual(p,before);assert.equal(commits,1);
});
test('app card update keeps trim draft and supports undo plus busy protection',async()=>{
 const {context,evaluate,element}=await createAppFixture();context.initialCards=project().overlays;
 vm.runInContext('state.overlays=structuredClone(initialCards);history=[];future=[];renderTimeline();',context);const before=evaluate('state');
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';element('#trimStart').focus();
 assert.equal(vm.runInContext('runEditorCommand("overlays.update",{id:"first",patch:{text:"교정"}})',context),true);
 assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);assert.equal(evaluate('history.length'),1);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
 vm.runInContext('exporting=true',context);assert.equal(vm.runInContext('runEditorCommand("overlays.update",{id:"first",patch:{text:"교정"}})',context),false);assert.deepEqual(evaluate('state'),before);
});
test('CLI reads a real card ID, previews and saves only that card; failed output remains intact',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-overlay-'));
 try{
  const input=path.join(dir,'project.json'),args=path.join(dir,'patch.json'),output=path.join(dir,'updated.json'),original=JSON.stringify(createProjectDocument(project()));await fs.writeFile(input,original);
  const document=JSON.parse(await fs.readFile(input,'utf8'));await fs.writeFile(args,JSON.stringify({id:document.project.overlays[1].id,patch:{text:'파일에서 수정',start:2,end:4}}));
  const run=options=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','overlays.update','--project',input,'--args-file',args,...options],{encoding:'utf8'});
  let result=run(['--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).preview.project.overlays[1].text,'파일에서 수정');
  result=run(['--out',output]);assert.equal(result.status,0,result.stderr);const saved=await fs.readFile(output,'utf8');assert.equal(JSON.parse(saved).project.overlays[0].text,document.project.overlays[0].text);
  await fs.writeFile(args,JSON.stringify({id:'missing',patch:{text:'x'}}));result=run(['--out',output,'--overwrite']);assert.equal(result.status,1);assert.equal(await fs.readFile(output,'utf8'),saved);assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
