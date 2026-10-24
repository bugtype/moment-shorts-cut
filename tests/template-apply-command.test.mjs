import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createDemoProject,createProjectDocument,projectSubtitles} from '../dist/core/project.mjs';
import {TEMPLATES,applyTemplate,saveCustomTemplate} from '../dist/template-catalog.mjs';
import {createTemplateDocument} from '../dist/template-library.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {newCard} from '../dist/effects.mjs';
import {createAppFixture} from './fixtures/app.mjs';

function document(){
 const p=createDemoProject();applyTemplate(p,TEMPLATES.find(t=>t.id==='recipe'),true);
 p.design.title.start=3;p.design.title.end=6;p.design.credit.text='새 채널';p.globalKeywords='새 강조';p.speakerLabels=['새 화자','두 번째'];
 return createTemplateDocument(saveCustomTemplate('채널 스타일',p));
}
function target(){
 const p=createDemoProject();p.kind='video';p.fileName='original.mp4';p.audioName='voice.wav';p.duration=40;p.clips=[{start:10,end:30}];p.speed=2;
 p.design.title.lines=['내 제목','두 번째'];p.design.credit.text='기존 채널';p.overlays=[{...newCard(10),id:'target-card'}];return p;
}
test('template document default/false preserve authored title, credit, cards and captions but apply visual settings',()=>{
 const p=target(),doc=document(),before=structuredClone(p),input=structuredClone(doc);
 for(const args of [{document:doc},{document:doc,withContent:false}]){
  const result=prepareCommand(p,'template.apply.document',args),next=result.project;
  assert.deepEqual(result.data,{updated:true,outputDuration:10});
  assert.deepEqual(next.design.title.lines,p.design.title.lines);assert.equal(next.design.credit.text,p.design.credit.text);
  assert.deepEqual(next.overlays,p.overlays);assert.deepEqual(next.captions,p.captions);
  assert.equal(next.globalKeywords,'새 강조');assert.deepEqual(next.speakerLabels,['새 화자','두 번째']);
  assert.equal(next.design.title.start,2.5);assert.equal(next.design.title.end,5);assert.equal(next.templateId,doc.template.id);
  for(const key of ['kind','fileName','audioName','duration','clips','speed','volume','audioVolume'])assert.deepEqual(next[key],p[key]);
  for(const format of ['srt','vtt'])assert.equal(projectSubtitles(next,{format}),projectSubtitles(p,{format}));
 }
 assert.deepEqual(p,before);assert.deepEqual(doc,input);
});
test('explicit content application and legacy timing exactly reuse existing custom template semantics',()=>{
 for(const legacy of [false,true]){
  const p=target(),doc=document();if(legacy)delete doc.template.relativeTiming;
  const expected=structuredClone(p);applyTemplate(expected,doc.template,true);
  const result=prepareCommand(p,'template.apply.document',{document:doc,withContent:true});
  assert.deepEqual(result.project,expected);assert.equal(result.project.design.credit.text,'새 채널');
  assert.deepEqual(result.project.captions,p.captions);assert.notDeepEqual(result.project.overlays,p.overlays);
  assert.equal(result.project.overlays[1].start,doc.template.cards[1].start*10);
 }
});
test('invalid template documents never commit or replace an existing project',async()=>{
 let p=target(),commits=0;const service=createEditorService({getProject:()=>p,commitProject:next=>{p=next;commits++;}});
 assert.equal((await service.execute('template.apply.document',{document:document()})).ok,true);assert.equal(commits,1);const before=structuredClone(p);
 for(const mutate of [d=>{d.formatVersion=2;},d=>{d.template.settings.captionSize=0;},d=>{d.template.settings.design.hiddenMedia='secret';},d=>{d.template.flow=Array.from({length:700},()=> '가'.repeat(200));}]){
  const doc=document();mutate(doc);const result=await service.execute('template.apply.document',{document:doc});assert.equal(result.ok,false);assert.equal(commits,1);assert.deepEqual(p,before);
 }
 for(const args of [{},{document:document(),withContent:'true'},{document:document(),extra:true}])assert.equal((await service.execute('template.apply.document',args)).ok,false);
 assert.equal(commits,1);
});
test('browser command applies portable template in one undo step and respects busy guard',async()=>{
 const {context,evaluate}=await createAppFixture();context.portable=document();
 vm.runInContext('history=[];future=[];',context);const before=evaluate('state');
 assert.equal(vm.runInContext('runEditorCommand("template.apply.document",{document:portable})',context),true);assert.equal(evaluate('state.templateId'),context.portable.template.id);assert.equal(evaluate('history.length'),1);
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
 vm.runInContext('exporting=true',context);assert.equal(vm.runInContext('runEditorCommand("template.apply.document",{document:portable})',context),false);assert.deepEqual(evaluate('state'),before);
});
test('exported template file can become CLI args and apply without modifying source files',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-template-apply-'));
 try{
  const input=path.join(dir,'project.json'),file=path.join(dir,'channel.moment-template.json'),args=path.join(dir,'apply.json'),output=path.join(dir,'styled.json');
  const projectText=JSON.stringify(createProjectDocument(target())),templateText=JSON.stringify(document());await fs.writeFile(input,projectText);await fs.writeFile(file,templateText);
  await fs.writeFile(args,JSON.stringify({document:JSON.parse(await fs.readFile(file,'utf8'))}));
  const run=options=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','template.apply.document','--project',input,'--args-file',args,...options],{encoding:'utf8'});
  let result=run(['--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).preview.project.globalKeywords,'새 강조');
  result=run(['--out',output]);assert.equal(result.status,0,result.stderr);const saved=await fs.readFile(output,'utf8');assert.equal(JSON.parse(saved).project.design.title.lines[0],'내 제목');
  await fs.writeFile(args,templateText);result=run(['--out',output,'--overwrite']);assert.equal(result.status,1);assert.equal(await fs.readFile(output,'utf8'),saved);
  assert.equal(await fs.readFile(input,'utf8'),projectText);assert.equal(await fs.readFile(file,'utf8'),templateText);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
