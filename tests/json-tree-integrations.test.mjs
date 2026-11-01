import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject,createProjectDocument} from '../dist/core/project.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';
import {createMcpToolAdapter} from '../dist/integration/mcp-adapter.mjs';

function fixture(jobs) {
 let project=createDemoProject(),commits=0;
 const service=createEditorService({getProject:()=>project,commitProject:next=>{commits++;project=next;},...(jobs?{jobs}:{})});
 return {service,project:()=>project,commits:()=>commits};
}
const cue=()=>({start:0,end:1,text:'authored'});

for(const command of ['captions.replace','captions.append','project.import']) {
 test(`${command} rejects repeated object identity before committing; independent copies remain accepted`,async()=>{
  const f=fixture(),before=structuredClone(f.project()),shared=cue();
  const args=command==='project.import'
   ? {document:{...createProjectDocument(before),project:{...before,captions:[shared,shared]}}}
   : {captions:[shared,shared]};
  const result=await f.service.execute(command,args);
  assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_ARGUMENT');
  assert.equal(result.error.path,command==='project.import'?'$.document.project.captions.1':'$.captions.1');
  assert.equal(f.commits(),0);assert.deepEqual(f.project(),before);
  const copied=JSON.parse(JSON.stringify(args));
  const accepted=await f.service.execute(command,copied);
  assert.equal(accepted.ok,true);assert.equal(f.commits(),1);
  const captions=f.project().captions;
  assert.notEqual(captions.at(-1),captions.at(-2));
 });
}

for(const command of ['project.batch','project.preview'])test(`${command} reused patches reject atomically while equal independent patches remain valid`,async()=>{
 const f=fixture(),before=structuredClone(f.project()),patch={zoom:1.5};
 const args={operations:[0,1].map(()=>({command:'project.update',arguments:{patch}}))};
 const rejected=await f.service.execute(command,args);
 assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'INVALID_ARGUMENT');
 assert.equal(rejected.error.path,'$.operations.1.arguments.patch');
 assert.equal(f.commits(),0);assert.deepEqual(f.project(),before);
 const accepted=await f.service.execute(command,JSON.parse(JSON.stringify(args)));
 assert.equal(accepted.ok,true);
 if(command==='project.batch'){
  assert.equal(f.commits(),1);assert.equal(f.project().zoom,1.5);
 }else{
  assert.equal(f.commits(),0);assert.deepEqual(f.project(),before);
  assert.equal(accepted.data.wouldCommit,true);assert.equal(accepted.data.operationCount,2);
 }
});

test('MCP shared input fails before authenticated project lookup',async()=>{
 let lookups=0;const f=fixture();
 const adapter=createMcpToolAdapter({resolveService:()=>{lookups++;return f.service;}});
 const shared=cue(),args={projectId:'test',captions:[shared,shared]};
 const rejected=await adapter.callTool('moment_captions_replace',args);
 assert.equal(rejected.isError,true);assert.equal(rejected.structuredContent.error.code,'INVALID_ARGUMENT');
 assert.equal(rejected.structuredContent.error.path,'$.captions.1');
 assert.equal(lookups,0);assert.equal(f.commits(),0);
 const accepted=await adapter.callTool('moment_captions_replace',JSON.parse(JSON.stringify(args)));
 assert.equal(accepted.isError,false);assert.equal(lookups,1);assert.equal(f.commits(),1);
});

test('shared provider result is rejected without exposing provider data, then independent result succeeds',async()=>{
 const privateValue={secret:'provider-private-marker'};let result={id:'job-1',status:'succeeded',left:privateValue,right:privateValue};
 const jobs={submit:async()=>result,get:async()=>result,cancel:async()=>result};
 const f=fixture(jobs),before=structuredClone(f.project());
 for(const [command,args]of [['jobs.submit',{operation:'video.render'}],['jobs.get',{jobId:'job-1'}],['jobs.cancel',{jobId:'job-1'}]]){
  const rejected=await f.service.execute(command,args);
  assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'INVALID_PROVIDER_RESULT');
  assert.equal(Object.hasOwn(rejected,'data'),false);assert.doesNotMatch(JSON.stringify(rejected),/provider-private-marker/);
  assert.equal(f.commits(),0);assert.deepEqual(f.project(),before);
 }
 result=JSON.parse(JSON.stringify(result));
 const accepted=await f.service.execute('jobs.get',{jobId:'job-1'});
 assert.equal(accepted.ok,true);assert.notEqual(accepted.data.left,accepted.data.right);
});
