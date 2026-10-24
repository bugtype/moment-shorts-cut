import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {downloadBlob} from '../dist/download.mjs';
import {createAppFixture} from './fixtures/app.mjs';
function fixture(failures={}) {
 const events=[],timers=[],owned=new Set();
 const step=name=>{events.push(name);if(Object.hasOwn(failures,name))throw failures[name];};
 const parent={removeChild(anchor){step('fallback');owned.delete(anchor);anchor.parentNode=null;}};
 const anchor={parentNode:null,set href(value){step('href');this.url=value;},set download(value){step('name');this.name=value;},click(){step('click');},remove(){step('remove');owned.delete(this);this.parentNode=null;}};
 const deps={document:{createElement(){step('create');return anchor;},body:{append(value){step('append');owned.add(value);value.parentNode=parent;}}},URL:{createObjectURL(){step('url');return 'blob:owned-download';},revokeObjectURL(url){assert.equal(url,'blob:owned-download');step('revoke');}},setTimer(callback,delay){step('timer');assert.equal(delay,60000);timers.push(callback);}};
 return {deps,events,timers,owned,anchor};
}
test('successful download detaches its anchor and preserves the 60-second URL lifetime',()=>{
 const f=fixture();downloadBlob(new Blob(['data']),'file.txt',f.deps);assert.equal(f.anchor.name,'file.txt');assert.equal(f.anchor.url,'blob:owned-download');assert.equal(f.owned.size,0);assert.equal(f.events.includes('revoke'),false);assert.equal(f.timers.length,1);f.timers[0]();assert.equal(f.events.filter(x=>x==='revoke').length,1);
});
test('allocation, creation, attributes, append and click failures preserve errors and release owned resources',()=>{
 for(const stage of ['url','create','href','name','append','click']){
  const error=new Error(stage),f=fixture({[stage]:error});assert.throws(()=>downloadBlob(new Blob(),'x',f.deps),e=>e===error);assert.equal(f.owned.size,0);assert.equal(f.timers.length,0);assert.equal(f.events.filter(x=>x==='revoke').length,stage==='url'?0:1);
 }
});
test('cleanup faults never mask the primary failure; detach fallback and timer failure remain bounded',()=>{
 const primary=new Error('click'),remove=new Error('remove'),revoke=new Error('revoke');
 const f=fixture({click:primary,remove,revoke});assert.throws(()=>downloadBlob(new Blob(),'x',f.deps),e=>e===primary);assert.equal(f.owned.size,0);assert.equal(f.events.includes('fallback'),true);assert.equal(f.events.filter(x=>x==='revoke').length,1);
 const fallback=fixture({click:primary,remove,fallback:new Error('fallback')});assert.throws(()=>downloadBlob(new Blob(),'x',fallback.deps),e=>e===primary);assert.equal(fallback.events.includes('revoke'),true);
 const afterClick=fixture({remove});assert.throws(()=>downloadBlob(new Blob(),'x',afterClick.deps),e=>e===remove);assert.equal(afterClick.owned.size,0);assert.equal(afterClick.timers.length,1);assert.equal(afterClick.events.includes('revoke'),false);afterClick.timers[0]();
 const timerError=new Error('timer'),timer=fixture({timer:timerError,revoke});assert.throws(()=>downloadBlob(new Blob(),'x',timer.deps),e=>e===timerError);assert.equal(timer.events.filter(x=>x==='revoke').length,1);
});
test('actual shared app download propagates original failure without touching project or media URLs',async()=>{
 const f=await createAppFixture(),before=f.evaluate('({state,history,future,current})');
 const failure=new Error('blocked click'),revoked=[];let removed=0;
 f.context.URL.createObjectURL=()=> 'blob:owned-download';f.context.URL.revokeObjectURL=url=>revoked.push(url);
 f.context.document.body.append=()=>{};f.context.document.createElement=()=>({click(){throw failure;},remove(){removed++;}});
 assert.throws(()=>vm.runInContext("download(new Blob(['data']),'file.txt')",f.context),e=>e===failure);
 assert.deepEqual(revoked,['blob:owned-download']);assert.equal(removed,1);assert.deepEqual(f.evaluate('({state,history,future,current})'),before);
});
