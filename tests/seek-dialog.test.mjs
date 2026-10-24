import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {parseOutputTime, decimalTime, createSeekDialog} from '../dist/seek-dialog.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';
function fixture() {
 let project=createDemoProject(),busy=false,media=[{},{}];const events=[],nodes=new Map();
 const query=id=>nodes.get(id)||null;
 nodes.set('#timeDisplay',{focus(){events.push('focusTime');}});
 const modal={open:false,close(){this.open=false;events.push('close');this.onclose?.();}};
 const openModal=(title,body,foot)=>{modal.onclose?.();modal.onclose=null;for(const id of [...nodes.keys()])if(id!=='#timeDisplay')nodes.delete(id);for(const match of (body+foot).matchAll(/id="([^"]+)"/g))nodes.set('#'+match[1],{value:'',focus(){events.push('focusInput');}});modal.open=true;};
 const controller=createSeekDialog({getProject:()=>project,getCurrent:()=>2,getDuration:()=>12,getMedia:()=>media,query,modal,openModal,blocked:()=>busy,pause:()=>events.push('pause'),seek:t=>{assert.equal(modal.open,false);events.push(['seek',t]);},toast:t=>events.push(['toast',t])});
 return {controller,query,modal,events,project:()=>project,replace:()=>project=structuredClone(project),relink:()=>media=[{},{}],block:v=>busy=v,other:()=>openModal('other','<button id="other">',''),submit(value){query('#outputSeekTime').value=value;query('#confirmOutputSeek').onclick();}};
}
test('time grammar is explicit, finite and not a frame timecode; decimal prefill round-trips',()=>{
 for(const [value,expected] of [['0',0],[' 12.5 ',12.5],['01:23.5',83.5],['100:02:03.125',360123.125],['123:59',7439]])assert.equal(parseOutputTime(value),expected);
 for(const value of ['', '.5','-1','+1','1e3','Infinity','1:60','1:60:00','1:02:60.1','1:2:3:4','1:001','1.2:3','1.', '9'.repeat(400)])assert.throws(()=>parseOutputTime(value));
 for(const value of [0,Number.MIN_VALUE,1e-7,1.23456789,1e21,345600000]){assert.doesNotMatch(decimalTime(value),/e/);assert.equal(parseOutputTime(decimalTime(value)),value);}
});
test('strict mounted dialog rejects invalid/range, accepts endpoints, closes before pause/seek and only once',()=>{
 const f=fixture();f.project().speed=2;const before=structuredClone(f.project());f.controller.open();assert.equal(f.query('#outputSeekTime').value,'1');
 for(const value of ['','-1','6.00001']){f.submit(value);assert.equal(f.modal.open,true);}
 const old=f.query('#confirmOutputSeek').onclick;f.submit('6');old();assert.deepEqual(f.events.slice(-4),['close','focusTime','pause',['seek',12]]);assert.deepEqual(f.project(),before);
 f.controller.open();f.submit('0');assert.deepEqual(f.events.at(-1),['seek',0]);
});
test('cancel, stale nodes, replacement, same-object edits and media relink cannot seek',()=>{
 for(const alter of [f=>f.modal.close(),f=>f.other(),f=>f.controller.open(),f=>f.replace(),f=>f.project().speed=2,f=>f.project().name='changed',f=>f.relink()]){
  const f=fixture();f.controller.open();const old=f.query('#confirmOutputSeek').onclick;alter(f);old();assert.ok(!f.events.some(e=>Array.isArray(e)&&e[0]==='seek'));
 }
 const f=fixture();f.controller.open();f.query('#cancelOutputSeek').onclick();assert.equal(f.modal.open,false);assert.ok(!f.events.includes('pause'));
});
test('busy opening/submission, Enter IME/modifiers and queued close ownership',()=>{
 const f=fixture();f.block(true);f.controller.open();assert.equal(f.modal.open,false);f.block(false);f.controller.open();f.block(true);f.submit('1');assert.equal(f.modal.open,true);f.block(false);
 const input=f.query('#outputSeekTime');let prevented=0;
 for(const extra of [{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{defaultPrevented:true}])input.onkeydown({key:'Enter',preventDefault:()=>prevented++,...extra});assert.equal(prevented,0);assert.equal(f.modal.open,true);
 let queued;f.modal.close=function(){this.open=false;queued=()=>this.onclose?.();};f.modal.close();f.controller.open();queued();f.query('#outputSeekTime').onkeydown({key:'Enter',preventDefault:()=>prevented++});assert.equal(prevented,1);assert.ok(f.events.includes('pause'));
});
test('actual time button maps output clocks across cuts/speeds, pauses and preserves edits/history/save',async()=>{
 for(const speed of [.25,1,2,4]){
  const f=await createAppFixture();vm.runInContext('state.speed='+speed+';state.clips=[{start:2,end:4},{start:8,end:12}];history=[];future=[];globalThis.saves=0;scheduleSave=()=>saves++;current=1;playing=true;bind();',f.context);
  const before=f.evaluate('({state,history,future})');f.element('#timeDisplay').onclick();assert.equal(f.element('#modal').open,true);f.element('#outputSeekTime').value=String(3/speed);f.element('#confirmOutputSeek').onclick();
  assert.equal(f.evaluate('current'),3);assert.equal(f.evaluate('playing'),false);assert.equal(f.evaluate('locate(current).source'),9);assert.deepEqual(f.evaluate('({state,history,future})'),before);assert.equal(f.evaluate('saves'),0);
  f.element('#timeDisplay').onclick();f.element('#outputSeekTime').value=String(6/speed);f.element('#confirmOutputSeek').onclick();assert.equal(f.evaluate('current'),6);
 }
});
test('actual failed recovery and ongoing media operations block navigation',async()=>{
 for(const expression of ["Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'});",'exporting=true','loadingMedia=true','transcribing=true',"Object.defineProperty(audioRecording,'requesting',{get:()=>true});"]){
  const f=await createAppFixture();vm.runInContext('bind();'+expression,f.context);f.element('#timeDisplay').onclick();assert.ok(!f.element('#modal').open,expression);
 }
});
test('actual navigation reuses source seek and synchronized audio without starting playback',async()=>{
 const f=await createAppFixture();vm.runInContext("bind();state.kind='video';state.speed=2;state.clips=[{start:2,end:4},{start:8,end:12}];state.audioOffset=1;video.duration=12;audio.duration=20;globalThis.testAudioFile={};Object.defineProperty(sources,'audioFile',{get:()=>testAudioFile});",f.context);
 f.element('#timeDisplay').onclick();f.element('#outputSeekTime').value='1.5';f.element('#confirmOutputSeek').onclick();assert.equal(f.evaluate('video.currentTime'),9);assert.equal(f.evaluate('audio.currentTime'),2);assert.equal(f.evaluate('playing'),false);
});
test('seek button exposes action and current/total output clock after each display update',async()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 assert.match(html,/<button type="button" id="timeDisplay"[^>]*aria-label="출력 시간으로 이동, 00:00 \/ 00:12"/);
 const f=await createAppFixture(), attributes=new Map();
 f.element('#timeDisplay').setAttribute=(name,value)=>attributes.set(name,value);
 vm.runInContext('state.speed=2;current=3;updateTime();',f.context);
 assert.equal(attributes.get('aria-label'),'출력 시간으로 이동, 00:01 / 00:06');
 vm.runInContext('current=8;updateTime();',f.context);
 assert.equal(attributes.get('aria-label'),'출력 시간으로 이동, 00:04 / 00:06');
 assert.equal(attributes.get('aria-live'),undefined);
});
