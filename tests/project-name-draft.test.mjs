import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {translateFor,initLocale,getLocale,t} from '../dist/i18n.mjs';

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

for(const locale of ['ko','en','zh-CN']) {
 test(`browser API commits preserve pending project names until an explicit user commit (${locale})`,async()=>{
  try {for(const value of ['Pending 이름 中文','','  Spaced draft  ']) {
   const f=await createAppFixture();initLocale({languages:[locale],storage:null,document:f.doc});
   assert.equal(getLocale(),locale);assert.equal(f.doc.documentElement.lang,locale);
   vm.runInContext('history=[];future=[];globalThis.nameSaves=0;scheduleSave=()=>nameSaves++;',f.context);
   const original=f.evaluate('state.name'),input=draft(f,value),before=stateOf(f);
   const result=await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}});
   assert.equal(result.ok,false);assert.equal(result.error.code,'CONFLICT');
   assert.equal(result.error.message,t('errors.projectNameDraftConflict'));
   assert.deepEqual(stateOf(f),before);assert.equal(f.evaluate('nameSaves'),0);
   assert.equal(input.value,value);assert.equal(f.doc.activeElement,input);
   assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,7);
   input.onchange({target:input});
   const accepted=value.trim()||t('shell.untitled');
   assert.equal(f.evaluate('state.name'),accepted);assert.equal(f.evaluate('history.length'),1);
   assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}})).ok,true);
   assert.equal(f.evaluate('state.name'),accepted);assert.equal(f.evaluate('history.length'),2);
   vm.runInContext('undo()',f.context);assert.equal(f.evaluate('state.name'),accepted);
   vm.runInContext('undo()',f.context);assert.equal(f.evaluate('state.name'),original);
  }}finally{initLocale();}
 });
}

test('name guard checks after enqueue, allows restoring the old value, and retains caller validation',async()=>{
 const f=await createAppFixture(),before=stateOf(f);let hooks=0;
 const pending=f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},()=>hooks++);
 const input=draft(f,'Typed after submission');
 assert.equal((await pending).error.code,'CONFLICT');assert.equal(hooks,0);assert.deepEqual(stateOf(f),before);
 const invalid=await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},null);
 assert.equal(invalid.error.code,'INVALID_ARGUMENT');assert.equal(input.value,'Typed after submission');
 input.value=before.state.name;
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},()=>hooks++)).ok,true);
 assert.equal(hooks,1);assert.equal(input.value,before.state.name);
});

test('name drafts permit reads, previews and genuine no-ops but reject replacements and entire batches',async()=>{
 const f=await createAppFixture(),input=draft(f),before=stateOf(f);
 const effect={command:'effects.update',arguments:{patch:{brightness:1.1}}};
 for(const [name,args] of [
  ['project.get',{}],['project.summary',{}],['project.preview',{operations:[effect]}],
  ['captions.text.replace',{find:'absent synthetic phrase',replacement:'unused'}],
 ]) {
  assert.equal((await f.context.window.moment.execute(name,args)).ok,true);
  assert.deepEqual(stateOf(f),before);assert.equal(input.value,'Uncommitted 日本語 🎬');
 }
 for(const [name,args] of [
  ['project.update',{patch:{name:'Requested rename'}}],
  ['effects.update',{patch:{brightness:before.state.effects.brightness}}],
  ['project.import',{document:f.evaluate('createProjectDocument(state)')}],
  ['project.batch',{operations:[effect,{command:'project.update',arguments:{patch:{name:'Batch rename'}}}]}],
 ]) {
  const result=await f.context.window.moment.execute(name,args);
  assert.equal(result.ok,false);assert.equal(result.error.code,'CONFLICT');
  assert.deepEqual(stateOf(f),before);assert.equal(input.value,'Uncommitted 日本語 🎬');
 }
});

test('untouched single-line name normalization does not block API commits; real subsequent edits do',async()=>{
 const f=await createAppFixture(),input=f.element('#projectName');let value='';
 // Model only text-input CR/LF sanitization; not native focus or IME ordering.
 Object.defineProperty(input,'value',{get:()=>value,set:next=>{value=String(next).replace(/[\r\n]/g,'');}});
 vm.runInContext("state.name='Line one\\r\\nLine two';renderInspector();",f.context);
 assert.equal(input.value,'Line oneLine two');
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}})).ok,true);
 assert.equal(f.evaluate('state.name'),'Line one\r\nLine two');
 draft(f,'Changed name');
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.2}})).error.code,'CONFLICT');
 assert.equal(input.value,'Changed name');
 input.value='Line oneLine two';
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.2}})).ok,true);
});

test('explicit file replacement and direct UI commands retain their name-draft replacement semantics',async()=>{
 for(const kind of ['file','local']) {
  const f=await createAppFixture(),original=f.evaluate('state.name'),input=draft(f);
  if(kind==='file') {
   const document=f.evaluate('createProjectDocument(state)');
   assert.equal((await f.context.window.moment.importProject(new Blob([JSON.stringify(document)]))).ok,true);
  } else assert.equal(vm.runInContext("runEditorCommand('effects.update',{patch:{brightness:1.1}})",f.context),true);
  assert.equal(input.value,original);
 }
});

test('header composition without a changed value blocks API replacement until compositionend',async()=>{
 const f=await createAppFixture(),input=f.element('#projectName'),before=stateOf(f);
 input.oncompositionstart?.();
 vm.runInContext('renderInspector();renderInspector()',f.context);
 const result=await f.context.window.moment.execute('project.update',{patch:{name:'API rename'}});
 assert.equal(result.ok,false);assert.equal(result.error.code,'CONFLICT');assert.deepEqual(stateOf(f),before);
 input.oncompositionend?.();
 assert.equal((await f.context.window.moment.execute('project.update',{patch:{name:'API rename'}})).ok,true);
 assert.equal(input.value,'API rename');
});

test('true project replacement clears header composition and stale old-input events cannot own a new header',async()=>{
 const f=await createAppFixture(),old=f.element('#projectName');old.oncompositionstart?.();
 const document=f.evaluate('createProjectDocument(state)');
 assert.equal((await f.context.window.moment.importProject(new Blob([JSON.stringify(document)]))).ok,true);
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}})).ok,true);
 const start=old.oncompositionstart,end=old.oncompositionend;
 const replacement=f.element('replacement-header'),query=f.doc.querySelector;
 f.doc.querySelector=selector=>selector==='#projectName'?replacement:query(selector);
 vm.runInContext('bind();renderInspector()',f.context);
 start?.();
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.2}})).ok,true);
 replacement.oncompositionstart?.();end?.();
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.3}})).error.code,'CONFLICT');
 replacement.oncompositionend?.();
 assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.3}})).ok,true);
});
