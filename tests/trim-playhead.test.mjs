import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { settingsPanelMarkup } from '../dist/panel-markup.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { initLocale, setLocale, t } from '../dist/i18n.mjs';

async function fixture(mobile=false){
 const f=await createAppFixture();
 vm.runInContext("state.clips=[{start:8,end:10},{start:1,end:4},{start:8,end:10}];state.speed=2;selected=2;current=6.123456789;history=[];future=[];renderTimeline();renderInspector();",f.context);
 if(mobile)vm.runInContext("switchPanel('settings')",f.context);
 const prefix=mobile?'panelTrim':'trim';
 return {...f,start:f.element('#'+prefix+'Start'),end:f.element('#'+prefix+'End'),startButton:f.element('#'+prefix+'StartPlayhead'),endButton:f.element('#'+prefix+'EndPlayhead')};
}

test('both trim surfaces capture only chosen precise source draft and preserve all project/history/selection state',async()=>{
 for(const mobile of [false,true]){
  const f=await fixture(mobile),before=f.evaluate('({state,selected,current,history,future,timer:persistence.saveTimer})');
  f.end.value='invalid opposite draft';vm.runInContext('playing=true;',f.context);f.startButton.onclick();
  assert.equal(Number(f.start.value),8+(6.123456789-5));assert.equal(f.end.value,'invalid opposite draft');
  assert.equal(f.doc.activeElement,f.start);assert.equal(f.evaluate('playing'),false);
  f.start.value='';f.endButton.onclick();assert.equal(f.start.value,'');assert.equal(Number(f.end.value),8+(6.123456789-5));
  assert.equal(f.doc.activeElement,f.end);assert.deepEqual(f.evaluate('({state,selected,current,history,future,timer:persistence.saveTimer})'),before);
 }
});
test('selected occurrence, shared boundaries and tiny decimal positions never use another repeated source occurrence',async()=>{
 const f=await fixture();
 for(const [selected,current,expected] of [[0,2,10],[1,2,1],[1,5,4],[2,5,8],[2,7,10]]){
  vm.runInContext(`selected=${selected};current=${current};renderInspector();`,f.context);f.startButton.onclick();assert.equal(Number(f.start.value),expected);
 }
 vm.runInContext('selected=0;current=6;renderInspector();playing=true;',f.context);f.start.value='unchanged';const request=f.evaluate('playRequest');
 f.startButton.onclick();assert.equal(f.start.value,'unchanged');assert.equal(f.evaluate('playing'),true);assert.equal(f.evaluate('playRequest'),request);
 assert.match(f.element('#toast').textContent,/선택한 클립/);
});
test('capture uses canonical cumulative arithmetic for a tiny clip after many large fractional occurrences',async()=>{
 const f=await fixture();
 vm.runInContext("state.duration=86400;state.clips=Array.from({length:199},()=>({start:.1,end:86399.9}));state.clips.push({start:8.1,end:8.2});selected=199;renderInspector();current=state.clips.slice(0,199).reduce((sum,clip)=>sum+(clip.end-clip.start),0);",f.context);
 f.startButton.onclick();assert.equal(f.start.value,'8.1');
 vm.runInContext('current=duration();',f.context);f.endButton.onclick();assert.equal(f.end.value,'8.2');
 assert.equal(f.evaluate('history.length'),0);
});
test('endpoint capture is a draft; Apply still validates minimum duration and creates one undoable edit',async()=>{
 const f=await fixture();vm.runInContext('current=7;',f.context);f.startButton.onclick();assert.equal(f.start.value,'10');assert.equal(f.evaluate('history.length'),0);
 f.element('#trimButton').onclick();assert.equal(f.evaluate('history.length'),0);
 vm.runInContext('current=6;',f.context);f.startButton.onclick();assert.equal(f.start.value,'9');
 f.element('#trimButton').onclick();assert.equal(f.evaluate('history.length'),1);assert.deepEqual(f.evaluate('state.clips[2]'),{start:9,end:10});
 vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state.clips[2]'),{start:8,end:10});
});
test('composition, detached mobile selection, recovery and busy states do not change drafts or focus',async()=>{
 const f=await fixture(true);f.start.value='draft';f.end.value='other';const focused=f.doc.activeElement;
 f.start.oncompositionstart();f.startButton.onclick();assert.equal(f.start.value,'draft');f.start.oncompositionend();
 f.startButton.onclick({isComposing:true});f.startButton.onclick({keyCode:229});assert.equal(f.start.value,'draft');
 const old=f.startButton.onclick;vm.runInContext('selected=1;',f.context);old();assert.equal(f.start.value,'draft');assert.equal(f.doc.activeElement,focused);
 vm.runInContext('selected=2;',f.context);
 vm.runInContext("Object.defineProperty(audioRecording,'requesting',{value:false,writable:true,configurable:true});Object.defineProperty(audioRecording,'current',{value:null,writable:true,configurable:true});",f.context);
 for(const busy of ['editorReady=false','exporting=true','loadingMedia=true','transcribing=true',"persistence.restorePhase='failed'","persistence.restorePhase='restoring'",'modal.open=true','audioRecording.requesting=true','audioRecording.current={}']){
  vm.runInContext("editorReady=true;exporting=false;loadingMedia=false;transcribing=false;persistence.restorePhase='ready';modal.open=false;audioRecording.requesting=false;audioRecording.current=null;playing=true;"+busy,f.context);
  const request=f.evaluate('playRequest');f.startButton.onclick();f.endButton.onclick();
  assert.deepEqual([f.start.value,f.end.value],['draft','other'],busy);assert.equal(f.evaluate('playRequest'),request,busy);
 }
});
test('trim actions have localized names, explicit labels, no interactive descendants in labels and touch-sized grouping',()=>{
 initLocale();try{
  for(const locale of ['ko','en','zh-CN']){
   setLocale(locale,{persist:false});const p=createDemoProject(),html=settingsPanelMarkup(p,p.clips[0]);
   for(const side of ['Start','End']){
    assert.ok(html.includes('for="panelTrim'+side+'"'));
    assert.ok(html.includes('aria-label="'+t('panels.trim'+side+'Playhead')+'"'));
   }
   assert.doesNotMatch(html,/<label[^>]*>(?:(?!<\/label>)[\s\S])*<button/);
  }
 }finally{initLocale();}
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');assert.match(html,/for="trimStart"/);assert.match(html,/for="trimEnd"/);
 const css=fs.readFileSync(new URL('../dist/styles/inspector-dialogs.css',import.meta.url),'utf8');assert.match(css,/\.trim-field-heading \.trim-playhead \{ width:38px; height:38px; flex-shrink:0;/);
});


test('capture keeps the same source time at every playback speed and mobile Apply uses its draft',async()=>{
 for(const mobile of [false,true]){
  const f=await fixture(mobile);
  for(const speed of [.25,1,2,4]){
   vm.runInContext(`state.speed=${speed};current=6;`,f.context);
   f.startButton.onclick();assert.equal(f.start.value,'9');assert.equal(f.evaluate('history.length'),0);
  }
  // The synthetic panel does not parse input values from its HTML markup.
  if(mobile) f.end.value='10';
  f.element(mobile?'#panelTrimApply':'#trimButton').onclick();
  assert.deepEqual(f.evaluate('state.clips[2]'),{start:9,end:10});
  assert.equal(f.evaluate('history.length'),1);
 }
});
