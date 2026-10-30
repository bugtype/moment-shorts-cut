import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {createTypographyRenderer} from '../dist/typography.mjs';
import {createCanvasTrace} from './fixtures/canvas-trace.mjs';

const patch={speakerLabels:['민수','嘉宾'],speakerColors:['#aAbBcC','#12345678'],style:'minimal',captionSize:44,captionX:.45,captionY:.8,captionColor:'#aAbBcC',captionAccent:'#12345678',captionStroke:2,captionItalic:false,captionAnimation:'fade'};
test('caption style patch changes only supplied fields and leaves plain subtitles and timing unchanged',()=>{
 const p=createDemoProject(),before=structuredClone(p),result=prepareCommand(p,'captions.style.update',{patch});
 assert.deepEqual(result.data,{updated:true,outputDuration:12});
 assert.deepEqual(result.project,{...before,...patch});assert.deepEqual(p,before);
 for(const format of ['srt','vtt'])assert.equal(projectSubtitles(result.project,{format}),projectSubtitles(p,{format}));
 const styleOnly=prepareCommand(p,'captions.style.update',{patch:{style:'minimal'}}).project;
 assert.equal(styleOnly.captionItalic,p.captionItalic);assert.equal(styleOnly.captionStroke,p.captionStroke);
 assert.deepEqual(prepareCommand(p,'captions.style.update',{patch:{}}).project,p);
});
test('caption style schema accepts existing boundaries and rejects unsupported fields or invalid values atomically',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 for(const values of [
  {captionSize:10,captionX:0,captionY:0,captionStroke:0,captionItalic:false,captionColor:'#00000000'},
  {captionSize:120,captionX:1,captionY:1,captionStroke:20,captionItalic:true,captionColor:'#FFFFFF'},
 ])assert.doesNotThrow(()=>prepareCommand(p,'captions.style.update',{patch:values}));
 for(const style of ['impact','accent','highlight','minimal'])assert.doesNotThrow(()=>prepareCommand(p,'captions.style.update',{patch:{style}}));
 for(const captionAnimation of ['none','fade','slide','pop'])assert.doesNotThrow(()=>prepareCommand(p,'captions.style.update',{patch:{captionAnimation}}));
 for(const invalid of [
  {captionSize:9},{captionSize:121},{captionSize:NaN},{captionX:-.1},{captionY:1.1},{captionStroke:21},
  {captionItalic:1},{captionAnimation:'spin'},{style:'unknown'},{captionColor:'red'},{captionAccent:'#fff'},
  {captionColor:'#12345g'},{captionColor:'#1234567'},{captions:[]},{speed:2},{globalKeywords:'new'},
 ]){
  assert.throws(()=>prepareCommand(p,'captions.style.update',{patch:{captionSize:44,...invalid}}),e=>e.code==='INVALID_ARGUMENT');
  assert.deepEqual(p,before);
 }
 assert.throws(()=>prepareCommand(p,'captions.style.update',{}),e=>e.code==='INVALID_ARGUMENT');
 assert.equal(commandDefinition('captions.style.update').mutates,true);
});
test('style command service uses one atomic commit and failed validation cannot overwrite prior edits',async()=>{
 let project=createDemoProject(),commits=0;
 const service=createEditorService({getProject:()=>project,commitProject:next=>{project=next;commits++;}});
 const result=await service.execute('captions.style.update',{patch});assert.equal(result.ok,true);assert.equal(commits,1);
 const saved=structuredClone(project);
 assert.equal((await service.execute('captions.style.update',{patch:{captionSize:50,captionColor:'invalid'}})).ok,false);
 assert.equal(commits,1);assert.deepEqual(project,saved);
});
test('style command in app retains trim draft and participates in undo/redo without changing captions',async()=>{
 const {context,evaluate,element}=await createAppFixture();
 vm.runInContext('history=[];future=[];selected=0;renderTimeline();',context);
 element('#trimStart').value='1.50';element('#trimEnd').value='3.50';element('#trimStart').focus();
 const before=evaluate('state');
 assert.equal(vm.runInContext('runEditorCommand("captions.style.update",{patch:{captionSize:44,captionY:.8}})',context),true);
 assert.equal(evaluate('state.captionSize'),44);assert.deepEqual(evaluate('state.captions'),before.captions);
 assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.50','3.50']);assert.equal(evaluate('history.length'),1);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
 vm.runInContext('undo(true)',context);assert.equal(evaluate('state.captionSize'),44);
 vm.runInContext('exporting=true',context);assert.equal(vm.runInContext('runEditorCommand("captions.style.update",{patch:{captionSize:55}})',context),false);assert.equal(evaluate('state.captionSize'),44);
});
test('CLI caption style dry-run and saved documents preserve source; invalid patch preserves destination',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-style-'));
 try{
  const input=path.join(dir,'project.json'),output=path.join(dir,'styled.json');
  const original=JSON.stringify(createProjectDocument(createDemoProject()));await fs.writeFile(input,original);
  const run=args=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','captions.style.update','--project',input,...args],{encoding:'utf8'});
  const args=['--json',JSON.stringify({patch})];
  let result=run([...args,'--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).preview.project.captionSize,44);
  result=run([...args,'--out',output]);assert.equal(result.status,0,result.stderr);const saved=await fs.readFile(output,'utf8');assert.equal(JSON.parse(saved).project.captionColor,'#aAbBcC');
  result=run(['--json','{"patch":{"captionColor":"red"}}','--out',output,'--overwrite']);assert.equal(result.status,1);assert.equal(await fs.readFile(output,'utf8'),saved);assert.equal(await fs.readFile(input,'utf8'),original);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

// Actual mounted callbacks and canvas commands, not native layout or pixel checks.
test('caption presets apply their displayed italic defaults and retain custom highlight styling',async()=>{
 for(const style of ['impact','accent','highlight','minimal'])for(const route of ['panel',...(style==='accent'?[]:['inspector'])]) {
  const f=await createAppFixture(),root=f.element('#panelContent'),queryAll=root.querySelectorAll;
  const buttons=['impact','accent','highlight','minimal'].map(value=>{const button=f.element('preset-'+value);button.dataset.captionPreset=value;return button;});
  root.querySelectorAll=selector=>selector==='[data-caption-preset]'?buttons:queryAll(selector);
  vm.runInContext("textLayer='caption';switchPanel('text');history=[];future=[];globalThis.presetSaves=0;scheduleSave=()=>presetSaves++;",f.context);
  assert.ok(root.innerHTML.includes(`data-caption-preset="${style}"`));
  const before=f.evaluate('state');
  if(route==='panel')buttons.find(button=>button.dataset.captionPreset===style).onclick();
  else f.documentEvents.get('click')({target:{closest:selector=>selector==='[data-style]'?{dataset:{style}}:null}});
  const after=f.evaluate('state'),italic=style==='impact'||style==='accent';
  assert.deepEqual(after,{...before,style,captionItalic:italic,captionStroke:style==='minimal'?2:3},`${route} ${style}`);
  assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('presetSaves'),1);
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
  vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state'),after);
  if(style==='highlight') {
   for(const customItalic of [false,true]) {
    const project=prepareCommand(after,'captions.style.update',{patch:{captionItalic:customItalic}}).project;
    project.design.title.enabled=false;project.design.credit.enabled=false;
    const trace=createCanvasTrace(),renderer=createTypographyRenderer(trace.makeCanvas);
    renderer.draw(trace.context,540,960,project,1,1,{start:0,end:2,text:'한글 Example'});
    const fonts=trace.events.filter(event=>event[1]==='font');assert.ok(fonts.length);
    assert.ok(fonts.every(event=>event[2].startsWith('italic ')===customItalic));
   }
  }
 }
});
