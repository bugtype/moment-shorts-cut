import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {complementSourceClips} from '../dist/core/timeline-complement.mjs';
import {setLocale,initLocale} from '../dist/i18n.mjs';
async function fixture(mobile=false){
 const f=await createAppFixture();vm.runInContext(`state.clips=[{start:8,end:10},{start:2,end:4},{start:3,end:6},{start:2,end:4}];state.speed=2;state.design.title.start=1;state.design.title.end=4;state.design.credit.start=2;state.design.credit.end=null;state.overlays=[{...newCard(12),id:'test',start:1,end:3}];state.audioOffset=2;state.captions=[{start:0,end:1,text:'source'},{start:2,end:3,text:'timeline',basis:'timeline'}];selected=2;current=3;history=[];future=[];switchPanel('${mobile?'settings':'media'}');`,f.context);
 f.open=event=>f.element(mobile?'#keepPanelGaps':'#keepGapsButton').onclick(event||{});f.confirm=event=>f.element('#confirmKeepGaps').onclick(event||{});return f;
}
test('desktop and compact complement preview all clips and apply exact shared retiming with one undo',async()=>{
 for(const mobile of [false,true]){
  const f=await fixture(mobile),before=f.evaluate('state'),clips=complementSourceClips(before),expected=prepareCommand(before,'timeline.replace',{clips}).project;
  f.open();assert.match(f.element('#modal').innerHTML,/현재 모든 클립/);assert.match(f.element('#gapPreview').innerHTML,/0–2/);assert.match(f.element('#gapPreview').innerHTML,/6–8/);assert.doesNotMatch(f.element('#gapPreview').innerHTML,/previousGapPage|nextGapPage/);
  assert.equal(f.evaluate('history.length'),0);f.confirm();assert.deepEqual(f.evaluate('state'),expected);assert.equal(f.evaluate('selected'),0);assert.equal(f.evaluate('current'),0);assert.equal(f.evaluate('history.length'),1);
  assert.deepEqual(f.evaluate('state.captions'),before.captions);assert.equal(f.evaluate('state.audioOffset'),before.audioOffset);
  assert.equal(f.doc.activeElement,f.element(mobile?'#keepPanelGaps':'#keepGapsButton'));vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state'),expected);
 }
});
test('cancel and invalid complements preserve playback, drafts and project history',async()=>{
 const f=await fixture(true);vm.runInContext('playing=true',f.context);f.element('#panelTrimStart').value='draft';const before=f.evaluate('({state,current,selected,history,playing})');f.open();f.element('#cancelKeepGaps').onclick();assert.deepEqual(f.evaluate('({state,current,selected,history,playing})'),before);assert.equal(f.element('#panelTrimStart').value,'draft');
 for(const clips of [[{start:0,end:12}],[{start:.01,end:12}]]){f.context.inputClips=clips;vm.runInContext('state.clips=inputClips;selected=0;renderPanel()',f.context);const snapshot=f.evaluate('state');f.open();assert.equal(f.evaluate('!!modal.open'),false);assert.deepEqual(f.evaluate('state'),snapshot);assert.equal(f.evaluate('history.length'),0);}
});
test('preview bounds DOM to20 source ranges per page without editing and old pager is inert',async()=>{
 const f=await fixture();vm.runInContext('state.duration=102;state.clips=Array.from({length:50},(_,i)=>({start:2*i+1,end:2*i+2}));renderPanel()',f.context);const before=f.evaluate('state');f.open();
 assert.equal((f.element('#gapPreview').innerHTML.match(/<li>/g)||[]).length,20);const old=f.element('#nextGapPage').onclick;old({});assert.match(f.element('#gapPreview').innerHTML,/21–40/);old({});assert.match(f.element('#gapPreview').innerHTML,/21–40/);
 f.element('#nextGapPage').onclick({});assert.equal((f.element('#gapPreview').innerHTML.match(/<li>/g)||[]).length,11);assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0);
});
test('stale project/media/panel/selection and busy/IME cannot commit or replace another modal',async()=>{
 for(const mutation of ['state=structuredClone(state)',"state.name='changed'",'state.speed=4','selected=1',"switchPanel('captions')",'sources.videoFile={}','sources.audioFile={}','loadingMedia=true','exporting=true','transcribing=true',"persistence.restorePhase='restoring'","persistence.restorePhase='failed';persistence.recoveryValid=false"]){
  const f=await fixture();f.open();vm.runInContext(mutation,f.context);const before=f.evaluate('state');f.confirm();assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0,mutation);
 }
 const f=await fixture(true),oldOpen=f.element('#keepPanelGaps').onclick;vm.runInContext('renderPanel()',f.context);oldOpen({});assert.equal(f.evaluate('!!modal.open'),false);
 f.open({isComposing:true});assert.equal(f.evaluate('!!modal.open'),false);f.open();const old=f.element('#confirmKeepGaps').onclick;
 for(const event of [{isComposing:true},{keyCode:229}])f.confirm(event);f.element('#modal').oncompositionstart();f.confirm();f.element('#modal').oncompositionend();assert.equal(f.evaluate('history.length'),0);
 f.element('#cancelKeepGaps').onclick();f.open();old({});assert.equal(f.evaluate('history.length'),0);
 const newer=f.element('#confirmKeepGaps').onclick;vm.runInContext("modalOpen('other','other')",f.context);const focus=f.doc.activeElement;newer({});assert.equal(f.doc.activeElement,focus);assert.equal(f.evaluate('history.length'),0);
});
test('failed-valid metadata complement/undo keep storage blocked and translated preview preserves contents',async()=>{
 try{for(const [locale,label] of [['ko','원본'],['en','Source'],['zh-CN','源时间']]){
  const f=await fixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);setLocale(locale,{persist:false});vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);f.open();assert.ok(f.element('#gapPreview').innerHTML.includes(label));
  const node=f.element('#confirmKeepGaps'),handler=node.onclick;setLocale(locale==='ko'?'en':'ko',{persist:false});assert.equal(node.onclick,handler);f.confirm();assert.equal(f.evaluate('history.length'),1);await vm.runInContext('saveProject(true);scheduleSave();undo()',f.context);assert.deepEqual(writes,[]);
 }}finally{initLocale();}
});

test('successful compact commit restores focus to newly rendered action',async()=>{
 const f=await fixture(true),root=f.element('#panelContent'),query=f.doc.querySelector;
 let markup=root.innerHTML,current=f.element('#keepPanelGaps');const original=current;
 f.doc.querySelector=selector=>selector==='#keepPanelGaps'?current:query(selector);
 Object.defineProperty(root,'innerHTML',{configurable:true,get:()=>markup,set:value=>{markup=value;current={focus(){f.doc.activeElement=this;}};}});
 original.onclick({});f.confirm();assert.notEqual(current,original);assert.equal(f.doc.activeElement,current);assert.equal(f.evaluate('selected'),0);assert.equal(f.evaluate('history.length'),1);
});
