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

test('get and cancel reject records for another job without exposing artifacts or retrying',async()=>{
  const f=fixture(),before=structuredClone(f.state);
  for(const command of ['jobs.get','jobs.cancel']){
    for(const [jobId,id] of [['job-1','job-2'],['Job-1','job-1'],[' job-1 ','job-1'],['é','e\u0301']]){
      const count=f.calls.length;
      f.respond=async()=>({id,status:'succeeded',artifacts:[{name:'wrong-job-artifact'}]});
      const result=await f.service.execute(command,{jobId});
      assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_PROVIDER_RESULT');
      assert.equal(result.data,undefined);assert.doesNotMatch(JSON.stringify(result),/wrong-job-artifact/);
      assert.equal(f.calls.length,count+1);assert.equal(f.calls.at(-1).arg,jobId);
      assert.deepEqual(f.state,before);assert.equal(f.commits,0);
      f.respond=()=>({id:jobId,status:'running'});
      const retry=await f.service.execute(command,{jobId});
      assert.equal(retry.ok,true);assert.equal(retry.data.id,jobId);assert.equal(retry.data.status,'running');
    }
  }
  f.respond=()=>({id:'new-provider-id',status:'queued'});
  assert.equal((await f.service.execute('jobs.submit',{operation:'video.render'})).ok,true,'submit allocates a new ID');
  assert.equal((await f.service.execute('project.get')).ok,true);
});

for(const [command,args] of commands){
  for(const key of ['id','status']){
    test(`${command} rejects a required ${key} that disappears during provider-record capture`,async()=>{
      const f=fixture(),before=structuredClone(f.state),record={id:'job-1',status:'running'};
      Object.defineProperty(record,key,{enumerable:false});f.respond=()=>record;
      const result=await f.service.execute(command,args);
      assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_PROVIDER_RESULT');
      assert.equal(result.data,undefined);assert.equal(f.calls.length,1);assert.equal(f.commits,0);
      assert.deepEqual(f.state,before);
      f.respond=()=>({id:'job-1',status:'running'});
      assert.equal((await f.service.execute(command,args)).ok,true);
      assert.equal(f.calls.length,2,'only the caller-requested retry invokes the provider again');
    });
  }

  test(`${command} validates the captured status rather than a later accessor value`,async()=>{
    const f=fixture(),before=structuredClone(f.state);let reads=0;
    f.respond=()=>({id:'job-1',get status(){return ++reads<3?'running':'not-a-job-status';}});
    const result=await f.service.execute(command,args);
    assert.equal(result.ok,true);assert.deepEqual(result.data,{id:'job-1',status:'running'});
    assert.equal(reads,2,'one bounded raw preflight and one detached capture, not repeated provider validation');
    assert.equal(Object.getOwnPropertyDescriptor(result.data,'status').get,undefined);
    assert.equal(f.calls.length,1);assert.equal(f.commits,0);assert.deepEqual(f.state,before);
  });
}

for(const [label,value] of [['nonfinite',NaN],['undefined',undefined],['bigint',1n],['date',new Date(0)],['function',()=>{}]]){
  test(`provider extension changing to ${label} during capture remains an invalid provider result`,async()=>{
    const f=fixture(),before=structuredClone(f.state);
    for(const [command,args] of commands){
      let reads=0;const calls=f.calls.length;
      f.respond=()=>({id:'job-1',status:'running',get privateDetail(){return ++reads===1?0:value;}});
      const result=await f.service.execute(command,args);
      assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_PROVIDER_RESULT');
      assert.equal(result.data,undefined);assert.equal(result.error.path,undefined);
      assert.doesNotMatch(JSON.stringify(result),/privateDetail/);
      assert.equal(f.calls.length,calls+1);assert.equal(reads,2);
      assert.deepEqual(f.state,before);assert.equal(f.commits,0);
    }
    f.respond=()=>({id:'job-1',status:'cancelled'});
    assert.equal((await f.service.execute('jobs.cancel',{jobId:'job-1'})).data.status,'cancelled');
    assert.equal((await f.service.execute('project.get')).ok,true);
  });
}

test('a provider getter throwing during detached capture uses the safe provider-output error contract',async()=>{
  const f=fixture(),before=structuredClone(f.state);
  for(const [command,args] of commands){
    let reads=0;const calls=f.calls.length;
    f.respond=()=>({id:'job-1',status:'running',get privateDetail(){
      if(++reads>1)throw new Error('synthetic private provider diagnostic');return 0;
    }});
    const result=await f.service.execute(command,args);
    assert.equal(result.ok,false);assert.equal(result.error.code,'INVALID_PROVIDER_RESULT');
    assert.equal(result.data,undefined);assert.doesNotMatch(JSON.stringify(result),/private|diagnostic/);
    assert.equal(f.calls.length,calls+1);assert.equal(reads,2);
  }
  assert.deepEqual(f.state,before);assert.equal(f.commits,0);
  assert.equal((await f.service.execute('project.get')).ok,true);
});
