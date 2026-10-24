import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { File } from 'node:buffer';
import { createAppFixture } from './fixtures/app.mjs';

function picker(f,kind){
 const input=f.element('#'+kind+'Input');let value='';
 // Model native clearing: FileList must not be read again after value=''.
 Object.defineProperty(input,'value',{get:()=>value,set:next=>{value=next;if(next==='')input.files=[];},configurable:true});
 return {input,choose(file){input.files=[file];input.value='C:\\fakepath\\'+file.name;return input.onchange({target:input});}};
}
const snapshot=f=>f.evaluate('({state,history,future,current,selected,videoName:sources.videoFile?.name||null,audioName:sources.audioFile?.name||null,timer:persistence.saveTimer})');

test('video and audio pickers clear before every busy/recovery refusal without modifying project or media',async()=>{
 for(const kind of ['video','audio']){
  const f=await createAppFixture(),p=picker(f,kind),file={name:kind+'.'+(kind==='video'?'mp4':'wav'),type:kind+'/test',size:10};
  for(const refusal of ['transcribing=true','loadingMedia=true','exporting=true',"persistence.restorePhase='failed'","persistence.restorePhase='restoring'"]){
   vm.runInContext("transcribing=false;loadingMedia=false;exporting=false;persistence.restorePhase='ready';"+refusal,f.context);
   const before=snapshot(f),pending=p.choose(file);
   assert.equal(p.input.value,'',refusal);assert.deepEqual(p.input.files,[]);assert.equal(typeof pending.then,'function');
   await pending;assert.deepEqual(snapshot(f),before,kind+': '+refusal);
  }
 }
});
test('early video type and both size refusals reset pickers and preserve current editing state',async()=>{
 for(const [kind,file] of [['video',{name:'notes.txt',type:'text/plain',size:10}],['video',{name:'large.mp4',type:'video/mp4',size:501*1024*1024}],['audio',{name:'large.wav',type:'audio/wav',size:101*1024*1024}]]){
  const f=await createAppFixture(),p=picker(f,kind),before=snapshot(f);
  await p.choose(file);assert.equal(p.input.value,'');assert.deepEqual(snapshot(f),before);
 }
});
test('the identical captured File can be retried after busy rejection through each actual loader',async()=>{
 for(const kind of ['video','audio']){
  const f=await createAppFixture(),p=picker(f,kind),file=new File(['fixture'], 'retry.'+(kind==='video'?'mp4':'wav'), {type:kind==='video'?'video/mp4':'audio/wav'});
  f.context.retryFile=file;
  vm.runInContext('transcribing=true;',f.context);await p.choose(file);assert.equal(p.input.value,'');
  vm.runInContext('transcribing=false;sources.setVideoFile=async file=>{if(file!==retryFile)throw new Error("lost captured file");};sources.waitForMedia=async()=>{};',f.context);
  f.context.Audio=class {removeAttribute(){}load(){}};
  f.context.URL={createObjectURL:received=>{assert.equal(received,file);return 'blob:retry';},revokeObjectURL(){}};
  const pending=p.choose(file);assert.equal(p.input.value,'');assert.equal(typeof pending.then,'function');await pending;
  assert.equal(f.evaluate(kind==='video'?'sources.videoFile===retryFile':'sources.audioFile===retryFile'),true);
  assert.equal(f.evaluate(kind==='video'?'state.fileName':'state.audioName'),file.name);
 }
});
test('audio format failure remains owned by media validation and cancellation has no side effects',async()=>{
 const f=await createAppFixture(),p=picker(f,'audio'),file={name:'invalid.wav',type:'audio/wav',size:10};
 let released=0;f.context.Audio=class {removeAttribute(){}load(){}};
 f.context.URL={createObjectURL:()=> 'blob:invalid',revokeObjectURL(){released++;}};
 vm.runInContext('sources.waitForMedia=async()=>{throw new Error("unsupported audio");};',f.context);
 const before=snapshot(f);await p.choose(file);assert.equal(p.input.value,'');assert.equal(released,1);assert.deepEqual(snapshot(f),before);
 for(const kind of ['video','audio']){
  const input=f.element('#'+kind+'Input');input.files=[];
  const before=snapshot(f),message=f.element('#toast').textContent;
  assert.equal(input.onchange({target:input}),undefined);
  assert.deepEqual(snapshot(f),before);assert.equal(f.element('#toast').textContent,message);
 }
});
