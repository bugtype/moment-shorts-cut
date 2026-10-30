import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { initLocale, setLocale, t } from '../dist/i18n.mjs';
import { settingsPanelMarkup } from '../dist/panel-markup.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
async function fixture(){
 const f=await createAppFixture();
 vm.runInContext('ensureAudio=async()=>{};',f.context);
 return f;
}
const endPass=f=>vm.runInContext('current=duration();playing=true;lastTick=0;tick(1);',f.context);
const snapshot=f=>f.evaluate('({state,history,future,selected,timer:persistence.saveTimer})');

test('preview loop defaults off, toggles without autoplay or edits, and survives Settings rerenders',async()=>{
 const f=await fixture(),before=snapshot(f);
 assert.equal(f.evaluate('playback.loopPreview'),false);
 vm.runInContext("switchPanel('settings')",f.context);
 const checkbox=f.element('#loopPreview');assert.equal(checkbox.checked,false);
 checkbox.checked=true;checkbox.onchange();assert.equal(f.evaluate('playback.loopPreview'),true);assert.equal(f.evaluate('playing'),false);
 vm.runInContext('renderPanel()',f.context);assert.equal(checkbox.checked,true);
 assert.deepEqual(snapshot(f),before);
 vm.runInContext("switchPanel('captions')",f.context);checkbox.checked=false;checkbox.onchange();assert.equal(f.evaluate('playback.loopPreview'),true);
});
test('demo repeats whole edited timeline at any speed, while disabling lets its current pass finish',async()=>{
 const f=await fixture();vm.runInContext('playback.setLoopPreview(true);state.speed=2;',f.context);const before=snapshot(f);
 for(let pass=0;pass<3;pass++){
  endPass(f);await settle();assert.equal(f.evaluate('current'),0);assert.equal(f.evaluate('playing'),true);assert.ok(f.evaluate('frameHandle')>0);
  assert.deepEqual(snapshot(f),before);
 }
 vm.runInContext('current=3;playback.setLoopPreview(false)',f.context);assert.equal(f.evaluate('playing'),true);assert.equal(f.evaluate('current'),3);
 endPass(f);await settle();assert.equal(f.evaluate('playing'),false);assert.equal(f.evaluate('current'),12);
});
test('added audio resets to its edited offset on each pass rather than continuing its previous clock',async()=>{
 const f=await fixture();vm.runInContext('sources.audioFile={name:"voice"};audio.duration=12;state.audioOffset=2;audio.currentTime=7;playback.setLoopPreview(true);',f.context);
 endPass(f);await settle();assert.equal(f.evaluate('current'),0);assert.equal(f.evaluate('audio.currentTime'),10,'the completed pass ends at its offset-adjusted clock; restart does not start early');
 vm.runInContext('current=3;playback.syncAudio(true);',f.context);assert.equal(f.evaluate('audio.currentTime'),1);
 endPass(f);await settle();vm.runInContext('current=2;playback.syncAudio(true);',f.context);assert.equal(f.evaluate('audio.currentTime'),0);
});
test('card preview takes precedence and export completes once even with preview loop enabled',async()=>{
 const f=await fixture();vm.runInContext('playback.setLoopPreview(true);cardPlaybackEnd=12;',f.context);endPass(f);await settle();assert.equal(f.evaluate('playing'),false);
 let stops=0;f.context.recordStop=cancelled=>{assert.equal(cancelled,false);stops++;};
 vm.runInContext('exporting=true;stopExport=recordStop;',f.context);endPass(f);await settle();assert.equal(stops,1);assert.equal(f.evaluate('playing'),false);assert.equal(f.evaluate('current'),12);
 assert.equal(f.evaluate('playback.loopPreview'),true);
});
test('pending automatic restarts cannot outlive pause, seek, toggle-off, replacement, hidden, recovery or busy state',async()=>{
 const actions=['pause()','seekTo(4)','playback.setLoopPreview(false)','state=structuredClone(state)','sources.videoFile={name:"replacement"}','sources.audioFile={name:"replacement"}','document.hidden=true',"persistence.restorePhase='failed'",'loadingMedia=true','transcribing=true','exporting=true','modal.open=true','audioRecording.requesting=true','audioRecording.current={}'];
 for(const action of actions){
  const f=await fixture();let release;
  f.context.waitAudio=()=>new Promise(resolve=>release=resolve);
  vm.runInContext("Object.defineProperty(audioRecording,'requesting',{value:false,writable:true,configurable:true});Object.defineProperty(audioRecording,'current',{value:null,writable:true,configurable:true});ensureAudio=waitAudio;playback.setLoopPreview(true);",f.context);
  endPass(f);assert.equal(f.evaluate('playing'),false);vm.runInContext(action,f.context);release();await settle();
  assert.equal(f.evaluate('playing'),false,action);assert.equal(f.evaluate('frameHandle'),0,action);
  if(action==='seekTo(4)')assert.equal(f.evaluate('current'),4);
 }
});
test('mocked video replay waits for pending seek and checks ownership after native play resolves',async()=>{
 for(const stage of ['seek','play']){
  const f=await fixture();let release;
  f.context.waitNative=()=>new Promise(resolve=>release=resolve);
  vm.runInContext(`state.kind='video';video.duration=12;video.currentTime=12;video.seeking=${stage==='seek'};video.play=${stage==='play'?'waitNative':'async()=>{}'};seekVideo=${stage==='seek'?'waitNative':'async()=>{}'};playback.setLoopPreview(true);`,f.context);
  endPass(f);await settle();assert.equal(typeof release,'function');
  vm.runInContext('playback.setLoopPreview(false)',f.context);release();await settle();
  assert.equal(f.evaluate('playing'),false);assert.equal(f.evaluate('frameHandle'),0);
 }
 const f=await fixture();let plays=0;f.context.fakePlay=async()=>{plays++;};
 vm.runInContext("state.kind='video';video.duration=12;video.currentTime=12;video.seeking=false;video.play=fakePlay;playback.setLoopPreview(true);",f.context);
 endPass(f);await settle();assert.equal(plays,1);assert.equal(f.evaluate('current'),0);assert.equal(f.evaluate('playing'),true);
});
test('automatic restart errors stop once without a recursive retry or unhandled rejection',async()=>{
 const f=await fixture();let attempts=0;
 f.context.failAudio=async()=>{attempts++;throw new Error('audio unavailable');};
 vm.runInContext('ensureAudio=failAudio;playback.setLoopPreview(true);',f.context);endPass(f);await settle();
 assert.equal(attempts,1);assert.equal(f.evaluate('playing'),false);assert.equal(f.evaluate('frameHandle'),0);assert.match(f.element('#toast').textContent,/재생/);
 await settle();assert.equal(attempts,1);
});
test('loop setting has localized visible label and checked state without modifying project data',()=>{
 initLocale();try{for(const locale of ['ko','en','zh-CN']){
  setLocale(locale,{persist:false});const p=createDemoProject(),before=JSON.stringify(p);
  assert.ok(settingsPanelMarkup(p,p.clips[0],true).includes(t('panels.loopPreview')));
  assert.match(settingsPanelMarkup(p,p.clips[0],true),/id="loopPreview" type="checkbox" checked/);
  assert.doesNotMatch(settingsPanelMarkup(p,p.clips[0],false),/id="loopPreview" type="checkbox" checked/);
  assert.equal(JSON.stringify(p),before);
 }}finally{initLocale();}
});

