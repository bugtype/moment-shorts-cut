import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale,translateFor} from '../dist/i18n.mjs';
import {createCanvasTrace} from './fixtures/canvas-trace.mjs';

const pointer=(x,y,extra={})=>({pointerId:7,button:0,clientX:x,clientY:y,...extra});
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


test('video drag tracks rendered displacement in full and framed regions without changing other data', async () => {
 for (const [layout, top, bottom, scale, zoom, fit] of [
  ['full', .25, .79, .5, 1, 'cover'],
  ['framed', .25, .79, .5, 1, 'cover'],
  ['framed', .15, .69, 1, 2, 'contain'],
  ['framed', .4, .65, .5, 1, 'cover'],
 ]) {
  const f=await createAppFixture(), trace=createCanvasTrace(), canvas=f.element('#preview');
  f.element('#sourceVideo').traceName='source-video';
  f.context.captureComposition=(draw,args)=>draw(trace.context,...args);
  vm.runInContext(`
   state=initial();state.kind='video';state.fileName='generated.mp4';
   state.design.layout='${layout}';state.design.top=${top};state.design.bottom=${bottom};
   state.fit='${fit}';state.effects.motion='none';state.zoom=${zoom};state.panX=.1;state.panY=-.1;
   sources.videoFile={name:'generated.mp4',size:1};current=1;switchPanel('settings');history=[];future=[];
   globalThis.dragSaves=0;scheduleSave=()=>dragSaves++;
   const originalDraw=composition.draw;composition.draw=(_target,...args)=>captureComposition(originalDraw,args);
   resizePreview();
  `,f.context);
  canvas.getBoundingClientRect=()=>({left:13,top:17,width:canvas.width*scale,height:canvas.height*scale});
  const sourceDraw=()=>trace.events.findLast(event=>event[1]==='drawImage'&&event[2]==='source-video');
  const beforeDraw=sourceDraw(), before=f.evaluate('state');
  assert.ok(beforeDraw,'the actual app painted the ready source');
  canvas.onpointerdown(pointer(100,100));canvas.onpointermove(pointer(120,140));
  assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('dragSaves'),0);
  for(const [id,callback] of [...f.pendingFrames]){f.pendingFrames.delete(id);callback(1000);}
  const movedDraw=sourceDraw();
  for(const [index,delta] of [[3,20],[4,40]])
   assert.ok(Math.abs((movedDraw[index]-beforeDraw[index])*scale-delta)<1e-9,`${layout}: source follows pointer on axis ${index}`);
  const after=f.evaluate('state'), expected=structuredClone(before);
  expected.panX=after.panX;expected.panY=after.panY;
  assert.deepEqual(after,expected,'only pan coordinates changed');assert.equal(f.evaluate('current'),1);
  canvas.onpointercancel(pointer(120,140));canvas.onlostpointercapture(pointer(120,140));
  assert.equal(f.evaluate('dragSaves'),1);assert.equal(f.evaluate('history.length'),1);
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
  vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state'),after);
 }
});

test('auxiliary preview input preserves playback and Redo; subsequent primary drag still edits', async () => {
 for (const button of [1, 2]) {
  const f=await fixture();
  vm.runInContext('future=[JSON.stringify(state)]',f.context);
  await vm.runInContext('play()',f.context);
  assert.equal(f.evaluate('playing'),true);
  const captures=[];f.canvas.setPointerCapture=id=>captures.push(id);
  const state=()=>f.evaluate('({state,history,future,current,selected,playing,playRequest,axisSaves,frameHandle})');
  const before=state(),focus=f.doc.activeElement,frames=[...f.pendingFrames.keys()];
  const buttons=button===1?4:2;
  f.canvas.onpointerdown(pointer(0,0,{pointerType:'mouse',button,buttons}));
  f.canvas.onpointermove(pointer(20,20,{button:-1,buttons}));
  f.canvas.onpointerup(pointer(20,20,{button,buttons:0}));
  f.canvas.onlostpointercapture(pointer(20,20));
  assert.deepEqual(state(),before);assert.deepEqual(captures,[]);
  assert.deepEqual([...f.pendingFrames.keys()],frames);assert.equal(f.doc.activeElement,focus);
  f.canvas.onpointerdown(pointer(0,0));f.canvas.onpointermove(pointer(20,20,{button:-1}));f.canvas.onpointerup(pointer(20,20));
  assert.equal(f.evaluate('playing'),false);assert.deepEqual(captures,[7]);
  assert.notEqual(f.evaluate('state.panX'),before.state.panX);
  assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('future.length'),0);assert.equal(f.evaluate('axisSaves'),1);
  const edited=f.evaluate('state');
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before.state);
  vm.runInContext('undo(true)',f.context);assert.deepEqual(f.evaluate('state'),edited);
 }
});
