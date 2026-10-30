import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDemoProject} from '../dist/core/project.mjs';
import {CommandError} from '../dist/core/validation.mjs';
import {createEditorService} from '../dist/integration/editor-service.mjs';

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('early input failures return serializable command names without changing diagnostics or storage',async()=>{
 const state=createDemoProject(),before=structuredClone(state);let gets=0,commits=0;
 const service=createEditorService({getProject(){gets++;return state;},commitProject(){commits++;}});
 const cyclic={};cyclic.self=cyclic;
 for(const [name,args,hook] of [[1n,{invalid:undefined},undefined],[cyclic,{},false]]){
  const expected=await service.execute('project.summary',args,hook);
  const rejected=await service.execute(name,args,hook);
  assert.equal(rejected.ok,false);assert.equal(rejected.command,'');
  assert.equal(expected.command,'project.summary');assert.equal(expected.error.code,'INVALID_ARGUMENT');
  assert.deepEqual(rejected.error,expected.error);
  assert.deepEqual(JSON.parse(JSON.stringify(rejected)),{...expected,command:''});
 }
 assert.equal((await service.execute({},{})).command,'','queued name validation uses the same representation');
 assert.equal(gets,0);assert.equal(commits,0);assert.deepEqual(state,before);
 assert.equal((await service.execute('project.summary')).ok,true);
 assert.equal(gets,1);assert.equal(commits,0);assert.deepEqual(state,before);
});

test('synchronous getter prepares and invokes commit before another microtask can edit the model',async()=>{
 let state=createDemoProject(),gets=0,commits=0;
 const service=createEditorService({getProject(){gets++;return structuredClone(state);},commitProject(next){commits++;state=next;}});
 const pending=service.execute('project.update',{patch:{name:'command'}});
 assert.ok(pending instanceof Promise);assert.equal(gets,0,'execute retains its queued Promise API');
 await Promise.resolve();
 state.zoom=1.5;
 assert.equal((await pending).ok,true);
 assert.equal(state.name,'command');assert.equal(state.zoom,1.5);
 assert.equal(gets,1);assert.equal(commits,1);
});

test('async getter and commit gates retain command ordering and exactly-once calls',async()=>{
 let state=createDemoProject(),gets=0,commits=0;
 const reading=deferred(),read=deferred(),committing=deferred(),commit=deferred(),trace=[];
 const service=createEditorService({
  async getProject(){gets++;trace.push('read');if(gets===1){reading.resolve();await read.promise;}return structuredClone(state);},
  async commitProject(next){commits++;trace.push('begin');if(commits===1){committing.resolve();await commit.promise;}state=next;trace.push('commit');},
 });
 const a=service.execute('project.update',{patch:{zoom:1.5}}),b=service.execute('project.update',{patch:{name:'second'}});
 await reading.promise;assert.equal(commits,0);read.resolve();
 await committing.promise;assert.equal(gets,1);assert.equal(state.zoom,1);commit.resolve();
 assert.ok((await Promise.all([a,b])).every(r=>r.ok));
 assert.deepEqual(trace,['read','begin','commit','read','begin','commit']);
 assert.equal(gets,2);assert.equal(commits,2);assert.equal(state.zoom,1.5);assert.equal(state.name,'second');
});

test('fulfilled promises across realms and custom thenables preserve receiver and single then access',async()=>{
 for(const kind of ['promise','cross-realm','thenable']){
  let state=createDemoProject(),gets=0,commits=0,accesses=0,calls=0;
  const service=createEditorService({getProject(){
   gets++;const snapshot=structuredClone(state);
   if(kind==='promise')return Promise.resolve(snapshot);
   if(kind==='cross-realm')return vm.runInNewContext('Promise.resolve(snapshot)',{snapshot});
   const value={get then(){accesses++;return function(resolve){assert.equal(this,value);calls++;resolve(snapshot);resolve(createDemoProject());};}};
   return value;
  },commitProject(next){commits++;state=next;}});
  assert.equal((await service.execute('project.update',{patch:{zoom:1.5}})).ok,true);
  assert.equal(state.zoom,1.5);assert.equal(gets,1);assert.equal(commits,1);
  if(kind==='thenable'){assert.equal(accesses,1);assert.equal(calls,1);}
 }
});