test('manual Play takes ownership from a pending restart and loop-off must not cancel it',async()=>{
 const f=await fixture(),waiting=[];
 f.context.waitAudio=()=>new Promise(resolve=>waiting.push(resolve));
 vm.runInContext('ensureAudio=waitAudio;playback.setLoopPreview(true);',f.context);endPass(f);
 assert.equal(waiting.length,1);
 const manual=vm.runInContext('play()',f.context);assert.equal(waiting.length,2);
 vm.runInContext('playback.setLoopPreview(false)',f.context);
 waiting[0]();await settle();assert.equal(f.evaluate('playing'),false);
 waiting[1]();await manual;assert.equal(f.evaluate('playing'),true);assert.ok(f.evaluate('frameHandle')>0);
});

test('automatic rewind preserves in-progress text drafts and focus without rerendering the panel',async()=>{
 const f=await fixture();
 vm.runInContext("switchPanel('text');globalThis.panelRenders=0;renderPanel=()=>{panelRenders++;};playback.setLoopPreview(true);",f.context);
 const field=f.element('#titleFirst');field.value='Uncommitted title draft';field.focus();
 const before=snapshot(f);endPass(f);await settle();
 assert.equal(f.evaluate('panelRenders'),0);assert.equal(field.value,'Uncommitted title draft');assert.equal(f.doc.activeElement,field);
 assert.deepEqual(snapshot(f),before);
 vm.runInContext('seekTo(2)',f.context);assert.equal(f.evaluate('panelRenders'),1,'manual seek retains its existing refresh behavior');
});

function deliverFrame(f, id, now=1) {
 const callback=f.pendingFrames.get(id);
 assert.equal(typeof callback,'function','the scheduled frame must exist');
 f.pendingFrames.delete(id); // Browsers dequeue a RAF before invoking its callback.
 callback(now);
}
async function playingFixture(){
 const f=await fixture();
 // Complete startup paint requests before counting transport-owned frames.
 for(const id of [...f.pendingFrames.keys()])deliverFrame(f,id);
 vm.runInContext('playback.setLoopPreview(true);',f.context);
 await vm.runInContext('play()',f.context);
 assert.equal(f.pendingFrames.size,1);
 return f;
}
function deliverEndFrame(f){
 vm.runInContext('current=duration();lastTick=0;',f.context);
 deliverFrame(f,f.evaluate('frameHandle'));
}

