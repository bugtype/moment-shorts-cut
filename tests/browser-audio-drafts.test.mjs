import {createMediaStorageFixture} from './fixtures/media-storage.mjs';
import {mountLeaveGuard} from './fixtures/leave-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,t} from '../dist/i18n.mjs';

async function fixture({locale='en',speed=1,offset=2,storeFactory}={}) {
 const f=await createAppFixture({beforeInit:({context})=>{
  if(storeFactory){
   const create=context.createProjectStore;
   context.createProjectStore=()=>create(storeFactory);
  }
 }}),root=f.element('#panelContent'),query=f.doc.querySelector;
 initLocale({languages:[locale],storage:null,document:f.doc});
 let html=root.innerHTML,input=null,generation=0;
 // Model actual emitted numeric markup and replacement, not native typing or IME ordering.
 Object.defineProperty(root,'innerHTML',{get:()=>html,set(value){
  html=value;if(input)input.isConnected=false;input=null;
  const tag=value.match(/<input\b[^>]*id="audioOffset"[^>]*>/)?.[0];
  if(tag){input=f.element('audio-draft-'+ ++generation);input.type='number';input.isConnected=true;
   input.value=tag.match(/value="([^"]*)"/)?.[1]||'';input.validity={badInput:false};
   const node=input;Object.defineProperty(node,'valueAsNumber',{get:()=>node.value.trim()===''?NaN:Number(node.value)});
  }
 }});
 f.doc.querySelector=s=>s==='#audioOffset'?input:query(s);
 vm.runInContext(`sources.audioFile=Object.assign(new Blob(['audio']),{name:'voice.wav'});state.audioName='voice.wav';
  state.audioOffset=${offset};state.speed=${speed};switchPanel('audio');history=[];future=[];validateProject(state);
  globalThis.audioDraftSaves=0;scheduleSave=()=>audioDraftSaves++;`,f.context);
 return {...f,input:()=>input};
}
const snapshot=f=>f.evaluate('({state,history,future,current,selected,playRequest,saves:audioDraftSaves})');
const edit=f=>f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}});

for(const locale of ['ko','en','zh-CN']) test(`live audio-start draft survives API commits (${locale})`,async()=>{
 try {for(const value of ['3.5','','invalid','-1','100']) {
  const f=await fixture({locale}),input=f.input();input.value=value;input.focus();const before=snapshot(f);
  const result=await edit(f);assert.equal(result.ok,false);assert.equal(result.error.code,'CONFLICT');
  assert.equal(result.error.message,t('errors.audioDraftConflict'));assert.deepEqual(snapshot(f),before);
  assert.equal(f.input(),input);assert.equal(input.isConnected,true);assert.equal(input.value,value);assert.equal(f.doc.activeElement,input);
 }}finally{initLocale();}
});

test('unchanged displayed output time is not a draft, including inverse-conversion precision',async()=>{
 for(const [speed,offset] of [[.25,2],[4,2],[.3,.7],[1,0],[1,20]]) {
  const f=await fixture({speed,offset});assert.equal((await edit(f)).ok,true);assert.equal(f.evaluate('state.audioOffset'),offset);
  const display=String(offset/speed);f.input().value=display.includes('.')?display+'0':display+'.000';
  assert.equal((await edit(f)).ok,true);
 }
});

test('explicit offset correction remains undoable and permits command retry',async()=>{
 const f=await fixture({speed:2}),before=f.evaluate('state');f.input().value='1.75';
 assert.equal((await edit(f)).error.code,'CONFLICT');f.input().onchange({target:f.input()});
 assert.equal(f.evaluate('state.audioOffset'),3.5);assert.equal(f.evaluate('history.length'),1);
 assert.equal((await edit(f)).ok,true);vm.runInContext('undo();undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
});

test('read, preview and genuine no-op commands preserve live drafts',async()=>{
 const f=await fixture(),input=f.input();input.value='3.5';const before=snapshot(f);
 for(const [name,args] of [['project.get',{}],['project.preview',{operations:[{command:'effects.update',arguments:{patch:{brightness:1.1}}}]}],
 ['captions.text.replace',{find:'absent unique synthetic phrase',replacement:'unused'}]]) {
  assert.equal((await f.context.window.moment.execute(name,args)).ok,true);assert.deepEqual(snapshot(f),before);assert.equal(f.input(),input);
 }
 for(const [name,args] of [['effects.update',{patch:{brightness:1}}],['project.batch',{operations:[{command:'effects.update',arguments:{patch:{brightness:1.1}}}]}]]) {
  assert.equal((await f.context.window.moment.execute(name,args)).error.code,'CONFLICT');assert.deepEqual(snapshot(f),before);
 }
});

test('commit-time drafts and composition refuse before caller hooks',async()=>{
 for(const composition of [false,true]) {
  const f=await fixture();let hooks=0;
  const pending=f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},()=>hooks++);
  if(composition)f.input().oncompositionstart();else f.input().value='3.5';
  assert.equal((await pending).error.code,'CONFLICT');assert.equal(hooks,0);
  if(composition)f.input().oncompositionend();else f.input().value='2.000';
  assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},()=>hooks++)).ok,true);assert.equal(hooks,1);
 }
});

test('bad input and model updates cannot masquerade as unchanged audio values',async()=>{
 const f=await fixture();f.input().validity.badInput=true;assert.equal((await edit(f)).error.code,'CONFLICT');
 f.input().validity.badInput=false;vm.runInContext('state.audioOffset=3',f.context);
 assert.equal((await edit(f)).error.code,'CONFLICT');f.input().value='3';assert.equal((await edit(f)).ok,true);
});

test('retired controls and panel or media replacements do not leave a draft lock',async()=>{
 for(const change of ["switchPanel('media')","renderPanel()","state=structuredClone(state)","sources.audioFile=Object.assign(new Blob(['new']),{name:'voice.wav'})"]) {
  const f=await fixture(),old=f.input();old.value='3.5';old.oncompositionstart();
  vm.runInContext(change,f.context);assert.equal((await edit(f)).ok,true);
 }
 const f=await fixture(),old=f.input();vm.runInContext('renderPanel()',f.context);
 const current=f.input();current.oncompositionstart();old.oncompositionend();old.oncompositionstart();
 assert.equal((await edit(f)).error.code,'CONFLICT');current.oncompositionend();assert.equal((await edit(f)).ok,true);
});


test('leave guard includes audio drafts, accepts equivalent values and releases old panels',async()=>{
 const f=await fixture({storeFactory:createMediaStorageFixture().factory});
 // Confirm the fixture's synthetic media so this test isolates authored input.
 await vm.runInContext('projectStore.setMedia(null,sources.audioFile)',f.context);
 const leaves=await mountLeaveGuard(f);
 assert.equal(leaves(),false);
 f.input().value='3.5';assert.equal(leaves(),true);
 f.input().value='2.000';assert.equal(leaves(),false);
 f.input().value='3.5';vm.runInContext("switchPanel('media')",f.context);
 assert.equal(leaves(),false);
});
