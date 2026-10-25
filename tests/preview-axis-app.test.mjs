import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale,translateFor} from '../dist/i18n.mjs';

const pointer=(x,y,extra={})=>({pointerId:7,clientX:x,clientY:y,...extra});
async function fixture(mode='video'){
 const f=await createAppFixture();
 vm.runInContext(`state=initial();state.overlays=${mode==='scene'?"[{...newCard(12),id:'axis',role:'free',enabled:true,x:.5,y:.02}]":'[]'};
  state.panX=state.captionX=state.design.title.x=state.design.credit.x=.5;
  state.panY=state.captionY=state.design.title.y=state.design.credit.y=.02;
  state.design.title.enabled=state.design.credit.enabled=true;current=1;selectedCard='axis';effectTab='cards';
  textLayer='${['title','credit','caption'].includes(mode)?mode:'title'}';switchPanel('${mode==='scene'?'effects':mode==='video'?'settings':'text'}');
  history=[];future=[];globalThis.axisSaves=0;scheduleSave=()=>axisSaves++;`,f.context);
 f.canvas=f.element('#preview');f.canvas.getBoundingClientRect=()=>({width:100,height:200});
 f.path=mode==='video'?'state.panX':mode==='caption'?'state.captionX':mode==='scene'?'state.overlays[0].x':`state.design.${mode}.x`;
 return f;
}

test('actual app axis drag uses the selected layer and one complete undo/redo transaction',async()=>{
 for(const mode of ['video','title','credit','caption','scene']){
  const f=await fixture(mode),before=f.evaluate('state');
  f.canvas.onpointerdown(pointer(0,0,{shiftKey:true}));
  f.canvas.onpointermove(pointer(20,2));f.canvas.onpointermove(pointer(30,150));
  assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('axisSaves'),0);
  f.canvas.onpointerup(pointer(30,150));f.canvas.onlostpointercapture(pointer(30,150));
  const after=f.evaluate('state'),expected=structuredClone(before);
  const keys=f.path.replace(/^state\./,'').replace('[0]','.0').split('.');
  let target=expected;for(const key of keys.slice(0,-1))target=target[key];target[keys.at(-1)]=.8;
  assert.deepEqual(after,expected,mode);assert.equal(f.evaluate('axisSaves'),1);
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('future.length'),1);
  vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state'),after);assert.equal(f.evaluate('history.length'),1);
 }
});

test('actual app retains blocked export/restore and stale-project protections for Shift dragging',async()=>{
 for(const condition of ['exporting=true',"persistence.restorePhase='restoring'"]){
  const f=await fixture();vm.runInContext(condition,f.context);const before=f.evaluate('({state,history,axisSaves})');
  f.canvas.onpointerdown(pointer(0,0,{shiftKey:true}));f.canvas.onpointermove(pointer(20,2));f.canvas.onpointerup(pointer(20,2));
  assert.deepEqual(f.evaluate('({state,history,axisSaves})'),before);
 }
 const f=await fixture();f.canvas.onpointerdown(pointer(0,0,{shiftKey:true}));
 vm.runInContext('state=structuredClone(state)',f.context);const before=f.evaluate('({state,history,axisSaves})');
 f.canvas.onpointermove(pointer(20,2));f.canvas.onpointerup(pointer(20,2));assert.deepEqual(f.evaluate('({state,history,axisSaves})'),before);
});

test('failed-recovery storage lock is not relaxed by the new gesture',async()=>{
 for(const valid of [true,false]){
  const f=await fixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);
  vm.runInContext(`persistence.restorePhase='failed';persistence.recoveryValid=${valid};scheduleSave=()=>persistence.scheduleSave()`,f.context);
  f.canvas.onpointerdown(pointer(0,0,{shiftKey:true}));f.canvas.onpointermove(pointer(20,2));f.canvas.onpointerup(pointer(20,2));
  vm.runInContext('saveProject(false)',f.context);
  assert.equal(f.evaluate('persistence.restorePhase'),'failed');assert.deepEqual(writes,[]);
 }
});

test('Guide exposes localized Shift instruction and locale changes leave gesture state and project alone',async()=>{
 try{
  for(const locale of ['ko','en','zh-CN']){
   const f=await fixture();setLocale(locale,{persist:false});f.element('#helpButton').onclick();
   assert.ok(f.element('#modal').innerHTML.includes(translateFor(locale,'shell.axisDrag')));
   assert.match(f.element('#modal').innerHTML,/class="keyboard-key">Shift<\/span>/);
   f.element('#modal').close();f.canvas.onpointerdown(pointer(0,0,{shiftKey:true}));f.canvas.onpointermove(pointer(20,2));
   const before=f.evaluate('({state,history,axisSaves})');setLocale(locale==='en'?'ko':'en',{persist:false});
   assert.deepEqual(f.evaluate('({state,history,axisSaves})'),before);
   f.canvas.onpointermove(pointer(30,180));f.canvas.onpointerup(pointer(30,180));
   assert.equal(f.evaluate('state.panX'),.8);assert.equal(f.evaluate('state.panY'),.02);assert.equal(f.evaluate('history.length'),1);
  }
 }finally{initLocale();}
});
