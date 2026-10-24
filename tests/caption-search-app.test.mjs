import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

test('app caption search reviews authored rows without seeking, saving or modifying history',async()=>{
 const {context,evaluate,element,doc}=await createAppFixture();
 vm.runInContext("state.captions=[{start:0,end:1,text:'😀 이름 이름'},{start:8,end:9,text:'다른 이름'},{start:1,end:2,text:'미일치'}];state.clips=[{start:0,end:3}];current=1.5;history=[];future=[];globalThis.searchSaves=0;scheduleSave=()=>searchSaves++;switchPanel('captions');",context);
 const before=evaluate('({state,current,history,future})');
 element('#captionFind').value='이름';element('#captionFind').oninput();
 assert.equal(element('#captionSearchStatus').textContent,'자막 0 / 2');
 element('#nextCaptionMatch').onclick();
 const first=element('[data-caption-text="0"]');assert.equal(doc.activeElement,first);assert.deepEqual([first.selectionStart,first.selectionEnd],[3,5]);
 element('#nextCaptionMatch').onclick();assert.equal(doc.activeElement,element('[data-caption-text="1"]'),'trimmed-out authored caption remains reviewable');
 assert.equal(element('#captionSearchStatus').textContent,'자막 2 / 2');
 element('#nextCaptionMatch').onclick();assert.equal(doc.activeElement,first);assert.equal(element('#captionSearchStatus').textContent,'자막 1 / 2');
 assert.deepEqual(evaluate('({state,current,history,future})'),before);assert.equal(evaluate('searchSaves'),0);
 vm.runInContext('renderPanel()',context);assert.equal(element('#captionFind').value,'이름');
 assert.equal(element('#captionSearchStatus').textContent,'자막 1 / 2');
 vm.runInContext("state=initial();state.captions=[{start:0,end:1,text:'새 이름'}];renderPanel();",context);
 assert.equal(element('#captionSearchStatus').textContent,'자막 0 / 1');element('#previousCaptionMatch').onclick();assert.equal(element('#captionSearchStatus').textContent,'자막 1 / 1');
});
