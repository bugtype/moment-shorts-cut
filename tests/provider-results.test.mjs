import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject} from '../dist/core/project.mjs';
import {CommandError} from '../dist/core/validation.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';

const commands=[['jobs.submit',{operation:'video.render'}],['jobs.get',{jobId:'job-1'}],['jobs.cancel',{jobId:'job-1'}]];
function fixture(){
  const state=createDemoProject(),calls=[];let commits=0,respond=()=>({id:'job-1',status:'queued'});
  const jobs=Object.fromEntries(['submit','get','cancel'].map(method=>[method,arg=>{calls.push({method,arg});return respond(arg);} ]));
  const service=createEditorService({getProject:()=>state,commitProject:()=>{commits++;},jobs});
  return {service,state,calls,set respond(value){respond=value;},get commits(){return commits;}};
}

test('malformed provider records are output errors, never successful or blamed on caller input',async()=>{
  const f=fixture(),before=structuredClone(f.state),cycle={id:'job-1',status:'queued'};cycle.self=cycle;
  const malformed=[
    undefined,null,[],Object.assign([],{id:'job-1',status:'queued'}),'job-1',
    {},{id:'job-1'},{status:'queued'},{id:4,status:'queued'},
    {id:'',status:'queued'},{id:' \t\n',status:'queued'},
    {id:'x'.repeat(201),status:'queued'},{id:'😀'.repeat(100)+'x',status:'queued'},
    {id:'job-1',status:'unknown'},
    ...[NaN,Infinity,undefined,1n,new Date(),()=>{},Array(1)].map(value=>({id:'job-1',status:'running',internalDetail:value})),
    cycle,
  ];
  for(const [command,args] of commands){
    for(const data of malformed){
      const count=f.calls.length;f.respond=()=>data;
      const result=await f.service.execute(command,args);
      assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_PROVIDER_RESULT');
      assert.equal(result.error.path,undefined);assert.equal(result.data,undefined);
      assert.doesNotMatch(JSON.stringify(result),/internalDetail|self|BigInt/);
      assert.equal(f.calls.length,count+1,'a malformed response is never retried');
      assert.deepEqual(f.state,before);assert.equal(f.commits,0);
    }
    f.respond=()=>({id:'job-1',status:'running'});
    assert.equal((await f.service.execute(command,args)).ok,true,'queue recovers after invalid output');
  }
});

test('valid provider extensions and boundary IDs remain usable and isolated',async()=>{
  const f=fixture();
  for(const id of ['x','x'.repeat(200),'😀'.repeat(100),' padded id ']){
    for(const status of ['queued','running','succeeded','failed','cancelled']){
      const record={id,status,progress:.5,artifacts:[{name:'synthetic result'}],error:null};
      f.respond=()=>record;
      const result=await f.service.execute('jobs.submit',{operation:'video.render'});
      assert.equal(result.ok,true);assert.deepEqual(result.data,record);
      result.data.artifacts[0].name='caller change';assert.equal(record.artifacts[0].name,'synthetic result');
      const read=await f.service.execute('jobs.get',{jobId:id});assert.equal(read.ok,true);
      assert.equal(f.calls.at(-1).arg,id,'IDs are not silently trimmed');
      const cancelled=await f.service.execute('jobs.cancel',{jobId:id});assert.equal(cancelled.ok,true);
      assert.equal(cancelled.data.status,status,'the service does not invent cancellation completion');
    }
  }
  assert.equal(f.commits,0);
});

test('invalid caller input does not invoke providers and provider throws retain their error contract',async()=>{
  const f=fixture();
  for(const [command,args] of [
    ['jobs.submit',{operation:'missing'}],['jobs.submit',{operation:'media.import'}],
    ['jobs.get',{jobId:' '}],['jobs.cancel',{jobId:'x'.repeat(201)}],
  ]){
    assert.equal((await f.service.execute(command,args)).error.code,'INVALID_ARGUMENT');
  }
  assert.equal(f.calls.length,0);
  for(const [command,args] of commands){
    for(const respond of [()=>{throw new Error('private provider detail');},()=>Promise.reject(new Error('private provider detail'))]){
      const count=f.calls.length;f.respond=respond;
      const result=await f.service.execute(command,args);
      assert.equal(result.error.code,'INTERNAL_ERROR');assert.doesNotMatch(JSON.stringify(result),/private provider detail/);
      assert.equal(f.calls.length,count+1);
    }
    f.respond=()=>{throw new CommandError('NOT_FOUND','작업을 찾을 수 없습니다.');};
    assert.equal((await f.service.execute(command,args)).error.code,'NOT_FOUND');
    f.respond=async()=>({id:'job-1',status:'queued'});
    assert.equal((await f.service.execute(command,args)).ok,true);
  }
  assert.equal(f.commits,0);
});

test('provider failure after submission leaves the model unchanged and does not block later commands',async()=>{
  const f=fixture(),before=structuredClone(f.state);let release,submitted;
  const pending=new Promise(resolve=>{release=resolve;});
  f.respond=({request,document})=>{submitted={request,document};request.format='changed';document.project.name='provider copy';return pending;};
  const submission=f.service.execute('jobs.submit',{operation:'video.render',format:'mp4'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(submitted);assert.deepEqual(f.state,before);
  const following=f.service.execute('project.get');
  release({id:'',status:'queued'});
  assert.equal((await submission).error.code,'INVALID_PROVIDER_RESULT');
  assert.equal((await following).ok,true);assert.equal(f.calls.length,1);assert.equal(f.commits,0);
  assert.deepEqual(f.state,before);
});
