import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { adjacentCut } from '../dist/timeline-view.mjs';
import { bindEditorKeyboard } from '../dist/editor-interactions.mjs';
import { createAppFixture } from './fixtures/app.mjs';
import { validateProject } from '../dist/core/project.mjs';

const clips = [{start:8,end:10},{start:1,end:4},{start:8,end:10}];
test('cut targets use cumulative edited lengths, strict direction and endpoints, not source ordering',()=>{
 for(const [current,direction,expected] of [[0,-1,null],[0,1,2],[1,-1,0],[1,1,2],[2,-1,0],[2,1,5],[3,-1,2],[3,1,5],[5,1,7],[7,1,null],[7,-1,5]])
  assert.equal(adjacentCut(clips,current,direction),expected);
 assert.equal(adjacentCut(clips,1e-20,-1),0);
 assert.equal(adjacentCut(clips,NaN,1),null);
 assert.equal(adjacentCut(clips,1,0),null);
 assert.equal(adjacentCut([],0,1),null);
 assert.equal(adjacentCut([{start:2.2,end:3.3}],0,1),3.3-2.2);
 assert.equal(adjacentCut([{start:2.2,end:3.3}],3.3-2.2,-1),0);
 assert.equal(adjacentCut([{start:0,end:Infinity}],0,1),null);
});
test('boundary comparison tolerates machine roundoff without skipping nearby genuine positions',()=>{
 const decimal=[{start:0,end:.1},{start:0,end:.2},{start:0,end:.1}];
 const boundary=.1+.2;
 assert.equal(adjacentCut(decimal,.3,1),.4);
 assert.equal(adjacentCut(decimal,boundary,-1),.1);
 assert.equal(adjacentCut(decimal,boundary-1e-10,1),boundary);
 assert.equal(adjacentCut(decimal,boundary+1e-10,-1),boundary);
 const far=[{start:0,end:86400},{start:0,end:.1}];
 assert.equal(adjacentCut(far,86400-1e-7,1),86400);
 assert.equal(adjacentCut(far,86400+1e-7,-1),86400);
});
test('bracket shortcuts are isolated from native input, IME, modifiers and unavailable actions',()=>{
 let handler,blocked=false,busy=false,accept=true;const calls=[];
 bindEditorKeyboard({addEventListener(_,fn){handler=fn;}},{blocked:()=>blocked,stepBlocked:()=>busy,navigateCut:direction=>{calls.push(direction);return accept;}});
 const press=(key,extra={})=>{let prevented=false;handler({key,target:{tagName:'BODY'},preventDefault(){prevented=true;},...extra});return prevented;};
 assert.equal(press('['),true);assert.equal(press(']'),true);assert.deepEqual(calls,[-1,1]);calls.length=0;
 for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229},{defaultPrevented:true},...['INPUT','TEXTAREA','SELECT','SUMMARY'].map(tagName=>({target:{tagName}})),{target:{tagName:'SPAN',closest:()=>({})}},{target:{tagName:'DIV',isContentEditable:true}}])assert.equal(press(']',extra),false);
 blocked=true;assert.equal(press(']'),false);blocked=false;busy=true;assert.equal(press(']'),false);busy=false;
 assert.deepEqual(calls,[]);accept=false;assert.equal(press(']'),false);
});
test('actual transport cut buttons pause and seek without project, selection, trim, history or save changes',async()=>{
 const {context,evaluate,element}=await createAppFixture();context.cutClips=clips;
 vm.runInContext("state.clips=cutClips;state.speed=2;current=3;selected=1;history=[];future=[];renderTimeline();renderInspector();",context);
 vm.runInContext('globalThis.navigationSaves=0;scheduleSave=()=>navigationSaves++;',context);
 element('#trimStart').value='1.2';element('#trimEnd').value='3.8';
 const before=evaluate('({state,selected,history,future,save:persistence.saveTimer})');
 for(const [id,expected] of [['#nextCutButton',5],['#nextCutButton',7],['#previousCutButton',5],['#previousCutButton',2],['#previousCutButton',0]]){
  vm.runInContext('playing=true',context);
  element(id).onclick();assert.equal(evaluate('current'),expected);assert.equal(evaluate('playing'),false);
  assert.equal(evaluate('navigationSaves'),0);
  assert.deepEqual(evaluate('({state,selected,history,future,save:persistence.saveTimer})'),before);
  assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],['1.2','3.8']);
 }
 for(const [at,id] of [[0,'#previousCutButton'],[7,'#nextCutButton']]){
  vm.runInContext(`current=${at};playing=true;`,context);const request=evaluate('playRequest');element(id).onclick();
  assert.equal(evaluate('playing'),true);assert.equal(evaluate('playRequest'),request);
 }
});
test('decimal cut navigation reaches the intended source clip in both directions without changing editing state',async()=>{
 for(const [ranges,boundary] of [
  [[{start:0,end:1.1},{start:2.2,end:3.3},{start:10,end:12}],2.2],
  [[{start:0,end:1.1},{start:10,end:12.2},{start:3,end:5}],3.299999999999999],
 ]){
  const {context,evaluate,element}=await createAppFixture();context.cutClips=ranges;
  vm.runInContext("state.kind='video';state.fileName='generated.mp4';state.duration=20;video.duration=20;state.clips=cutClips;state.speed=2;timelineCache=null;current=0;selected=1;history=[JSON.stringify(state)];future=[JSON.stringify(state)];renderTimeline();renderInspector();globalThis.navigationSaves=0;scheduleSave=()=>navigationSaves++;",context);
  validateProject(evaluate('state'));
  const before=evaluate('({state,selected,history,future,save:persistence.saveTimer})'),total=evaluate('duration()');
  element('#trimStart').value='2.4';
  for(const [id,time,index,source] of [
   ['#nextCutButton',1.1,1,ranges[1].start],['#nextCutButton',boundary,2,ranges[2].start],
   ['#nextCutButton',total,2,ranges[2].end],['#previousCutButton',boundary,2,ranges[2].start],
   ['#previousCutButton',1.1,1,ranges[1].start],['#previousCutButton',0,0,0],
  ]){
   element(id).onclick();
   assert.equal(element('#sourceVideo').currentTime,source);
   assert.equal(evaluate('current'),time);assert.equal(evaluate('locate(current).index'),index);
   assert.deepEqual(evaluate('({state,selected,history,future,save:persistence.saveTimer})'),before);
   assert.equal(evaluate('navigationSaves'),0);assert.equal(element('#trimStart').value,'2.4');
  }
 }
});
test('actual transport is inert while editor, recovery, media, export, modal or recording is busy',async()=>{
 const {context,evaluate,element}=await createAppFixture();context.cutClips=clips;
 vm.runInContext("Object.defineProperty(audioRecording,'requesting',{value:false,writable:true,configurable:true});Object.defineProperty(audioRecording,'current',{value:null,writable:true,configurable:true});",context);
 const states=['editorReady=false','exporting=true','loadingMedia=true','transcribing=true',"persistence.restorePhase='restoring'","persistence.restorePhase='failed'",'audioRecording.requesting=true','audioRecording.current={}','modal.open=true'];
 for(const busy of states){
  vm.runInContext("editorReady=true;exporting=false;loadingMedia=false;transcribing=false;persistence.restorePhase='ready';audioRecording.requesting=false;audioRecording.current=null;modal.open=false;state.clips=cutClips;current=3;playing=true;"+busy,context);
  const before=evaluate('({current,playing,playRequest,history,state})');
  element('#previousCutButton').onclick();element('#nextCutButton').onclick();
  assert.deepEqual(evaluate('({current,playing,playRequest,history,state})'),before,busy);
 }
});
test('mobile transport groups scrubber with boundary buttons and reserves the full second row',()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 assert.match(html,/<div class="cut-seek-group"><button[^>]*id="previousCutButton"[^>]*><\/button><input id="seek"[^>]*><button[^>]*id="nextCutButton"/);
 assert.match(html,/id="startButton"[^>]*data-i18n-aria-label="shell.start"/);
 const css=fs.readFileSync(new URL('../dist/styles/mobile-shell.css',import.meta.url),'utf8');
 assert.match(css,/--player-h:98px/);assert.match(css,/min-height:98px/);
 assert.match(css,/\.player-bar \.cut-seek-group\s*\{\s*order:10;\s*flex:1 0 100%/);
 assert.doesNotMatch(css,/\.player-bar input\[type=range\]\s*\{\s*order:10/);
});

test('actual bracket shortcuts seek cuts but not while recovery is failed, and leave endpoint playback running',async()=>{
 const {context,evaluate,documentEvents}=await createAppFixture();context.cutClips=clips;
 vm.runInContext('state.clips=cutClips;state.speed=.5;current=3;selected=1;',context);
 const press=key=>{let prevented=false;documentEvents.get('keydown')({key,target:{tagName:'BODY'},preventDefault(){prevented=true;}});return prevented;};
 assert.equal(press(']'),true);assert.equal(evaluate('current'),5);assert.equal(evaluate('selected'),1);
 assert.equal(press('['),true);assert.equal(evaluate('current'),2);
 vm.runInContext("persistence.restorePhase='failed';playing=true;",context);
 assert.equal(press(']'),false);assert.equal(evaluate('current'),2);assert.equal(evaluate('playing'),true);
 vm.runInContext("persistence.restorePhase='ready';current=7;playing=true;",context);
 assert.equal(press(']'),false);assert.equal(evaluate('playing'),true);
});
