import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
async function fixture(setup='') {
 const f=await createAppFixture();
 vm.runInContext(`state.clips=[{start:0,end:2},{start:3,end:6},{start:8,end:12},{start:0,end:2}];timelineCache=null;selected=1;current=3;history=[];future=[];${setup}`,f.context);
 f.open=()=>f.element('#removeClipRangeButton').onclick();
 f.confirm=(first,last)=>{f.element('#clipRangeFirst').value=String(first);f.element('#clipRangeLast').value=String(last);f.element('#confirmClipRange').onclick();};
 f.snapshot=()=>f.evaluate('({state,history,future,current,selected,playing})');return f;
}
test('inclusive first/middle/last ranges use one shared edit, exact retiming and undo/redo',async()=>{
 for(const [first,last] of [[1,2],[2,3],[3,4],[2,2]]){
  const f=await fixture(),before=f.evaluate('state');f.open();assert.equal(f.element('#clipRangeFirst').value,'2');assert.equal(f.element('#clipRangeLast').value,'2');
  const clips=before.clips.filter((_,i)=>i<first-1||i>=last),expected=prepareCommand(before,'timeline.replace',{clips}).project;
  f.confirm(first,last);assert.deepEqual(f.evaluate('state'),expected);assert.equal(f.evaluate('history.length'),1);
  const selected=Math.min(first-1,clips.length-1);assert.equal(f.evaluate('selected'),selected);assert.equal(f.evaluate('current'),clips.slice(0,selected).reduce((sum,c)=>sum+c.end-c.start,0));assert.equal(!!f.element('#modal').open,false);
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state'),expected);
 }
});
test('invalid, all-clips, cancel and IME preserve state and drafts',async()=>{
 const f=await fixture();f.element('#trimStart').value='draft';const before=f.snapshot();f.open();
 for(const [a,b] of [['',2],[0,2],[3,2],[1,5],[1,4],[1.5,2],['Infinity',2]]){f.confirm(a,b);assert.deepEqual(f.snapshot(),before);assert.equal(f.element('#modal').open,true);}
 f.element('#clipRangeFirst').oncompositionstart();f.confirm(2,3);assert.deepEqual(f.snapshot(),before);f.element('#clipRangeFirst').oncompositionend();
 f.element('#clipRangeLast').onkeydown({key:'Enter',ctrlKey:true});assert.deepEqual(f.snapshot(),before);
 f.element('#cancelClipRange').onclick();assert.deepEqual(f.snapshot(),before);assert.equal(f.element('#trimStart').value,'draft');
});
test('stale ownership, closed callbacks, queued close and busy states cannot remove clips',async()=>{
 for(const mutation of ['state=structuredClone(state)','state.speed=2','selected=0',"panel='text'",'sources.videoFile={}','sources.audioFile={}','exporting=true','loadingMedia=true','transcribing=true',"Object.defineProperty(persistence,'restorePhase',{get:()=> 'restoring'})", "Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'})"]){
  const f=await fixture();f.open();vm.runInContext(mutation,f.context);const before=f.snapshot();f.confirm(2,3);assert.deepEqual(f.snapshot(),before);
 }
 const f=await fixture();f.open();const old=f.element('#confirmClipRange').onclick;f.element('#cancelClipRange').onclick();f.open();f.element('#modal').onclose();const before=f.snapshot();old();assert.deepEqual(f.snapshot(),before);f.confirm(2,3);assert.equal(f.evaluate('state.clips.length'),2);
});
test('1000 repeated ranges remove by position; a final survivor disables action',async()=>{
 const f=await fixture('state.clips=Array.from({length:1000},()=>({start:1,end:2}));timelineCache=null;');f.open();f.confirm(1,999);
 assert.equal(f.evaluate('state.clips.length'),1);assert.equal(f.evaluate('history.length'),1);assert.equal(f.element('#removeClipRangeButton').disabled,true);assert.equal(f.context.document.activeElement,f.element('#trimButton'));
});
test('valid failed recovery permits metadata-only range removal without persistence writes',async()=>{
 const f=await fixture("Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'});Object.defineProperty(persistence,'recoveryValid',{get:()=>true});");
 vm.runInContext('globalThis.rangeWrites=0;projectStore.setMedia=async()=>rangeWrites++;localStorage.setItem=()=>rangeWrites++;',f.context);
 const before=f.evaluate('state');f.open();f.confirm(2,3);assert.equal(f.evaluate('state.clips.length'),2);assert.equal(f.evaluate('history.length'),1);
 await vm.runInContext('saveProject(true)',f.context);vm.runInContext('persistMedia();scheduleSave();',f.context);await Promise.resolve();assert.equal(f.evaluate('rangeWrites'),0);assert.equal(f.evaluate('persistence.restorePhase'),'failed');assert.equal(f.evaluate('persistence.recoveryValid'),true);assert.deepEqual(f.evaluate('state.captions'),before.captions);
});

