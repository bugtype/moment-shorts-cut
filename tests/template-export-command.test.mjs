import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {newCard} from '../dist/effects.mjs';
import {saveCustomTemplate} from '../dist/template-catalog.mjs';
import {readTemplateDocument,templateDocumentSchema,MAX_TEMPLATE_FILE_BYTES} from '../dist/template-library.mjs';
const args={id:'channel-style',name:' Channel style '};
const capture=p=>prepareCommand(p,'template.export',args);
function project(){const p=createDemoProject();p.speed=2;p.clips=[{start:0,end:6},{start:0,end:6}];p.design.title.start=1;p.design.title.end=5;p.design.credit.start=2;p.design.credit.end=null;p.design.credit.text='Channel';p.overlays=[{...newCard(6),id:'late',start:4,end:9},{...newCard(6),id:'early',start:1,end:2},{...newCard(6),id:'outside',start:7,end:8}];return p;}

test('capture returns a detached deterministic portable document with exact caller ID and trimmed name',()=>{
 const p=project(),before=structuredClone(p),a=capture(p),b=capture(p);
 assert.deepEqual(a,b);assert.equal(a.project,undefined);assert.equal(a.data.format,'moment-template');assert.equal(a.data.template.id,args.id);assert.equal(a.data.template.name,'Channel style');assert.equal(a.data.template.relativeTiming,true);
 assert.deepEqual(p,before);assert.equal(readTemplateDocument(a.data).id,args.id);
 for(const key of ['captions','clips','fileName','audioName','audioOffset','duration','speed'])assert.ok(!Object.hasOwn(a.data.template.settings,key));
 a.data.template.settings.design.title.lines[0]='changed';a.data.template.cards[0].text='changed';assert.deepEqual(p,before);assert.deepEqual(capture(p),b);
 assert.equal(saveCustomTemplate('Old UI',p).name,'Old UI');assert.ok(saveCustomTemplate('Old UI',p).id.startsWith('custom-'));
});
test('capture preserves existing relative timing, range clipping and stable card start order',()=>{
 const p=project(),doc=capture(p).data,t=doc.template;
 assert.equal(t.settings.design.title.start,1/6);assert.equal(t.settings.design.title.end,5/6);assert.equal(t.settings.design.credit.start,2/6);assert.equal(t.settings.design.credit.end,null);
 assert.deepEqual(t.cards.map(c=>[c.id,c.start,c.end]),[['early',1/6,2/6],['late',4/6,1]]);
 const target=createDemoProject();target.duration=24;target.clips=[{start:0,end:24}];target.design.title.lines=['Keep','Me'];target.design.credit.text='Keep credit';target.overlays=[{...newCard(24),id:'keep'}];
 for(const withContent of [false,true]){
  const result=prepareCommand(target,'template.apply.document',{document:doc,withContent}).project;
  assert.deepEqual(result.captions,target.captions);assert.deepEqual(result.clips,target.clips);assert.equal(result.design.title.start,4);assert.equal(result.design.title.end,20);assert.equal(result.design.credit.end,null);
  assert.deepEqual(result.design.title.lines,withContent?p.design.title.lines:target.design.title.lines);assert.equal(result.design.credit.text,withContent?'Channel':'Keep credit');
  assert.deepEqual(result.overlays.map(c=>c.id),withContent?['early','late']:['keep']);
 }
});
test('valid out-of-duration text timing follows existing capture validation rather than silently claiming a complete backup',()=>{
 const p=project();p.design.credit.start=20;p.design.credit.end=null;assert.equal(capture(p).data.template.settings.design.credit.start,1);
 p.design.title.start=20;p.design.title.end=21;createProjectDocument(p);assert.throws(()=>capture(p),e=>e.code==='INVALID_ARGUMENT');
});
test('invalid arguments and builtin collisions fail without changes or batch admission',()=>{
 const p=project(),before=structuredClone(p);
 for(const value of [{},{id:'x'},{name:'x'},{id:' ',name:'x'},{id:'x',name:' '},{id:'x'.repeat(201),name:'x'},{id:'x',name:'x'.repeat(41)},{id:'reference',name:'x'},{id:'x',name:1},{id:'x',name:'x',extra:1}])assert.throws(()=>prepareCommand(p,'template.export',value),e=>e.code==='INVALID_ARGUMENT');
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[{command:'template.export',arguments:args}]}),e=>e.code==='INVALID_ARGUMENT');assert.deepEqual(p,before);
 assert.equal(prepareCommand(p,'template.export',{id:' exact id ',name:' x '}).data.template.id,' exact id ');
});
test('service capture never commits, calls providers or changes state; exported schema is isolated',async()=>{
 const p=project(),before=structuredClone(p);let commits=0;
 const service=createEditorService({getProject:()=>p,commitProject:()=>{commits++;throw new Error('unexpected commit');}});
 const result=await service.execute('template.export',args);assert.equal(result.ok,true);assert.equal(commits,0);assert.deepEqual(p,before);assert.equal(commandDefinition('template.export').mutates,false);
 const schema=templateDocumentSchema();schema.properties.template.additionalProperties=true;assert.equal(templateDocumentSchema().properties.template.additionalProperties,false);
 p.design.hiddenMedia={fileName:'private'};assert.equal((await service.execute('template.export',args)).ok,false);assert.equal(commits,0);
});
function atBudget(){const p=createDemoProject(),base=Buffer.byteLength(JSON.stringify(capture(p).data,null,2)),remaining=MAX_TEMPLATE_FILE_BYTES-base;p.globalKeywords='한'.repeat(Math.floor(remaining/3))+'a'.repeat(remaining%3);createProjectDocument(p);assert.equal(Buffer.byteLength(JSON.stringify(capture(p).data,null,2)),MAX_TEMPLATE_FILE_BYTES);return p;}
test('portable UTF-8 limit is exact and overflow rejects atomically',()=>{
 const p=atBudget(),before=structuredClone(p);assert.equal(readTemplateDocument(capture(p).data).id,args.id);assert.deepEqual(p,before);
 p.globalKeywords+='a';assert.throws(()=>capture(p),e=>e.code==='INVALID_ARGUMENT'&&e.messageKey==='errors.templateBytes');
});
test('real CLI exports exact importable boundary bytes, protects existing output, and dry-run remains unwritten',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-template-export-'));
 try{
  const input=path.join(dir,'project.json'),out=path.join(dir,'style.moment-template.json'),p=atBudget();await fs.writeFile(input,JSON.stringify(createProjectDocument(p)));
  const run=flags=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','template.export','--project',input,'--json',JSON.stringify(args),...flags],{encoding:'utf8',maxBuffer:4*1024*1024});
  let result=run(['--out',out]);assert.equal(result.status,0,result.stderr);const bytes=await fs.readFile(out);assert.equal(bytes.length,MAX_TEMPLATE_FILE_BYTES);assert.notEqual(bytes.at(-1),10);assert.equal(readTemplateDocument(JSON.parse(bytes)).name,'Channel style');
  const original=await fs.readFile(input,'utf8');assert.deepEqual(JSON.parse(original).project,p);
  result=run(['--out',out,'--dry-run']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).preview.format,'moment-template');assert.deepEqual(await fs.readFile(out),bytes);
  p.globalKeywords+='a';await fs.writeFile(input,JSON.stringify(createProjectDocument(p)));result=run(['--out',out,'--overwrite']);assert.equal(result.status,1);assert.deepEqual(await fs.readFile(out),bytes);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
