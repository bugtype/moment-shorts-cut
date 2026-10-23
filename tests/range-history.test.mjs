import test from 'node:test';
import assert from 'node:assert/strict';
import { createRangeHistory } from '../dist/range-history.mjs';

function fixture() {
  let value=1, blocked=false;
  const history=[], input={value:'1'};
  const ranges=createRangeHistory(()=>history.push(value),()=>blocked);
  ranges.bind(input,()=>value,next=>{value=next;});
  const change=next=>{input.value=String(next);input.oninput();};
  return {input,history,ranges,change,get value(){return value;},block(){blocked=true;}};
}

test('native keyboard changes group until blur without installing key handlers',()=>{
  const f=fixture();
  assert.equal(f.input.onkeydown,undefined);assert.equal(f.input.onfocus,undefined);
  // Arrow repeats, Home/End and Page-sized input values share one focused adjustment.
  for(const value of [1.01,1.02,1,3,2.8,2.6])f.change(value);
  assert.deepEqual(f.history,[1]);assert.equal(f.value,2.6);
  f.input.onblur();f.change(2.5);
  assert.deepEqual(f.history,[1,2.6]);
});

test('each pointer gesture groups previews, cancellation preserves the latest value',()=>{
  const f=fixture();
  f.input.onpointerdown();f.change(1.2);f.change(1.4);f.input.onpointerup();
  f.input.onpointerdown();f.change(1.8);f.input.onpointercancel();
  assert.deepEqual(f.history,[1,1.4]);assert.equal(f.value,1.8);
  f.change(1.9);assert.deepEqual(f.history,[1,1.4,1.8]);
});

test('focus boundaries, bounds/no-op input and blocked edits do not snapshot',()=>{
  const f=fixture();
  f.input.onpointerdown();f.change(1);f.input.onpointerup();f.input.onblur();
  f.change(NaN);assert.deepEqual(f.history,[]);
  f.change(3);f.change(3);assert.deepEqual(f.history,[1]);
  f.block();f.change(2);assert.equal(f.value,3);assert.deepEqual(f.history,[1]);
});

test('explicit history reset starts a new adjustment on the same focused control',()=>{
  const f=fixture();f.change(1.5);f.ranges.reset();f.change(2);
  assert.deepEqual(f.history,[1,1.5]);assert.equal(f.value,2);
});
