import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createCaptionInspectionDialog} from '../dist/caption-inspection-dialog.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {createAppFixture} from './fixtures/app.mjs';
function fixture() {
 let project=createDemoProject(),blocked=false;const nodes=new Map(),events=[];
 const mount=(html,root=false)=>{
  if(root)nodes.clear();else for(const key of nodes.keys())if(/^#inspect(Caption|Occurrence)/.test(key))nodes.delete(key);
  for(const match of html.matchAll(/\bid="([^"]+)"/g)){
   const node={value:'',focus(){events.push(['focus',match[1]]);}};
   let contents='';Object.defineProperty(node,'innerHTML',{get:()=>contents,set:value=>{contents=value;mount(value);}});nodes.set('#'+match[1],node);
  }
 };
 const query=selector=>nodes.get(selector)||null;
 const modal={open:false,onclose:null,close(){this.open=false;events.push(['close']);this.onclose?.();}};
 const openModal=(title,body)=>{modal.onclose?.();modal.onclose=null;mount(body,true);modal.open=true;events.push(['open',title]);};
 const controller=createCaptionInspectionDialog({getProject:()=>project,query,modal,openModal,blocked:()=>blocked,pause:()=>events.push(['pause']),seek:t=>events.push(['seek',t]),focusCaption:i=>{assert.equal(modal.open,false);events.push(['caption',i]);},toast:t=>events.push(['toast',t])});
 return {controller,query,modal,events,project:()=>project,set:p=>project=p,block:b=>blocked=b,replace:()=>openModal('Other','<button id="other">Other</button>'),run(value='1'){query('#captionInspectionThreshold').value=value;query('#runCaptionInspection').onclick();}};
}
test('blank threshold and invalid values do not inspect; reports are bounded and rounded only for display',()=>{
 const f=fixture();f.project().captions=Array.from({length:30},(_,i)=>({start:i/10,end:(i+1)/10,text:'ABC'}));const before=structuredClone(f.project());f.controller.open();assert.equal(f.query('#captionInspectionThreshold').value,'');
 for(const value of ['','0','-1','NaN','Infinity']){f.run(value);assert.equal(f.query('#inspectCaption0'),null);}
 f.run('1');const html=f.query('#captionInspectionResults').innerHTML;assert.match(html,/출력 자막 30개 · 기준 초과 30개 · 생략 10개/);assert.equal([...html.matchAll(/id="inspectCaption/g)].length,20);assert.equal(f.query('#inspectCaption20'),null);assert.deepEqual(f.project(),before);
 const stale=f.query('#inspectCaption0').onclick;f.query('#captionInspectionThreshold').oninput();stale();assert.ok(!f.events.some(e=>e[0]==='caption'));
});
test('occurrence navigation uses output seconds converted to pre-speed and focus-only does not seek',()=>{
 const f=fixture();f.project().speed=2;f.project().clips=[{start:0,end:2},{start:0,end:2}];f.project().captions=[{start:0,end:1,text:'AB'}];const before=structuredClone(f.project());
 f.controller.open();f.run();const old=f.query('#inspectOccurrence1').onclick;old();assert.deepEqual(f.events.slice(-4),[['close'],['pause'],['seek',2],['caption',0]]);old();assert.equal(f.events.filter(e=>e[0]==='seek').length,1);
 f.controller.open();f.run();const n=f.events.length;f.query('#inspectCaption1').onclick();assert.deepEqual(f.events.slice(n),[['close'],['caption',0]]);assert.deepEqual(f.project(),before);
 f.project().captions=[{start:1,end:2,text:'AB',basis:'timeline'}];f.controller.open();f.run();f.query('#inspectOccurrence0').onclick();assert.deepEqual(f.events.slice(-4),[['close'],['pause'],['seek',1],['caption',0]]);
});
test('same-object edits, API replacements and undo-like replacements invalidate before any navigation',()=>{
 for(const change of [f=>f.project().captions[0].text='Edited',f=>f.set(structuredClone(f.project())),f=>{const old=structuredClone(f.project());f.project().speed=2;f.set(old);}]){
  const f=fixture();f.controller.open();f.run();const old=f.query('#inspectOccurrence0').onclick;change(f);old();assert.match(f.query('#captionInspectionResults').innerHTML,/다시 검사/);assert.ok(!f.events.some(e=>e[0]==='seek'||e[0]==='caption'));old();
  f.run();f.query('#inspectCaption0').onclick();assert.ok(f.events.some(e=>e[0]==='caption'));
 }
});
test('closed/replaced dialogs, stale report buttons and busy navigation never act',()=>{
 for(const close of [f=>f.modal.close(),f=>f.replace(),f=>f.controller.open()]){
  const f=fixture();f.controller.open();f.run();const old=f.query('#inspectOccurrence0').onclick,oldRun=f.query('#runCaptionInspection').onclick;close(f);old();oldRun();assert.ok(!f.events.some(e=>e[0]==='seek'||e[0]==='caption'));
 }
 const f=fixture();f.controller.open();f.run();const stale=f.query('#inspectOccurrence0').onclick;f.run('2');stale();assert.ok(!f.events.some(e=>e[0]==='seek'));
 f.block(true);f.query('#inspectOccurrence0').onclick();assert.equal(f.modal.open,true);assert.ok(!f.events.some(e=>e[0]==='seek'));f.block(false);f.query('#inspectOccurrence0').onclick();assert.ok(f.events.some(e=>e[0]==='seek'));
});
test('inspection captures latest project at run, not at dialog opening',()=>{
 const f=fixture();f.controller.open();const p=createDemoProject();p.captions=[{start:0,end:1,text:'AB'}];f.set(p);f.run();assert.match(f.query('#captionInspectionResults').innerHTML,/출력 자막 1개/);f.query('#inspectCaption0').onclick();assert.ok(f.events.some(e=>e[0]==='caption'));
});
test('actual tools action inspects without edits and navigates an off-page authored cue after closing',async()=>{
 const {context,evaluate,element,doc}=await createAppFixture();
 vm.runInContext("state.duration=120;state.clips=[{start:0,end:120}];state.captions=Array.from({length:51},(_,i)=>({start:i,end:i+1,text:i===50?'LONG CAPTION':'A'}));history=[];future=[];current=2;globalThis.saves=0;scheduleSave=()=>saves++;switchPanel('captions');",context);
 const before=evaluate('({state,history,future,current})');element('#inspectCaptions').onclick();assert.equal(element('#modal').open,true);element('#captionInspectionThreshold').value='2';element('#runCaptionInspection').onclick();element('#inspectCaption0').onclick();
 assert.equal(element('#modal').open,false);assert.equal(doc.activeElement,element('[data-caption-text="50"]'));assert.match(element('#panelContent').innerHTML,/data-caption-text="50"/);assert.deepEqual(evaluate('({state,history,future,current})'),before);assert.equal(evaluate('saves'),0);
});

test('queued close from a previous dialog does not invalidate the immediately reopened inspection',()=>{
 const f=fixture();let queued;
 f.modal.close=function(){this.open=false;queued=()=>this.onclose?.();};
 f.controller.open();f.run();const old=f.query('#inspectCaption0').onclick;
 f.modal.close();f.controller.open();queued();
 assert.equal(f.modal.open,true);f.run();assert.ok(f.query('#inspectCaption0'));
 old();assert.ok(!f.events.some(e=>e[0]==='caption'));
 f.query('#inspectCaption0').onclick();assert.ok(f.events.some(e=>e[0]==='caption'));
});

test('actual app failed recovery allows read-only inspection but blocks result navigation',async()=>{
 const {context,evaluate,element}=await createAppFixture();
 vm.runInContext("history=[];future=[];current=2;globalThis.saves=0;scheduleSave=()=>saves++;switchPanel('captions');Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'});",context);
 const before=evaluate('({state,history,future,current})');
 element('#inspectCaptions').onclick();element('#captionInspectionThreshold').value='1';element('#runCaptionInspection').onclick();
 assert.match(element('#captionInspectionResults').innerHTML,/기준 초과/);
 element('#inspectOccurrence0').onclick();assert.equal(element('#modal').open,true);assert.deepEqual(evaluate('({state,history,future,current})'),before);assert.equal(evaluate('saves'),0);
});
