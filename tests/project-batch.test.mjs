import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareCommand,commandDefinition} from '../dist/core/commands.mjs';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {CommandError} from '../dist/core/validation.mjs';
import {createAppFixture} from './fixtures/app.mjs';
const op=(command,args)=>({command,arguments:args});
const rename=name=>op('project.update',{patch:{name}});
const bad=()=>op('overlays.add',{id:'bad',patch:{text:'Bad',start:11,end:20}});
const batch=(p,operations)=>prepareCommand(p,'project.batch',{operations});

test('batch sequential indices and card IDs see preceding results without changing the source',()=>{
 const p=createDemoProject(),before=structuredClone(p);
 const operations=[op('timeline.split',{clipIndex:0,sourceTime:6}),op('timeline.duplicate',{clipIndex:1}),op('overlays.add',{id:'a',patch:{text:'A',start:0,end:2}}),op('overlays.add',{id:'b',patch:{text:'B',start:1,end:3}}),op('overlays.move',{id:'a',toIndex:1})];
 let sequential=p;for(const operation of operations)sequential=prepareCommand(sequential,operation.command,operation.arguments).project||sequential;
 const result=batch(p,operations);assert.deepEqual(result.project,sequential);assert.deepEqual(p,before);assert.deepEqual(result.data,{updated:true,operationCount:5,outputDuration:18});
 assert.deepEqual(result.project.clips,[{start:0,end:6},{start:6,end:12},{start:6,end:12}]);assert.deepEqual(result.project.overlays.map(c=>c.id),['b','a']);
});
test('every failed position returns indexed known error and commits none of the earlier valid edits',async()=>{
 for(const index of [0,1,2]){
  let project=createDemoProject(),commits=0,checks=0;const before=structuredClone(project);
  const service=createEditorService({getProject:()=>project,commitProject:next=>{commits++;project=next;}});
  const operations=[rename('A'),rename('B')];operations.splice(index,0,bad());
  const result=await service.execute('project.batch',{operations},()=>checks++);
  assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');assert.equal(result.error.path,`arguments.operations[${index}].arguments.patch`);assert.equal(commits,0);assert.equal(checks,0);assert.deepEqual(project,before);
 }
 assert.throws(()=>batch(createDemoProject(),[op('overlays.remove',{id:'absent'})]),e=>e.code==='NOT_FOUND'&&e.path.startsWith('arguments.operations[0].'));
});
test('closed allowlist, envelope bounds and nested arguments prevent imports, reads, jobs and recursion',()=>{
 const p=createDemoProject(),schema=commandDefinition('project.batch').inputSchema;
 assert.equal(schema.properties.operations.items.properties.command.enum.length,27);
 assert.ok(schema.properties.operations.items.properties.command.enum.includes('captions.append'));
 assert.ok(schema.properties.operations.items.properties.command.enum.includes('timeline.move'));
 for(const command of ['project.import','project.get','templates.list','template.export','captions.list','captions.inspect','captions.overlaps','captions.export','render.plan','jobs.submit','jobs.cancel','project.batch','unknown'])
  assert.throws(()=>batch(p,[op(command,{})]),e=>e.code==='INVALID_ARGUMENT');
 for(const operations of [[],Array.from({length:21},()=>rename('x')),[{command:'project.update'}],[op('project.update',{patch:{unknown:true}})],[op('project.update',null)]])assert.throws(()=>batch(p,operations));
 assert.equal(batch(p,Array.from({length:20},()=>rename('x'))).data.operationCount,20);
 const copy=commandDefinition('project.batch');copy.inputSchema.properties.operations.items.properties.command.enum.push('project.import');assert.throws(()=>batch(p,[op('project.import',{document:createProjectDocument(p)})]));
});
test('all true no-ops avoid commit while redundant patches keep existing mutating semantics',async()=>{
 let project=createDemoProject(),commits=0,checks=0;
 const service=createEditorService({getProject:()=>project,commitProject:next=>{commits++;project=next;}});
 let result=await service.execute('project.batch',{operations:[op('captions.timing.shift',{basis:'source',delta:0}),op('captions.text.replace',{find:'absent',replacement:'x'})]},()=>checks++);
 assert.deepEqual(result.data,{updated:false,operationCount:2,outputDuration:12});assert.equal(commits,0);assert.equal(checks,0);
 result=await service.execute('project.batch',{operations:[op('project.update',{patch:{}})]},()=>checks++);assert.equal(result.data.updated,true);assert.equal(commits,1);assert.equal(checks,1);
});
test('one commit receives initial previous, captures caller input, and provider jobs never execute',async()=>{
 let project=createDemoProject(),commits=0,checks=0,provider=0;const initial=project;
 const service=createEditorService({getProject:()=>project,commitProject:(next,meta)=>{commits++;assert.equal(meta.previous,initial);assert.equal(meta.command,'project.batch');project=next;},jobs:{submit(){provider++;},get(){provider++;},cancel(){provider++;}}});
 const args={operations:[rename('Captured'),op('credit.update',{patch:{text:'Together'}})]};const pending=service.execute('project.batch',args,()=>checks++);args.operations[0].arguments.patch.name='Mutated';
 assert.equal((await pending).ok,true);assert.equal(project.name,'Captured');assert.equal(project.design.credit.text,'Together');assert.equal(commits,1);assert.equal(checks,1);
 assert.equal((await service.execute('project.batch',{operations:[op('jobs.submit',{operation:'video.render'})]})).ok,false);assert.equal(provider,0);
});
test('failed or rejected commit leaves provider-owned state intact and queue remains usable',async()=>{
 let project=createDemoProject(),fail=true,commits=0;const initial=structuredClone(project);
 const service=createEditorService({getProject:async()=>project,commitProject:async next=>{commits++;if(fail)throw new CommandError('CONFLICT','external change');project=next;}});
 let result=await service.execute('project.batch',{operations:[rename('A'),rename('B')]});assert.equal(result.error.code,'CONFLICT');assert.deepEqual(project,initial);
 fail=false;result=await service.execute('project.batch',{operations:[rename('C')]});assert.equal(result.ok,true);assert.equal(project.name,'C');assert.equal(commits,2);
 const before=structuredClone(project);result=await service.execute('project.batch',{operations:[rename('Rejected')]},()=>{throw new CommandError('CONFLICT','precommit');});assert.equal(result.ok,false);assert.deepEqual(project,before);assert.equal(commits,2);
});
test('actual app batch has one undo, resets structural trim conservatively and respects busy/media identity',async()=>{
 const {context,evaluate,element}=await createAppFixture();context.operations=[rename('Together'),op('credit.update',{patch:{text:'Credit'}})];
 vm.runInContext('history=[];future=[];selected=0;renderTimeline();renderInspector();',context);element('#trimStart').value='1.50';element('#trimEnd').value='3.50';const before=evaluate('state');
 assert.equal(vm.runInContext("runEditorCommand('project.batch',{operations})",context),true);assert.equal(evaluate('history.length'),1);assert.equal(evaluate('state.name'),'Together');assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['0.0','12.0']);
 const after=evaluate('state');vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),after);
 vm.runInContext('exporting=true',context);const blocked=evaluate('({state,history,current})');assert.equal(vm.runInContext("runEditorCommand('project.batch',{operations})",context),false);assert.deepEqual(evaluate('({state,history,current})'),blocked);
});
test('real CLI dry-run/save batches atomically and a failed operation never overwrites the output',async()=>{
 const dir=await fs.mkdtemp(path.join(tmpdir(),'moment-batch-'));try{
 const input=path.join(dir,'in.json'),out=path.join(dir,'out.json');await fs.writeFile(input,JSON.stringify(createProjectDocument(createDemoProject())));
 const run=(operations,flags)=>spawnSync(process.execPath,[fileURLToPath(new URL('../cli/moment.mjs',import.meta.url)),'exec','project.batch','--project',input,'--json',JSON.stringify({operations}),...flags],{encoding:'utf8'});
 let r=run([rename('Dry'),rename('Final')],['--dry-run']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).preview.project.name,'Final');
 r=run([rename('Saved')],['--out',out]);assert.equal(r.status,0,r.stderr);const saved=await fs.readFile(out,'utf8');r=run([rename('Partial'),bad()],['--out',out,'--overwrite']);assert.equal(r.status,1);assert.equal(await fs.readFile(out,'utf8'),saved);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
