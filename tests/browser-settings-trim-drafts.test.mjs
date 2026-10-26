import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {installClipTrackDom} from './fixtures/timeline-clip-dom.mjs';
import {initLocale,getLocale,t} from '../dist/i18n.mjs';

async function fixture({locale='ko',clips=[{start:1,end:11},{start:2,end:5}],speed=1}={}) {
 const f=await createAppFixture(),root=f.element('#panelContent'),query=f.doc.querySelector;
 initLocale({languages:[locale],storage:null,document:f.doc});
 assert.equal(getLocale(),locale);assert.equal(f.doc.documentElement.lang,locale);
 let html='',inputs=new Map(),generation=0;
 // Model numeric attributes and descendant replacement, not native DOM/IME.
 Object.defineProperty(root,'innerHTML',{get:()=>html,set:value=>{
  html=value;for(const input of inputs.values())input.isConnected=false;inputs=new Map();generation++;
  for(const id of ['panelTrimStart','panelTrimEnd']) {
   const attributes=new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`).exec(value)?.[0];
   if(!attributes)continue;
   const input=f.element(`settings-draft-${generation}-${id}`);input.id=id;input.type='number';input.isConnected=true;
   input.value=/value="([^"]*)"/.exec(attributes)?.[1]||'';
   Object.defineProperty(input,'valueAsNumber',{get:()=>input.value.trim()===''?NaN:Number(input.value)});
   inputs.set('#'+id,input);
  }
 }});
 f.doc.querySelector=selector=>inputs.get(selector)||query(selector);
 const track=installClipTrackDom(f.element('#videoTrack'),f.doc,f.focusEvents);
 f.context.seedClips=structuredClone(clips);
 vm.runInContext(`state.clips=seedClips;state.speed=${speed};selected=0;current=2;history=[];future=[];
  timelineCache=null;renderTimeline();renderInspector();switchPanel('settings');
  globalThis.trimSaves=0;scheduleSave=()=>trimSaves++;`,f.context);
 return {...f,root,track,input:side=>inputs.get('#panelTrim'+side),values:()=>[...inputs.values()].map(input=>input.value)};
}
const snapshot=f=>f.evaluate('({state,history,future,current,selected,playRequest})');
const edit=f=>f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}});

for(const locale of ['ko','en','zh-CN']) test(`Settings range drafts block unrelated API commits (${locale})`,async()=>{
 try {for(const [side,value] of [['Start','2.3456789'],['End','9.87654321'],['Start',''],['End','invalid']]) {
  const f=await fixture({locale}),input=f.input(side);input.value=value;input.focus();
  const before=snapshot(f),values=f.values(),result=await edit(f);
  assert.equal(result.ok,false);assert.equal(result.error?.code,'CONFLICT');
  assert.equal(result.error.message,t('errors.trimDraftConflict'));
  assert.deepEqual(snapshot(f),before);assert.equal(f.evaluate('trimSaves'),0);
  assert.equal(f.input(side),input);assert.equal(input.isConnected,true);assert.equal(f.doc.activeElement,input);
  assert.deepEqual(f.values(),values);
 }}finally{initLocale();}
});

test('Apply remains explicit, precise, undoable and independent of playback speed',async()=>{
 for(const speed of [.25,1,4]) {
  const f=await fixture({speed}),before=f.evaluate('state.clips');
  f.input('Start').value='2.3456789';f.input('End').value='9.87654321';
  assert.equal((await edit(f)).error?.code,'CONFLICT');
  f.element('#panelTrimApply').onclick();
  assert.deepEqual(f.evaluate('state.clips[0]'),{start:2.3456789,end:9.87654321});
  assert.equal(f.evaluate('history.length'),1);
  assert.equal((await edit(f)).ok,true);assert.equal(f.evaluate('history.length'),2);
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state.clips[0]'),{start:2.3456789,end:9.87654321});
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state.clips'),before);
 }
});

test('invalid Apply preserves the pending range; restoring numeric values permits retry',async()=>{
 const f=await fixture(),start=f.input('Start'),before=snapshot(f);
 start.value='';f.element('#panelTrimApply').onclick();assert.deepEqual(snapshot(f),before);
 assert.equal((await edit(f)).error?.code,'CONFLICT');assert.equal(f.input('Start'),start);
 start.value='1.000';f.input('End').value='11e0';
 assert.equal((await edit(f)).ok,true);assert.deepEqual(f.evaluate('state.clips[0]'),{start:1,end:11});
});

test('untouched precise and exponent source values do not become drafts',async()=>{
 for(const clip of [{start:1.234567891234,end:11.987654321},{start:1e-10,end:3.5}]) {
  const f=await fixture({clips:[clip]});
  assert.equal(Number(f.input('Start').value),clip.start);assert.equal(Number(f.input('End').value),clip.end);
  assert.equal((await edit(f)).ok,true);assert.deepEqual(f.evaluate('state.clips[0]'),clip);
 }
});

test('read, preview and genuine no-op results preserve drafts; batches and equal-value commits reject',async()=>{
 const f=await fixture(),input=f.input('Start');input.value='2.5';const before=snapshot(f);
 const effect={command:'effects.update',arguments:{patch:{brightness:1.1}}};
 for(const [name,args] of [
  ['project.get',{}],['project.preview',{operations:[effect]}],
  ['captions.text.replace',{find:'absent synthetic phrase',replacement:'unused'}],
 ]) {
  assert.equal((await f.context.window.moment.execute(name,args)).ok,true);
  assert.deepEqual(snapshot(f),before);assert.equal(f.input('Start'),input);assert.equal(input.value,'2.5');
 }
 for(const [name,args] of [
  ['effects.update',{patch:{brightness:1}}],
  ['project.batch',{operations:[effect,{command:'project.update',arguments:{patch:{name:'Batch name'}}}]}],
  ['timeline.replace',{clips:[{start:3,end:8}]}],
 ]) {
  assert.equal((await f.context.window.moment.execute(name,args)).error?.code,'CONFLICT');assert.deepEqual(snapshot(f),before);
 }
});

test('queued range/composition edits are checked at commit, with explicit completion retry',async()=>{
 for(const composition of [false,true]) {
  const f=await fixture(),input=f.input('Start');let hooks=0;
  const pending=f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},()=>hooks++);
  if(composition)input.oncompositionstart();else input.value='2.5';
  assert.equal((await pending).error?.code,'CONFLICT');assert.equal(hooks,0);
  if(composition)input.oncompositionend();else input.value='1';
  assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},()=>hooks++)).ok,true);
  assert.equal(hooks,1);
 }
});

test('new same-valued clip occurrence, replaced controls and other panels do not inherit stale drafts',async()=>{
 const f=await fixture({clips:[{start:1,end:11},{start:1,end:11}]});
 const old=f.input('Start');old.value='2.5';const startComposition=old.oncompositionstart,endComposition=old.oncompositionend;
 f.track.onclick({target:f.track.children[1],detail:0});
 assert.equal(f.evaluate('selected'),1);assert.notEqual(f.input('Start'),old);assert.deepEqual(f.values(),['1','11']);
 startComposition();assert.equal((await edit(f)).ok,true);
 const current=f.input('Start');current.oncompositionstart();endComposition();
 assert.equal((await edit(f)).error?.code,'CONFLICT');current.oncompositionend();
 current.value='3';vm.runInContext("switchPanel('media')",f.context);
 assert.equal((await edit(f)).ok,true);
 vm.runInContext("switchPanel('settings')",f.context);assert.deepEqual(f.values(),['1','11']);
 assert.equal((await edit(f)).ok,true);
});

test('playhead capture remains a draft, while explicit file/Undo replacements keep existing behavior',async()=>{
 const f=await fixture();
 f.element('#panelTrimStartPlayhead').onclick();assert.equal(f.input('Start').value,'3');
 assert.equal((await edit(f)).error?.code,'CONFLICT');
 const document=f.evaluate('createProjectDocument(state)');
 assert.equal((await f.context.window.moment.importProject(new Blob([JSON.stringify(document)]))).ok,true);
 assert.deepEqual(f.values(),['1','11']);
 f.input('Start').value='4';vm.runInContext('undo()',f.context);assert.deepEqual(f.values(),['1','11']);
 assert.equal((await edit(f)).ok,true);
});


test('current model changes cannot disguise an old display as untouched',async()=>{
 const f=await fixture(),start=f.input('Start');
 vm.runInContext('state.clips[0].start=1.5;',f.context);
 assert.equal(start.value,'1');assert.equal((await edit(f)).error?.code,'CONFLICT');
 start.value='1.50';assert.equal((await edit(f)).ok,true);
});

test('persistent inspector drafts retain their existing independent ownership',async()=>{
 const f=await fixture();vm.runInContext("switchPanel('media')",f.context);
 const start=f.element('#trimStart');start.value='2.25';
 assert.equal((await edit(f)).ok,true);assert.equal(start.value,'2.25');
 assert.deepEqual(f.evaluate('state.clips[0]'),{start:1,end:11});
});
