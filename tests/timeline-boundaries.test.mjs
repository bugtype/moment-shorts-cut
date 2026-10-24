import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {hasMinimumDuration} from '../dist/core/validation.mjs';
import {createAppFixture} from './fixtures/app.mjs';

test('minimum duration tolerates decimal roundoff without admitting genuinely short or invalid spans',()=>{
 for(const [start,end] of [[0,.1],[.1,.2],[.2,.3],[8.1,8.2],[86399.9,86400]]){
  assert.equal(hasMinimumDuration(start,end),true);
  assert.equal(hasMinimumDuration(start,end-1e-7),false);
  assert.equal(hasMinimumDuration(start+1e-7,end),false);
  assert.equal(hasMinimumDuration(end,start),false);
 }
 for(const args of [[NaN,1],[0,Infinity],['0',1],[1e300,1e300],[0,1,0],[0,1,-1],[0,1,NaN]])assert.equal(hasMinimumDuration(...args),false);
});
test('UI trim accepts exact decimal tenths unchanged and records one reversible edit',async()=>{
 const {context,evaluate}=await createAppFixture();
 for(const [start,end] of [[.1,.2],[.2,.3],[8.1,8.2],[86399.9,86400]]){
  vm.runInContext('state=initial();state.duration=86400;state.clips=[{start:0,end:86400}];selected=0;history=[];future=[];',context);
  const before=evaluate('state');vm.runInContext(`trim(${start},${end})`,context);
  assert.deepEqual(evaluate('state.clips'),[{start,end}]);assert.equal(evaluate('history.length'),1);
  vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
  vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state.clips'),[{start,end}]);
 }
});
test('UI trim still rejects genuinely short/outside/nonfinite bounds without changing state or undo',async()=>{
 const {context,evaluate,element}=await createAppFixture();
 for(const expression of ['trim(8.1,8.1999999)','trim(-.1,.1)','trim(11.95,12.05)','trim(0,NaN)','trim(0,Infinity)']){
  vm.runInContext('state=initial();history=[];future=[];',context);const before=evaluate('({state,history,future})');
  vm.runInContext(expression,context);assert.deepEqual(evaluate('({state,history,future})'),before);assert.match(element('#toast').textContent,/0.1/);
 }
});
