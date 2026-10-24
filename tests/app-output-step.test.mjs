import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

function press(f,key,extra={}){
 let prevented=false;
 f.documentEvents.get('keydown')({target:{tagName:'BODY'},key,code:key,preventDefault(){prevented=true;},...extra});
 return prevented;
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
test('punctuation moves 1/30 output seconds at each speed, pauses, clamps and crosses cuts without edits',async()=>{
 const f=await createAppFixture(),{context,evaluate}=f;
 vm.runInContext('state.clips=[{start:1,end:3},{start:7,end:10}];history=[];future=[];globalThis.saveCalls=0;scheduleSave=()=>saveCalls++;',context);
 for(const speed of [.25,1,2,4]){
  vm.runInContext(`state.speed=${speed};current=1;playing=true;`,context);
  const before=evaluate('state');assert.equal(press(f,'.'),true);near(evaluate('current'),1+speed/30);assert.equal(evaluate('playing'),false);
  press(f,',');near(evaluate('current'),1);
  vm.runInContext(`current=2-${speed}/60`,context);press(f,'.');near(evaluate('current'),2+speed/60);
  assert.equal(evaluate('locate(current).index'),1);
  vm.runInContext('current=0',context);press(f,',');assert.equal(evaluate('current'),0);
  vm.runInContext('current=duration()',context);press(f,'.');assert.equal(evaluate('current'),5);
  assert.deepEqual(evaluate('state'),before);assert.equal(evaluate('history.length'),0);assert.equal(evaluate('future.length'),0);assert.equal(evaluate('saveCalls'),0);
 }
 vm.runInContext('current=1;state.speed=4',context);press(f,'ArrowRight');assert.equal(evaluate('current'),2);press(f,'ArrowLeft');assert.equal(evaluate('current'),1);
});

test('actual app ignores output-step keys during modal/export/restore/load/transcribe/record operations',async()=>{
 const f=await createAppFixture(),{context,evaluate}=f;
 vm.runInContext('Object.defineProperty(audioRecording,"requesting",{value:false,writable:true});Object.defineProperty(audioRecording,"current",{value:null,writable:true});',context);
 const states=[['modal.open',true,false],['exporting',true,false],['persistence.restorePhase','restoring','ready'],['loadingMedia',true,false],['transcribing',true,false],['audioRecording.requesting',true,false],['audioRecording.current',{},null]];
 for(const [field,on,off] of states){
  vm.runInContext(`current=1;playing=true;${field}=${JSON.stringify(on)}`,context);
  assert.equal(press(f,'.'),false,field);assert.equal(evaluate('current'),1);assert.equal(evaluate('playing'),true);
  vm.runInContext(`${field}=${JSON.stringify(off)}`,context);
 }
 for(const extra of [{defaultPrevented:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229},{target:{tagName:'SPAN',isContentEditable:true}},{target:{tagName:'SPAN',closest:()=>({})}}]){
  assert.equal(press(f,',',extra),false);assert.equal(evaluate('current'),1);
 }
});
