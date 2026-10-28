import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

test('app caption search reviews authored occurrences without seeking, saving or modifying history',async()=>{
 const {context,evaluate,element,doc}=await createAppFixture();
 vm.runInContext("state.captions=[{start:0,end:1,text:'😀 이름 이름'},{start:8,end:9,text:'다른 이름'},{start:1,end:2,text:'미일치'}];state.clips=[{start:0,end:3}];current=1.5;history=[];future=[];globalThis.searchSaves=0;scheduleSave=()=>searchSaves++;switchPanel('captions');",context);
 const before=evaluate('({state,current,history,future})');
 element('#captionFind').value='이름';element('#captionFind').oninput();
 assert.equal(element('#captionSearchStatus').textContent,'일치 0 / 3');
 element('#nextCaptionMatch').onclick();
 const first=element('[data-caption-text="0"]');assert.equal(doc.activeElement,first);assert.deepEqual([first.selectionStart,first.selectionEnd],[3,5]);
 element('#nextCaptionMatch').onclick();assert.equal(doc.activeElement,first);assert.deepEqual([first.selectionStart,first.selectionEnd],[6,8]);
 element('#nextCaptionMatch').onclick();assert.equal(doc.activeElement,element('[data-caption-text="1"]'),'trimmed-out authored caption remains reviewable');
 assert.equal(element('#captionSearchStatus').textContent,'일치 3 / 3');
 element('#nextCaptionMatch').onclick();assert.equal(doc.activeElement,first);assert.equal(element('#captionSearchStatus').textContent,'일치 1 / 3');
 assert.deepEqual(evaluate('({state,current,history,future})'),before);assert.equal(evaluate('searchSaves'),0);
 vm.runInContext('renderPanel()',context);assert.equal(element('#captionFind').value,'이름');
 assert.equal(element('#captionSearchStatus').textContent,'일치 1 / 3');
 vm.runInContext("state=initial();state.captions=[{start:0,end:1,text:'새 이름'}];renderPanel();",context);
 assert.equal(element('#captionSearchStatus').textContent,'일치 0 / 1');element('#previousCaptionMatch').onclick();assert.equal(element('#captionSearchStatus').textContent,'일치 1 / 1');
});

test('app pagination reveals timeline/global search targets without page navigation editing or saving',async()=>{
 const {context,evaluate,element,doc}=await createAppFixture();
 vm.runInContext("state.duration=120;state.clips=[{start:0,end:120}];state.captions=Array.from({length:101},(_,i)=>({start:i,end:i+1,text:'자막 '+i}));current=1;history=[];future=[];globalThis.pageSaves=0;scheduleSave=()=>pageSaves++;switchPanel('captions');",context);
 const markup=()=>element('#panelContent').innerHTML;
 const before=evaluate('({state,current,history,future})');
 element('#nextCaptionPage').onclick();assert.match(markup(),/data-caption-text="50"/);assert.doesNotMatch(markup(),/data-caption-text="0"/);
 element('#captionFind').value='자막 100';element('#captionFind').oninput();element('#nextCaptionMatch').onclick();
 assert.match(markup(),/data-caption-text="100"/);assert.equal(doc.activeElement,element('[data-caption-text="100"]'));
 assert.deepEqual(evaluate('({state,current,history,future})'),before);assert.equal(evaluate('pageSaves'),0);
 context.captionNavigation={target:{closest:()=>({dataset:{captionIndex:'49',captionTime:'49'}})}};
 vm.runInContext('navigateCaption(captionNavigation)',context);
 assert.match(markup(),/data-caption-text="49"/);assert.doesNotMatch(markup(),/data-caption-text="50"/);
 assert.equal(doc.activeElement,element('[data-caption-text="49"]'));assert.equal(evaluate('current'),49);
 assert.equal(evaluate('history.length'),0);assert.equal(evaluate('pageSaves'),0);
});

test('nonblank correction previews avoid replacement output without changing search or actual edit history',async()=>{
 const f=await createAppFixture();
 vm.runInContext("state.captions=[{start:0,end:1,text:'확인 확인'},{start:1,end:2,text:'앞 확인 뒤'}];current=1;history=[];future=[];switchPanel('captions');",f.context);
 const before=f.evaluate('({state,current,history,future})');
 const original=String.prototype.split;let splits=0;
 String.prototype.split=function(separator,...args){if(separator==='확인')splits++;return original.call(this,separator,...args);};
 try {
  f.element('#captionReplacement').value='승인🙂';f.element('#captionReplacement').oninput();
  f.element('#captionFind').value='확인';f.element('#captionFind').oninput();
  assert.equal(splits,0);assert.equal(f.element('#captionSearchStatus').textContent,'일치 0 / 3');
  for(const [id,index,start,current] of [
   ['nextCaptionMatch',0,0,1],['nextCaptionMatch',0,3,2],['previousCaptionMatch',0,0,1],
   ['previousCaptionMatch',1,2,3],['nextCaptionMatch',0,0,1],
  ]) {
   f.element('#'+id).onclick();const input=f.element(`[data-caption-text="${index}"]`);
   assert.equal(f.doc.activeElement,input);assert.equal(input.selectionStart,start);assert.equal(input.selectionEnd,start+2);
   assert.equal(f.element('#captionSearchStatus').textContent,`일치 ${current} / 3`);assert.equal(splits,0);
  }
  assert.deepEqual(f.evaluate('({state,current,history,future})'),before);
  f.element('#replaceAllCaptions').onclick();
  assert.equal(splits,2,'only application constructs both changed captions');
  assert.deepEqual(f.evaluate('state.captions.map(c=>c.text)'),['승인🙂 승인🙂','앞 승인🙂 뒤']);
  assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),1);
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before.state);
  assert.equal(f.evaluate('history.length'),0);assert.equal(f.evaluate('future.length'),1);
 } finally {String.prototype.split=original;}
});
