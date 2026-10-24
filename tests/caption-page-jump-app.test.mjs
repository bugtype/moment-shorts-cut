import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

test('direct page navigation focuses the global caption without editing or seeking',async()=>{
  const f=await createAppFixture();
  vm.runInContext("state.captions=Array.from({length:10000},(_,index)=>({start:0,end:1,text:String(index)}));history=[];future=[];current=1;selected=0;panel='captions';globalThis.pageSaves=0;scheduleSave=()=>pageSaves++;renderPanel();",f.context);
  const before=f.evaluate('({state,history,future,current,selected})');
  const input=f.element('#captionPageNumber');input.value='101';
  let prevented=0;input.onkeydown({key:'Enter',preventDefault(){prevented++;}});
  assert.equal(prevented,1);
  assert.equal(f.doc.activeElement,f.element('[data-caption-text="5000"]'));
  assert.match(f.element('#panelContent').innerHTML,/data-caption-text="5000"/);
  assert.doesNotMatch(f.element('#panelContent').innerHTML,/data-caption-text="5050"/);
  assert.equal(f.element('#captionPageNumber').value,'101');
  f.element('#captionPageNumber').value='200';f.element('#goCaptionPage').onclick();
  assert.equal(f.doc.activeElement,f.element('[data-caption-text="9950"]'));
  assert.deepEqual(f.evaluate('({state,history,future,current,selected})'),before);
  assert.equal(f.evaluate('pageSaves'),0);
});

test('page drafts and validation survive locale changes; IME and detached Enter cannot navigate',async()=>{
  const f=await createAppFixture();
  vm.runInContext("state.captions=Array.from({length:10000},(_,index)=>({start:0,end:1,text:String(index)}));history=[];future=[];panel='captions';renderPanel();",f.context);
  const before=f.evaluate('({state,history,future,current})');
  const input=f.element('#captionPageNumber'),go=f.element('#goCaptionPage'),handler=input.onkeydown;
  input.value='170';input.focus();
  vm.runInContext("setLocale('en');",f.context);
  assert.equal(input.value,'170');assert.equal(input.onkeydown,handler);assert.equal(f.doc.activeElement,input);
  let prevented=0;
  handler({key:'Enter',isComposing:true,preventDefault(){prevented++;}});
  assert.equal(prevented,0);assert.doesNotMatch(f.element('#panelContent').innerHTML,/data-caption-text="8450"/);
  input.value='201';go.onclick();
  assert.match(input.validationMessage,/200/);assert.doesNotMatch(input.validationMessage,/[가-힣]/);
  const english=input.validationMessage;
  vm.runInContext("setLocale('zh-CN');",f.context);
  assert.notEqual(input.validationMessage,english);assert.match(input.validationMessage,/200/);
  assert.equal(input.value,'201');assert.equal(f.doc.activeElement,input);
  input.value='2';input.oninput();assert.equal(input.validationMessage,'');
  vm.runInContext('renderPanel()',f.context);
  const markup=f.element('#panelContent').innerHTML;
  input.value='180';handler({key:'Enter',preventDefault(){prevented++;}});
  assert.equal(prevented,0);assert.equal(f.element('#panelContent').innerHTML,markup);
  assert.deepEqual(f.evaluate('({state,history,future,current})'),before);
  vm.runInContext("setLocale('ko');",f.context);
});
