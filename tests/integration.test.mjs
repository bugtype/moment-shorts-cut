import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createDemoProject, createProjectDocument, readProjectDocument, validateProject, MAX_CLIPS } from '../dist/core/project.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { CommandError } from '../dist/core/validation.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';
import { createMcpToolAdapter } from '../dist/integration/mcp-adapter.mjs';
import { TEMPLATES } from '../dist/template-catalog.mjs';

function fixture(options={}){
 let state=createDemoProject(),commits=0;
 const service=createEditorService({getProject:()=>state,commitProject:p=>{state=p;commits++;},...options});
 return {service,get state(){return state;},get commits(){return commits;}};
}
test('clip limit is shared by command discovery, mutations and project import',async()=>{
 assert.equal(MAX_CLIPS,1000);
 const f=fixture(),clips=Array.from({length:MAX_CLIPS},()=>({start:0,end:1}));
 assert.equal(f.service.describe().find(c=>c.name==='timeline.replace').inputSchema.properties.clips.maxItems,MAX_CLIPS);
 assert.equal((await f.service.execute('timeline.replace',{clips})).ok,true);
 assert.equal((await f.service.execute('project.update',{patch:{zoom:1.5}})).ok,true);
 const before=structuredClone(f.state),commits=f.commits,document=createProjectDocument(before);
 assert.deepEqual(readProjectDocument(JSON.parse(JSON.stringify(document))),before);
 clips.push({start:0,end:1});document.project.clips=clips;
 for(const [command,args] of [['timeline.replace',{clips}],['project.import',{document}]]){
  const result=await f.service.execute(command,args);assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');
  assert.deepEqual(f.state,before);assert.equal(f.commits,commits);
 }
 assert.equal((await f.service.execute('timeline.replace',{clips:clips.slice(0,MAX_CLIPS-1)})).ok,true);
 assert.equal(f.state.clips.length,MAX_CLIPS-1);
});
test('all templates round-trip; speed and clip edits retime output text exactly once',async()=>{
 for(const template of TEMPLATES){
  const f=fixture();assert.equal((await f.service.execute('template.apply',{templateId:template.id,withContent:true})).ok,true);
  const saved=createProjectDocument(f.state);assert.deepEqual(readProjectDocument(saved),f.state);
  const end=f.state.overlays[0]?.end;
  assert.equal((await f.service.execute('project.update',{patch:{speed:2}})).ok,true);
  if(end)assert.equal(f.state.overlays[0].end,end/2);
  assert.equal((await f.service.execute('timeline.replace',{clips:[{start:2,end:8}]})).ok,true);
  if(end)assert.equal(f.state.overlays[0].end,end/4);
 }
});
test('invalid input and unknown commands never mutate a project',async()=>{
 const f=fixture(),before=structuredClone(f.state);
 for(const [command,args] of [
  ['project.update',{patch:{speed:0}}],['project.update',{patch:{speed:NaN}}],
  ['project.update',{patch:{surprise:true}}],['project.update',{patch:{name:'  '}}],
  ['timeline.replace',{clips:[{start:5,end:2}]}],['timeline.replace',{clips:[{start:0,end:13}]}],
  ['title.update',{patch:{lines:['one']}}],['title.update',{patch:{end:'later'}}],
  ['title.update',{patch:{colors:['red','blue']}}],
  ['captions.replace',{captions:[{start:0,end:13,text:'outside'}]}],
  ['template.apply',{templateId:'missing'}],['shell.execute',{cmd:'whoami'}],
  ['project.update',JSON.parse('{"patch":{"__proto__":{"polluted":true}}}')],
 ]){const result=await f.service.execute(command,args);assert.equal(result.ok,false,command);assert.ok(result.error.code);assert.deepEqual(f.state,before);}
 assert.equal(f.commits,0);assert.equal({}.polluted,undefined);
});
test('JSON import checks versions, structure and preserves the existing project on failure',async()=>{
 const f=fixture();
 for(const mutate of [d=>d.formatVersion=99,d=>d.project.schemaVersion=99,d=>d.project.design.title.lines=null,d=>d.project.clips=[],d=>d.project.captionY=9]){
  const document=createProjectDocument(f.state);mutate(document);const result=await f.service.execute('project.import',{document});assert.equal(result.ok,false);
 }
 const document=createProjectDocument(f.state);document.project.name='CLI에서 편집한 작업';
 assert.equal((await f.service.execute('project.import',{document})).ok,true);assert.equal(f.state.name,'CLI에서 편집한 작업');
  document.project.style='highlight';assert.equal((await f.service.execute('project.import',{document})).ok,true);
});
test('read snapshots and caller arguments are isolated; concurrent edits are serialized',async()=>{
 const f=fixture();const args={patch:{name:'첫 변경'}},first=f.service.execute('project.update',args);args.patch.name='뒤늦은 변경';
 const second=f.service.execute('title.update',{patch:{lines:['상단 제목','두 번째 줄']}});
 assert.equal((await first).ok,true);assert.equal((await second).ok,true);assert.equal(f.state.name,'첫 변경');
 const read=await f.service.execute('project.get');read.data.project.name='외부 변조';assert.equal(f.state.name,'첫 변경');
 assert.deepEqual(f.state.design.title.lines,['상단 제목','두 번째 줄']);
});
test('SRT uses clip repetition and output speed; render plan does not claim an encoded video',async()=>{
 const f=fixture();await f.service.execute('timeline.replace',{clips:[{start:2,end:4},{start:2,end:4}]});
 await f.service.execute('project.update',{patch:{speed:2}});
 await f.service.execute('captions.replace',{captions:[{start:2,end:4,text:'원본'}, {start:1,end:3,text:'내레이션',basis:'timeline'}]});
 const srt=await f.service.execute('captions.export');
 assert.match(srt.data.text,/00:00:00,000 --> 00:00:01,000\n원본/);
 assert.match(srt.data.text,/00:00:01,000 --> 00:00:02,000\n원본/);
 assert.match(srt.data.text,/00:00:00,500 --> 00:00:01,500\n내레이션/);
 const plan=await f.service.execute('render.plan',{quality:720,format:'webm'});
 assert.deepEqual(plan.data.output,{width:720,height:1280,fps:30,format:'webm',duration:2});assert.equal(plan.data.rendered,false);
});
test('ambiguous SRT fails through service and MCP while project JSON retains the authored text',async()=>{
 const f=fixture();
 const captions=[{start:0,end:1,text:'valid'},{start:1,end:3,text:'first\n\nsecond'}];
 assert.equal((await f.service.execute('captions.replace',{captions})).ok,true);
 const before=structuredClone(f.state),commits=f.commits;
 const result=await f.service.execute('captions.export');
 assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');assert.match(result.error.message,/2번째 자막.*빈 줄/);
 const adapter=createMcpToolAdapter({resolveService:async()=>f.service});
 const response=await adapter.callTool('moment_captions_export',{projectId:'fixture'});
 assert.equal(response.isError,true);assert.deepEqual(response.structuredContent,result);
 assert.deepEqual(readProjectDocument((await f.service.execute('project.get')).data),before);
 assert.deepEqual(f.state,before);assert.equal(f.commits,commits);
 assert.equal((await f.service.execute('captions.replace',{captions:[{start:1,end:3,text:'first\nsecond'}]})).ok,true);
 assert.equal((await f.service.execute('captions.export')).ok,true,'correction recovers without resetting the service');
});
test('rounded SRT timing errors preserve service/MCP state and recover after correcting speed',async()=>{
 const f=fixture();
 await f.service.execute('captions.replace',{captions:[{start:1.999,end:4,text:'trimmed speech'}]});
 await f.service.execute('timeline.replace',{clips:[{start:0,end:2}]});
 await f.service.execute('project.update',{patch:{speed:4}});
 const before=structuredClone(f.state),commits=f.commits;
 const result=await f.service.execute('captions.export');
 assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');assert.match(result.error.message,/1번째 자막.*밀리초/);
 const adapter=createMcpToolAdapter({resolveService:async()=>f.service});
 assert.deepEqual((await adapter.callTool('moment_captions_export',{projectId:'fixture'})).structuredContent,result);
 assert.deepEqual(readProjectDocument((await f.service.execute('project.get')).data),before);
 assert.deepEqual(f.state,before);assert.equal(f.commits,commits);
 await f.service.execute('project.update',{patch:{speed:1}});
 assert.equal((await f.service.execute('captions.export')).ok,true);
});
test('derived output limits preserve editing, JSON, render plans and MCP error details',async()=>{
 const f=fixture();
 await f.service.execute('captions.replace',{captions:Array.from({length:101},()=>({start:0,end:1,text:'caption'}))});
 await f.service.execute('timeline.replace',{clips:Array.from({length:100},()=>({start:0,end:1}))});
 const before=structuredClone(f.state),commits=f.commits;
 const result=await f.service.execute('captions.export');
 assert.equal(result.ok,false);assert.equal(result.error.code,'CAPTION_OUTPUT_LIMIT');assert.equal(result.data,undefined);
 const adapter=createMcpToolAdapter({resolveService:async()=>f.service});
 assert.deepEqual((await adapter.callTool('moment_captions_export',{projectId:'fixture'})).structuredContent,result);
 assert.deepEqual(readProjectDocument((await f.service.execute('project.get')).data),before);
 assert.equal((await f.service.execute('render.plan',{quality:720,format:'webm'})).ok,true);
 assert.deepEqual(f.state,before);assert.equal(f.commits,commits);
 assert.equal((await f.service.execute('project.import',{document:createProjectDocument(before)})).ok,true);
 assert.equal((await f.service.execute('project.update',{patch:{name:'still editable'}})).ok,true);
 assert.equal((await f.service.execute('timeline.replace',{clips:[{start:0,end:1}]})).ok,true);
 assert.equal((await f.service.execute('captions.export')).ok,true);
});
test('unconfigured media jobs fail explicitly; provider submission/status/cancellation share the contract',async()=>{
 const empty=fixture();assert.equal(empty.service.capabilities().mediaJobs,false);
 assert.equal(empty.service.describe().some(c=>c.name.startsWith('jobs.')),false);
 assert.equal((await empty.service.execute('jobs.submit',{operation:'video.render'})).error.code,'NOT_CONFIGURED');
 const seen=[];const f=fixture({jobs:{submit:async value=>{seen.push(value);return {id:'job-1',status:'queued'};},get:async id=>({id,status:'running',progress:.5}),cancel:async id=>({id,status:'cancelled'})}});
 const submit=await f.service.execute('jobs.submit',{operation:'video.render',format:'mp4'});assert.equal(submit.data.status,'queued');assert.equal(seen[0].document.format,'moment-project');
 assert.equal((await f.service.execute('jobs.get',{jobId:'job-1'})).data.status,'running');
 assert.equal((await f.service.execute('jobs.cancel',{jobId:'job-1'})).data.status,'cancelled');
 assert.equal(f.commits,0);assert.equal((await f.service.execute('jobs.submit',{operation:'media.import'})).ok,false);
});
test('MCP resolves each project with caller context and maps successes, input errors and denied access',async()=>{
 const f=fixture(),seen=[];
 const adapter=createMcpToolAdapter({resolveService:async (id,context)=>{seen.push({id,context});if(id!=='project-1'||context?.user!=='owner')throw new CommandError('FORBIDDEN','접근 권한이 없습니다.');return f.service;}});
 const list=adapter.listTools();assert.equal(list.resultType,'complete');
 assert.ok(list.tools.every(t=>t.inputSchema.required.includes('projectId')));
 assert.equal(list.tools.find(t=>t.name==='moment_project_get').annotations.readOnlyHint,true);
 const args={projectId:'project-1',patch:{name:'MCP에서 변경'}};
 const denied=await adapter.callTool('moment_project_update',args,{user:'other'});assert.equal(denied.isError,true);assert.equal(f.commits,0);
 const success=await adapter.callTool('moment_project_update',args,{user:'owner'});assert.equal(success.isError,false);assert.equal(f.state.name,'MCP에서 변경');
 const invalid=await adapter.callTool('moment_project_update',{projectId:'project-1',patch:{speed:-1}},{user:'owner'});assert.equal(invalid.isError,true);assert.equal(invalid.structuredContent.error.code,'INVALID_ARGUMENT');
 await assert.rejects(adapter.callTool('unknown',{},{}),e=>e.code==='UNKNOWN_TOOL');assert.equal(seen.length,2);
});
test('CLI writes real documents/SRT, refuses accidental overwrite, and leaves failed input untouched',async()=>{
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),directory=await fs.mkdtemp(path.join(root,'.moment-test-'));
 const cli=path.join(root,'cli/moment.mjs');
 const run=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
 try{
  const original=path.join(directory,'project.json'),edited=path.join(directory,'edited.json'),captions=path.join(directory,'captions.srt');
  assert.equal(run('init','--out',original).status,0);
  assert.equal(run('init','--out',original).status,1);
  const result=run('exec','template.apply','--project',original,'--json','{"templateId":"explainer","withContent":true}','--out',edited);assert.equal(result.status,0,result.stderr);
  const document=JSON.parse(await fs.readFile(edited,'utf8'));assert.equal(readProjectDocument(document).templateId,'explainer');
  assert.equal(run('exec','captions.export','--project',edited,'--out',captions).status,0);assert.match(await fs.readFile(captions,'utf8'),/00:00:00,000/);
  const before=await fs.readFile(edited,'utf8');
  assert.equal(run('exec','project.update','--project',edited,'--json','{"patch":{"speed":0}}','--out',edited,'--overwrite').status,1);assert.equal(await fs.readFile(edited,'utf8'),before);
  const dry=run('exec','project.update','--project',edited,'--json','{"patch":{"name":"시험"}}','--dry-run');assert.equal(dry.status,0);assert.equal(JSON.parse(dry.stdout).preview.project.name,'시험');assert.equal(await fs.readFile(edited,'utf8'),before);
  assert.equal(run('exec','project.update','--project',edited,'--json','{"patch":{"name":"저장"}}','--out',edited,'--overwrite').status,0);assert.equal(JSON.parse(await fs.readFile(edited,'utf8')).project.name,'저장');
  const invalid=createProjectDocument(createDemoProject());invalid.project.captions=[{start:0,end:2,text:'first\n\nsecond'}];
  const invalidFile=path.join(directory,'invalid-srt-project.json'),missingOutput=path.join(directory,'not-created.srt');
  await fs.writeFile(invalidFile,JSON.stringify(invalid));
  const savedSrt=await fs.readFile(captions,'utf8'),savedProject=await fs.readFile(invalidFile,'utf8');
  for(const output of [captions,missingOutput]){
   const failed=run('exec','captions.export','--project',invalidFile,'--out',output,'--overwrite');
   assert.equal(failed.status,1);assert.equal(JSON.parse(failed.stderr).error.code,'INVALID_ARGUMENT');
  }
  assert.equal(await fs.readFile(captions,'utf8'),savedSrt);
  assert.equal(await fs.readFile(invalidFile,'utf8'),savedProject);
  await assert.rejects(fs.stat(missingOutput),error=>error.code==='ENOENT');
  invalid.project.speed=4;invalid.project.clips=[{start:0,end:2}];invalid.project.captions=[{start:1.999,end:4,text:'trimmed speech'}];
  const preciseProject=JSON.stringify(invalid);await fs.writeFile(invalidFile,preciseProject);
  for(const output of [captions,missingOutput]){
   const failed=run('exec','captions.export','--project',invalidFile,'--out',output,'--overwrite');
   assert.equal(failed.status,1);const error=JSON.parse(failed.stderr).error;
   assert.equal(error.code,'INVALID_ARGUMENT');assert.match(error.message,/밀리초/);
  }
  assert.equal(await fs.readFile(captions,'utf8'),savedSrt);
  assert.equal(await fs.readFile(invalidFile,'utf8'),preciseProject);
  await assert.rejects(fs.stat(missingOutput),error=>error.code==='ENOENT');
  for(const captionsInput of [
   Array.from({length:101},()=>({start:0,end:1,text:'caption'})),
   Array.from({length:3},()=>({start:0,end:1,text:'&'.repeat(1600)})),
  ]){
   invalid.project.speed=1;invalid.project.clips=Array.from({length:100},()=>({start:0,end:1}));invalid.project.captions=captionsInput;
   const overBudget=JSON.stringify(invalid);await fs.writeFile(invalidFile,overBudget);
   for(const output of [captions,missingOutput]){
    const failed=run('exec','captions.export','--project',invalidFile,'--out',output,'--overwrite');
    assert.equal(failed.status,1);assert.equal(JSON.parse(failed.stderr).error.code,'CAPTION_OUTPUT_LIMIT');
   }
   assert.equal(await fs.readFile(captions,'utf8'),savedSrt);
   assert.equal(await fs.readFile(invalidFile,'utf8'),overBudget);
   await assert.rejects(fs.stat(missingOutput),error=>error.code==='ENOENT');
  }
  invalid.project.clips=[{start:0,end:1}];await fs.writeFile(invalidFile,JSON.stringify(invalid));
  assert.equal(run('exec','captions.export','--project',invalidFile,'--out',captions,'--overwrite').status,0);
  const output=await fs.readFile(captions);
  assert.ok(output.byteLength<=2*1024*1024);assert.notEqual(output.toString('utf8')[0],'\ufeff');
  assert.match(output.toString('utf8'),/&amp;/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
