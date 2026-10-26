import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputHistory } from '../dist/input-history.mjs';

function fixture() {
  let value=1, blocked=false;
  const history=[], input={type:'range',value:'1'};
  const ranges=createInputHistory(()=>history.push(value),()=>blocked);
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

function textFixture(type='text', initial='Original', display=initial) {
  let value=initial, future=['redo'];
  const history=[], input={type,value:display};
  const edits=createInputHistory(()=>{history.push(value);future=[];});
  edits.bind(input,()=>value,next=>{value=next;});
  return {input,history,edits,get value(){return value;},get future(){return future;}};
}

test('text focus/blur and unchanged color cancellation preserve redo',()=>{
  for(const type of ['text','textarea','color']){
    const f=textFixture(type,type==='color'?'#FFFFFF':'Original');
    assert.equal(f.input.onfocus,undefined);
    if(type==='color'){f.input.value='#ffffff';f.input.onclick();}
    f.input.onchange();f.input.onblur();
    assert.deepEqual(f.history,[]);assert.deepEqual(f.future,['redo']);
  }
});

test('typing previews group until blur and a final change-only value is retained',()=>{
  const f=textFixture('textarea');
  for(const value of ['한','한글','한글\n문장']){f.input.value=value;f.input.oninput();}
  assert.deepEqual(f.history,['Original']);assert.equal(f.value,'한글\n문장');
  assert.equal(f.input.onkeydown,undefined);assert.equal(f.input.onclick,undefined);
  f.input.onblur();f.input.value='Final';f.input.onchange();
  assert.deepEqual(f.history,['Original','한글\n문장']);assert.equal(f.value,'Final');
});

test('IME pre-edit buffers do not consume redo; cancellation and commit use final values',()=>{
  const f=textFixture();
  f.input.oncompositionstart();f.input.value='Originalㅎ';f.input.oninput({isComposing:true});
  assert.equal(f.value,'Original');assert.deepEqual(f.future,['redo']);
  f.input.value='Original';f.input.oncompositionend();f.input.oninput({isComposing:false});
  assert.deepEqual(f.history,[]);assert.deepEqual(f.future,['redo']);
  f.input.oncompositionstart();f.input.value='한';f.input.oninput({isComposing:true});
  f.input.value='한글';f.input.oncompositionend();f.input.oninput({isComposing:false});
  assert.equal(f.value,'한글');assert.deepEqual(f.history,['Original']);
  f.input.onblur();assert.deepEqual(f.history,['Original']);
});

test('color previews and final change group once, reopening creates a new edit',()=>{
  const f=textFixture('color','#ffffff');f.input.onclick();
  for(const value of ['#111111','#222222']){f.input.value=value;f.input.oninput();}
  f.input.value='#333333';f.input.onchange();f.input.onblur();
  assert.equal(f.value,'#333333');assert.deepEqual(f.history,['#ffffff']);
  f.input.onclick();f.input.value='#444444';f.input.onchange();
  assert.deepEqual(f.history,['#ffffff','#333333']);assert.equal(f.value,'#444444');
});

test('an unchanged native color fallback does not overwrite an authored alpha color',()=>{
  const f=textFixture('color','#11223344','#000000');
  f.input.onclick();f.input.onchange();f.input.onblur();
  assert.equal(f.value,'#11223344');assert.deepEqual(f.future,['redo']);assert.deepEqual(f.history,[]);
  f.input.value='#334455';f.input.oninput();
  assert.equal(f.value,'#334455');assert.deepEqual(f.history,['#11223344']);
});


test('optional current owner refuses stale applies and event resets before snapshots',()=>{
 for(const type of ['text','range','color'])for(const event of ['onchange','onblur','onpointercancel']) {
  let oldCurrent=true,value='Original',snapshots=0;
  const edits=createInputHistory(()=>snapshots++),old={type,value:type==='range'?'1':type==='color'?'#111111':'Original'};
  edits.bind(old,()=>type==='range'?1:value,()=>{throw Error('stale update');},()=>oldCurrent);
  const current={type:'text',value:'Original'};edits.bind(current,()=>value,next=>value=next);
  oldCurrent=false;current.value='First';current.oninput();
  if(old[event])old[event]();else old.oninput();
  current.value='Second';current.oninput();assert.equal(snapshots,1,`${type}/${event}`);assert.equal(value,'Second');
 }
});

test('current callback defaults and explicit reset preserve normal history boundaries',()=>{
 for(const current of [undefined,null,()=>true]) {
  let value='Original',snapshots=0;const input={type:'text',value};const edits=createInputHistory(()=>snapshots++);
  edits.bind(input,()=>value,next=>value=next,current);
  input.oncompositionstart();input.value='One';input.oncompositionend();input.onchange();input.onblur();assert.equal(snapshots,1);
  input.value='Two';input.oninput();edits.reset();input.value='Three';input.oninput();assert.equal(snapshots,3);assert.equal(value,'Three');
 }
});


test('composition query is read-only and independent of history reset',()=>{
 let value='Original',snapshots=0,current=true;const input={type:'text',value};
 const edits=createInputHistory(()=>{snapshots++;edits.reset();});
 const composing=edits.bind(input,()=>value,next=>value=next,()=>current);
 assert.equal(composing(),false);input.oncompositionstart();assert.equal(composing(),true);
 edits.reset();assert.equal(composing(),true);assert.equal(snapshots,0);
 input.value='Final';input.oncompositionend();assert.equal(composing(),false);assert.equal(value,'Final');assert.equal(snapshots,1);
 current=false;input.oncompositionstart();assert.equal(composing(),false);assert.equal(snapshots,1);
});