test('realistic RAF dequeue leaves exactly one frame per repeated pass and none after pause or restart error',async()=>{
 const f=await playingFixture();
 for(let pass=0;pass<4;pass++){
  deliverEndFrame(f);assert.equal(f.pendingFrames.size,0,'restart preparation owns no scheduled tick');
  await settle();assert.equal(f.pendingFrames.size,1);assert.ok(f.pendingFrames.has(f.evaluate('frameHandle')));
 }
 vm.runInContext('pause()',f.context);assert.equal(f.pendingFrames.size,0);
 await vm.runInContext('play()',f.context);assert.equal(f.pendingFrames.size,1);
 vm.runInContext('ensureAudio=async()=>{throw new Error("restart failure");};',f.context);
 deliverEndFrame(f);await settle();assert.equal(f.pendingFrames.size,0);assert.equal(f.evaluate('frameHandle'),0);
});

test('RAF ownership stays singular through pending automatic restart, manual takeover and loop-off',async()=>{
 const f=await playingFixture(),waiting=[];
 f.context.waitAudio=()=>new Promise(resolve=>waiting.push(resolve));
 vm.runInContext('ensureAudio=waitAudio;',f.context);
 deliverEndFrame(f);assert.equal(f.pendingFrames.size,0);assert.equal(waiting.length,1);
 const manual=vm.runInContext('play()',f.context);assert.equal(waiting.length,2);
 vm.runInContext('playback.setLoopPreview(false)',f.context);
 waiting[0]();await settle();assert.equal(f.pendingFrames.size,0);
 waiting[1]();await manual;assert.equal(f.pendingFrames.size,1);assert.ok(f.pendingFrames.has(f.evaluate('frameHandle')));
 vm.runInContext('pause()',f.context);assert.equal(f.pendingFrames.size,0);
});
test('card range Play preserves an explicit near-end start, then stops without looping or editing',async()=>{
 for(const [kind,speed] of [['demo',1],['video',4]]){
  const f=await fixture();
  vm.runInContext(`state.kind='${kind}';state.speed=${speed};state.fileName=${kind==='video'?"'source.mp4'":"''"};sources.videoFile=${kind==='video'?"{name:'source.mp4'}":'null'};
   state.overlays=[{...newCard(duration()/state.speed),id:'tail',start:11.98/state.speed,end:duration()/state.speed}];
   selectedCard='tail';effectTab='cards';history=[structuredClone(state)];future=[structuredClone(state)];
   globalThis.rangeSaves=0;scheduleSave=()=>rangeSaves++;validateProject(state);switchPanel('effects');playback.setLoopPreview(true);`,f.context);
  const before=f.evaluate('({state,history,future,selected,rangeSaves})');
  const controls=f.element('#panelContent #effectControls');
  assert.match(controls.innerHTML,/id="previewSceneCard"/);
  controls.querySelector('#previewSceneCard').onclick();await settle();
  assert.equal(f.evaluate('current'),11.98,'the explicit range start must not use whole-timeline rewind tolerance');
  assert.equal(f.evaluate('cardPlaybackEnd'),12/speed);assert.equal(f.evaluate('playing'),true);
  if(kind==='video')f.element('#sourceVideo').currentTime=11.984;
  deliverFrame(f,f.evaluate('frameHandle'),f.evaluate('lastTick')+4/speed);
  assert.equal(f.evaluate('playing'),true);
  if(kind==='video')f.element('#sourceVideo').currentTime=12;
  deliverFrame(f,f.evaluate('frameHandle'),f.evaluate('lastTick')+40/speed);await settle();
  assert.equal(f.evaluate('current'),12);assert.equal(f.evaluate('playing'),false);
  assert.equal(f.evaluate('cardPlaybackEnd'),null);assert.equal(f.evaluate('frameHandle'),0);
  assert.deepEqual(f.evaluate('({state,history,future,selected,rangeSaves})'),before);
 }
});

test('range-start fix retains ordinary/exact-end rewinds and cancelled preparation ownership',async()=>{
 const f=await fixture();
 for(const [time,end,expected] of [[11.98,null,0],[12,13,0],[11.8,12,11.8]]){
  vm.runInContext(`pause();current=${time};cardPlaybackEnd=${end};`,f.context);
  await vm.runInContext('play()',f.context);assert.equal(f.evaluate('current'),expected);assert.equal(f.evaluate('playing'),true);
 }
 vm.runInContext(`pause();state.overlays=[{...newCard(12),id:'tail',start:11.98,end:12}];selectedCard='tail';effectTab='cards';switchPanel('effects');`,f.context);
 let release;f.context.waitRangeAudio=()=>new Promise(resolve=>release=resolve);
 vm.runInContext('ensureAudio=waitRangeAudio;',f.context);
 f.element('#panelContent #effectControls #previewSceneCard').onclick();
 assert.equal(f.evaluate('current'),11.98);assert.equal(typeof release,'function');
 vm.runInContext('pause()',f.context);release();await settle();
 assert.equal(f.evaluate('current'),11.98);assert.equal(f.evaluate('playing'),false);assert.equal(f.evaluate('frameHandle'),0);
});