test('getter throws, then access/call throws and promise rejection fail once and leave the queue usable',async()=>{
 for(const kind of ['getter','then-access','then-call','reject','cross-realm-reject']){
  let state=createDemoProject(),gets=0,commits=0,accesses=0,calls=0;
  const failure=new CommandError('READ_FAILED','fixture read failed');
  const service=createEditorService({getProject(){
   if(++gets>1)return structuredClone(state);
   if(kind==='getter')throw failure;
   if(kind==='then-access')return {get then(){accesses++;throw failure;}};
   if(kind==='then-call')return {then(){calls++;throw failure;}};
   if(kind==='cross-realm-reject')return vm.runInNewContext('Promise.reject(failure)',{failure});
   return Promise.reject(failure);
  },commitProject(next){commits++;state=next;}});
  const first=service.execute('project.update',{patch:{zoom:2}}),second=service.execute('project.update',{patch:{name:'recovered'}});
  assert.equal((await first).error.code,'READ_FAILED');assert.equal((await second).ok,true);
  assert.equal(state.zoom,1);assert.equal(state.name,'recovered');assert.equal(gets,2);assert.equal(commits,1);
  if(kind==='then-access')assert.equal(accesses,1);if(kind==='then-call')assert.equal(calls,1);
 }
});

test('sync and async commit failures do not retry actions or break later queued commands',async()=>{
 for(const asynchronous of [false,true]){
  let state=createDemoProject(),gets=0,commits=0;
  const failure=new CommandError('WRITE_FAILED','fixture commit failed');
  const service=createEditorService({getProject(){gets++;return structuredClone(state);},commitProject(next){
   if(++commits===1){if(asynchronous)return Promise.reject(failure);throw failure;}
   state=next;
  }});
  const first=service.execute('project.update',{patch:{zoom:2}}),second=service.execute('project.update',{patch:{name:'recovered'}});
  assert.equal((await first).error.code,'WRITE_FAILED');assert.equal((await second).ok,true);
  assert.equal(state.zoom,1);assert.equal(state.name,'recovered');assert.equal(gets,2);assert.equal(commits,2);
 }
});

test('async host conflict checks receive the snapshot and propagate rejection without overwriting or retrying',async()=>{
 let state=createDemoProject(),commits=0;const entered=deferred(),release=deferred();
 const service=createEditorService({getProject:async()=>structuredClone(state),async commitProject(next,{previous}){
  commits++;if(commits===1){entered.resolve();await release.promise;}
  if(JSON.stringify(previous)!==JSON.stringify(state))throw new CommandError('CONFLICT','host conflict');
  state=next;
 }});
 const pending=service.execute('project.update',{patch:{name:'stale'}});
 await entered.promise;state.zoom=1.5;release.resolve();
 assert.equal((await pending).error.code,'CONFLICT');assert.equal(state.zoom,1.5);assert.notEqual(state.name,'stale');assert.equal(commits,1);
 assert.equal((await service.execute('project.update',{patch:{name:'explicit next request'}})).ok,true);
 assert.equal(state.zoom,1.5);assert.equal(commits,2);
});

test('queued beforeCommit checks run once immediately before project commit and rejection preserves the queue',async()=>{
 let state=createDemoProject(),checks=0,commits=0;const trace=[];
 const service=createEditorService({getProject:()=>structuredClone(state),commitProject(next){commits++;trace.push('commit');state=next;}});
 const first=service.execute('project.update',{patch:{zoom:1.5}});
 const stale=service.execute('project.update',{patch:{zoom:1}},()=>{checks++;trace.push('check');if(state.zoom!==1)throw new CommandError('CONFLICT','changed');});
 assert.equal((await first).ok,true);assert.equal((await stale).error.code,'CONFLICT');
 assert.equal(state.zoom,1.5);assert.equal(checks,1);assert.equal(commits,1);
 const success=service.execute('project.update',{patch:{name:'next'}},()=>{checks++;trace.push('check');queueMicrotask(()=>{trace.push('microtask');state.zoom=2;});});
 assert.equal((await success).ok,true);assert.equal(state.name,'next');assert.equal(state.zoom,2);
 assert.deepEqual(trace,['commit','check','check','commit','microtask']);
 assert.equal(checks,2);assert.equal(commits,2);
 await service.execute('project.get',{},()=>{throw new Error('read must not run a commit hook');});
 assert.equal(commits,2);
});

test('invalid, throwing and asynchronous commit checks reject without commit and allow retry',async()=>{
 for(const check of [null,{},()=>{throw new Error('failure');},()=>Promise.resolve(),()=>Promise.reject(new Error('async failure')),()=>({then(resolve){resolve();}})]){
  let state=createDemoProject(),commits=0;const before=structuredClone(state);
  const service=createEditorService({getProject:()=>state,commitProject(next){commits++;state=next;}});
  const rejected=await service.execute('project.update',{patch:{zoom:2}},check);
  assert.equal(rejected.ok,false);assert.equal(commits,0);assert.deepEqual(state,before);
  assert.equal((await service.execute('project.update',{patch:{zoom:1.5}})).ok,true);assert.equal(commits,1);
 }
});