test('Frame panel exposes range removal and restores current enabled control focus',async()=>{
 const f=await fixture();vm.runInContext("switchPanel('settings')",f.context);
 assert.match(f.element('#panelContent').innerHTML,/panelRemoveClipRange/);
 f.element('#panelRemoveClipRange').id='panelRemoveClipRange';
 f.element('#panelRemoveClipRange').onclick();f.element('#cancelClipRange').onclick();assert.equal(f.context.document.activeElement,f.element('#panelRemoveClipRange'));
 f.element('#panelRemoveClipRange').onclick();f.confirm(1,3);assert.equal(f.element('#panelRemoveClipRange').disabled,true);assert.equal(f.context.document.activeElement,f.element('#panelTrimApply'));
});
test('retained Frame panel handlers reject changed selection, replacement and IME',async()=>{
 for(const change of ['selected=0','state=structuredClone(state)',"switchPanel('text')"]){
  const f=await fixture();vm.runInContext("switchPanel('settings')",f.context);const old=f.element('#panelRemoveClipRange').onclick;
  vm.runInContext(change,f.context);old();assert.equal(!!f.element('#modal').open,false);
 }
 const f=await fixture();vm.runInContext("switchPanel('settings')",f.context);f.element('#panelRemoveClipRange').onclick({isComposing:true});assert.equal(!!f.element('#modal').open,false);
});

test('controller restores focus to replacement Frame nodes only after final render',async()=>{
 const {createClipRange}=await import('../dist/clip-range.mjs');
 const {createDemoProject}=await import('../dist/core/project.mjs');
 const nodes=new Map();let focused=null;
 const node=id=>({id,value:'',disabled:false,focus(){focused=this;},setAttribute(){},removeAttribute(){},setCustomValidity(){}});
 const mount=(id)=>{const n=node(id);nodes.set('#'+id,n);return n;};
 const app={state:createDemoProject(),selected:1,panel:'settings',editorReady:true,sources:{},persistence:{restorePhase:'ready'},audioRecording:{},modal:{open:false,close(){this.open=false;}},query:selector=>nodes.get(selector)||null,
 modalOpen(){this.modal.open=true;for(const id of ['clipRangeFirst','clipRangeLast','confirmClipRange','cancelClipRange'])mount(id);},
 runEditorCommand(name,args){this.state=prepareCommand(this.state,name,args).project;return true;},
 renderTimeline(){},renderInspector(){},renderPanel(){mount('panelRemoveClipRange').disabled=this.state.clips.length===1;mount('panelTrimApply');},seekTo(){},toast(){}};
 app.state.clips=[{start:0,end:2},{start:3,end:6},{start:8,end:12}];
 const old=mount('panelRemoveClipRange');mount('panelTrimApply');createClipRange(app).open(old);
 nodes.get('#clipRangeFirst').value='2';nodes.get('#clipRangeLast').value='2';nodes.get('#confirmClipRange').onclick();
 assert.notEqual(nodes.get('#panelRemoveClipRange'),old);assert.equal(focused,nodes.get('#panelRemoveClipRange'));
});
