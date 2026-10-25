import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {translateFor,initLocale} from '../dist/i18n.mjs';

const stateOf=f=>f.evaluate('({state,history,future,current,selected})');
function draft(f,value='Uncommitted 日本語 🎬'){
 const input=f.element('#projectName');input.value=value;input.focus();input.setSelectionRange(2,7);return input;
}

test('delayed audio readiness does not erase a focused project-name draft or add a save/history edit',async()=>{
 const f=await createAppFixture(),writes=[];let resume;
 const node=()=>({gain:{value:0},connect(){}});
 f.context.AudioContext=class{
  destination=node();
  createMediaStreamDestination(){return {...node(),stream:{}};}
  createMediaElementSource(){return node();}
  createGain(){return node();}
  resume(){return new Promise(resolve=>{resume=resolve;});}
 };
 f.context.localStorage.setItem=(...args)=>writes.push(args);
 vm.runInContext('history=[];future=[];globalThis.nameSaves=0;scheduleSave=()=>nameSaves++',f.context);
 const pending=vm.runInContext('ensureAudio()',f.context);const input=draft(f),before=stateOf(f);
 resume();await pending;
 assert.equal(input.value,'Uncommitted 日本語 🎬');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,7);
 assert.equal(f.doc.activeElement,input);assert.deepEqual(stateOf(f),before);assert.equal(f.evaluate('nameSaves'),0);assert.deepEqual(writes,[]);
});

test('same-project status and trim-selection refreshes retain name drafts, but true model changes synchronize',async()=>{
 const f=await createAppFixture();vm.runInContext('state.clips=[{start:0,end:6},{start:6,end:12}];renderInspector();history=[];future=[];',f.context);
 const input=draft(f);vm.runInContext('selected=1;renderInspector();renderInspector()',f.context);
 assert.equal(input.value,'Uncommitted 日本語 🎬');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,7);
 vm.runInContext("state.name='Authoritative model name';renderInspector()",f.context);
 assert.equal(input.value,'Authoritative model name');assert.equal(f.evaluate('history.length'),0);
});

test('accepted name changes retain trimming, localized empty-name fallback and one undoable commit',async()=>{
 try{
  for(const locale of ['ko','en','zh-CN']){
   const f=await createAppFixture();vm.runInContext(`setLocale('${locale}',{persist:false});history=[];future=[]`,f.context);
   const original=f.evaluate('state.name'),input=draft(f,'  '+original+'  ');
   input.onchange({target:input});assert.equal(input.value,original);assert.equal(f.evaluate('state.name'),original);assert.equal(f.evaluate('history.length'),1);
   draft(f,'  Renamed 🎬  ');input.onchange({target:input});assert.equal(input.value,'Renamed 🎬');assert.equal(f.evaluate('state.name'),'Renamed 🎬');
   draft(f,' \n ');input.onchange({target:input});assert.equal(input.value,translateFor(locale,'shell.untitled'));
   assert.equal(f.evaluate('state.name'),input.value);assert.equal(f.evaluate('history.length'),3);
   draft(f,'   ');input.onchange({target:input});assert.equal(input.value,translateFor(locale,'shell.untitled'),'unchanged fallback must still normalize');
  }
 }finally{initLocale();}
});

test('replacement, settings import, reset and undo/redo replace old-context name drafts even with an identical name',async()=>{
 const f=await createAppFixture(),input=draft(f);const original=f.evaluate('state.name');
 vm.runInContext('state=structuredClone(state);renderInspector()',f.context);assert.equal(input.value,original);
 draft(f);const document=f.evaluate('createProjectDocument(state)');
 await vm.runInContext('importProjectSettings',f.context)(new Blob([JSON.stringify(document)]));assert.equal(input.value,original);
 draft(f);vm.runInContext('confirmReset()',f.context);f.element('#confirmReset').onclick();assert.equal(input.value,original);
 draft(f,'Committed');input.onchange({target:input});draft(f);vm.runInContext('undo()',f.context);assert.equal(input.value,original);
 draft(f);vm.runInContext('undo(true)',f.context);assert.equal(input.value,'Committed');
 draft(f);vm.runInContext("sources.setVideoFile=async()=>{}",f.context);
 await vm.runInContext("loadVideo({name:'replacement.mp4',type:'video/mp4',size:12})",f.context);assert.equal(input.value,'replacement');
});

test('refused name commits keep existing export/restoring guards and never write storage',async()=>{
 for(const condition of ['exporting=true',"persistence.restorePhase='restoring'"]){
  const f=await createAppFixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);
  vm.runInContext(condition,f.context);const before=stateOf(f),input=draft(f,'Not committed');input.onchange({target:input});
  assert.deepEqual(stateOf(f),before);assert.deepEqual(writes,[]);
 }
});
