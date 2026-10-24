import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionMedia} from '../dist/session-media.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
function element(duration=12){
 const listeners=new Map();let src=null;
 return {duration,readyState:2,currentSrc:'',get src(){return src||'';},set src(value){src=value;this.currentSrc=value;},
 getAttribute:()=>src,removeAttribute(){src=null;this.currentSrc='';},load(){},
 addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
 removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
 emit(name){for(const fn of [...listeners.get(name)||[]])fn();},count(){return [...listeners.values()].reduce((n,s)=>n+s.size,0);}};
}
function fixture(){
 let project={...createDemoProject(),kind:'video',fileName:'original.mp4',audioName:'voice.wav'},busy=false;
 const baseline=JSON.stringify(project),persistence={restorePhase:'failed',recoveryValid:true,recoveryBaseline:baseline,restoreMessage:'unchanged',recoveryBlocked(){return true;}};
 const video=element(),audio=element(5);video.src='old-video';audio.src='old-audio';
 const sources={videoFile:{name:'old'},audioFile:{name:'old audio'},sourceURL:'old-video',audioURL:'old-audio'},beforeSources={...sources};
 const probes=[],revoked=[],timers=new Set();let url=0;
 const api=createSessionMedia({getProject:()=>project,persistence,sources,video,audio,blocked:()=>busy},{
 createVideo:()=>{const p=element();probes.push(p);return p;},createAudio:()=>{const p=element(5);probes.push(p);return p;},
 createURL:()=>`new-${++url}`,revokeURL:u=>revoked.push(u),setTimer:fn=>{timers.add(fn);return fn;},clearTimer:fn=>timers.delete(fn)});
 const files={video:{name:'original.mp4',size:10},audio:{name:'voice.wav',size:10}};
 const start=()=>api.connect(files,{confirmed:true});
 const probe=async()=>{probes.slice(-2).forEach(p=>p.emit('loadeddata'));await Promise.resolve();await Promise.resolve();};
 const attach=()=>{video.emit('loadeddata');audio.emit('loadeddata');};
 return{api,files,start,probe,attach,probes,revoked,timers,video,audio,sources,beforeSources,persistence,baseline,
 project:()=>project,replace:p=>{project=p;},block:v=>{busy=v;}};
}
test('both probes and both fixed live elements must load before adopting session sources; project/persistence unchanged',async()=>{
 const f=fixture(),before={...f.persistence};delete before.recoveryBlocked;
 const pending=f.start();assert.equal(f.api.mediaReady(),false);await f.probe();
 assert.equal(f.api.mediaReady(),false);assert.deepEqual(f.sources,f.beforeSources);
 f.video.emit('loadeddata');assert.equal(f.api.mediaReady(),false);f.audio.emit('loadeddata');
 assert.equal((await pending).ok,true);assert.equal(f.api.mediaReady(),true);
 assert.equal(JSON.stringify(f.project()),f.baseline);const after={...f.persistence};delete after.recoveryBlocked;assert.deepEqual(after,before);
 assert.deepEqual(f.revoked,['old-video','old-audio']);assert.equal(f.timers.size,0);
 assert.equal(f.sources.videoFile,f.files.video);assert.equal(f.sources.audioFile,f.files.audio);
 f.replace({...f.project(),name:'Edited metadata',speed:2});assert.equal(f.api.mediaReady(),true);
 f.project().fileName='different.mp4';assert.equal(f.api.mediaReady(),false);
 f.project().fileName='original.mp4';assert.equal(f.api.mediaReady(),false);
 f.api.invalidate();assert.equal(f.api.mediaReady(),false,'restore retry cannot revive capability');
});
test('explicit confirmation, exact names, required sources, size limits and recovery guards reject without allocation',async()=>{
 for(const change of [f=>{f.files.video.name='wrong';},f=>{f.files.audio=null;},f=>{f.files.video.size=501*1024*1024;},f=>f.block(true),f=>{f.persistence.recoveryValid=false;}]){
  const f=fixture();change(f);assert.equal((await f.start()).ok,false);assert.equal(f.probes.length,0);assert.deepEqual(f.sources,f.beforeSources);
 }
 const f=fixture();assert.equal((await f.api.connect(f.files)).error.code,'CONFIRMATION_REQUIRED');assert.equal(f.probes.length,0);
});
test('duration checks cover saved timeline and source endpoints, finite audio; failures release all temporary URLs',async()=>{
 for(const [index,duration] of [[0,11.999],[0,12.051],[0,Infinity],[1,0],[1,Infinity]]){
  const f=fixture(),pending=f.start();f.probes[index].duration=duration;await f.probe();
  assert.equal((await pending).ok,false);assert.equal(f.video.src,'old-video');assert.deepEqual(f.sources,f.beforeSources);
  assert.deepEqual(f.revoked.sort(),['new-1','new-2']);assert.equal(f.timers.size,0);
 }
 const f=fixture(),pending=f.start();f.probes[0].duration=12.04;await f.probe();f.video.duration=12.04;f.attach();assert.equal((await pending).ok,true);
});
test('cancel during probes or partial attach rolls back without adoption; late callbacks cannot change ownership',async()=>{
 for(const attaching of [false,true]){
  const f=fixture(),pending=f.start();if(attaching){await f.probe();f.video.emit('loadeddata');}
  f.api.cancel();assert.equal((await pending).ok,false);f.probes.forEach(p=>p.emit('loadeddata'));f.attach();
  assert.equal(f.video.src,'old-video');assert.equal(f.audio.src,'old-audio');assert.deepEqual(f.sources,f.beforeSources);
  assert.equal(f.api.mediaReady(),false);assert.deepEqual(f.revoked.sort(),['new-1','new-2']);assert.equal(f.timers.size,0);
 }
});
test('new request supersedes old attach and ignores stale events; current request can succeed',async()=>{
 const f=fixture(),old=f.start();await f.probe();const next=f.start();assert.equal((await old).ok,false);
 f.probes.slice(0,2).forEach(p=>p.emit('loadeddata'));await f.probe();
 f.video.currentSrc='old-video';f.video.emit('loadeddata');f.audio.emit('loadeddata');assert.equal(f.api.mediaReady(),false);
 f.video.currentSrc=f.video.src;f.video.emit('loadeddata');assert.equal((await next).ok,true);assert.equal(f.api.mediaReady(),true);
 assert.equal(f.sources.sourceURL,'new-3');assert.equal(f.sources.audioURL,'new-4');
});
test('timeout, native failure and project changes reject atomically; retry remains usable',async()=>{
 for(const fault of ['timeout','error','mutation','replacement','attach']){
  const f=fixture(),pending=f.start();
  if(fault==='timeout')[...f.timers][0]();
  else if(fault==='error')f.probes[0].emit('error');
  else if(fault==='attach'){await f.probe();f.video.emit('error');}
  else{if(fault==='mutation')f.project().name='Edited';else f.replace({...f.project()});await f.probe();}
  assert.equal((await pending).ok,false,fault);assert.deepEqual(f.sources,f.beforeSources);assert.equal(f.video.src,'old-video');assert.equal(f.timers.size,0);
  const retry=f.start();await f.probe();f.attach();assert.equal((await retry).ok,true);
 }
});

test('external source replacement or restore invalidation never rolls back a newer element owner',async()=>{
 const f=fixture(),pending=f.start();await f.probe();
 f.video.src='external-video';f.sources.sourceURL='external-video';f.api.invalidate();
 assert.equal((await pending).ok,false);assert.equal(f.video.src,'external-video');assert.equal(f.audio.src,'old-audio');
 assert.equal(f.sources.sourceURL,'external-video');assert.equal(f.api.mediaReady(),false);
 f.attach();assert.equal(f.video.src,'external-video');assert.equal(f.api.mediaReady(),false);
});
test('demo without required files is valid only after confirmation, clears obsolete live sources without changing project',async()=>{
 const f=fixture();f.replace({...f.project(),kind:'demo',audioName:''});const before=JSON.stringify(f.project());
 const result=await f.api.connect({}, {confirmed:true});assert.equal(result.ok,true);assert.equal(f.api.mediaReady(),true);
 assert.equal(f.sources.videoFile,null);assert.equal(f.sources.audioFile,null);assert.equal(f.video.src,'');assert.equal(f.audio.src,'');
 assert.equal(JSON.stringify(f.project()),before);assert.equal(f.probes.length,0);
});
test('probe allocation exception cleans previously allocated URLs without touching live media',async()=>{
 const project={...createDemoProject(),kind:'video',fileName:'x.mp4'},video=element(),audio=element(),revoked=[];
 video.src='old';const sources={videoFile:null,audioFile:null,sourceURL:'old',audioURL:''};
 const persistence={restorePhase:'failed',recoveryValid:true,recoveryBlocked:()=>true};
 const api=createSessionMedia({getProject:()=>project,persistence,sources,video,audio},{createURL:()=> 'temporary',revokeURL:url=>revoked.push(url),createVideo:()=>{throw Error('native allocation');}});
 const before=JSON.stringify(project);assert.equal((await api.connect({video:{name:'x.mp4',size:1}},{confirmed:true})).ok,false);
 assert.deepEqual(revoked,['temporary']);assert.equal(video.src,'old');assert.equal(sources.sourceURL,'old');assert.equal(JSON.stringify(project),before);
});
test('audio-only demo recovery requires and adopts audio without inventing video media',async()=>{
 const f=fixture();f.replace({...f.project(),kind:'demo'});const pending=f.api.connect({audio:f.files.audio},{confirmed:true});
 assert.equal(f.probes.length,1);f.probes[0].emit('loadeddata');await Promise.resolve();await Promise.resolve();
 f.audio.emit('loadeddata');assert.equal((await pending).ok,true);assert.equal(f.api.mediaReady(),true);
 assert.equal(f.sources.videoFile,null);assert.equal(f.video.src,'');assert.equal(f.sources.audioFile,f.files.audio);
});

test('authorization verifies native URL but remains granted through transient seek buffering',async()=>{
 const f=fixture(),pending=f.start();await f.probe();f.attach();await pending;
 f.video.readyState=1;assert.equal(f.api.mediaReady(),true);assert.equal(f.api.mediaBlocked(false),false);f.video.readyState=2;assert.equal(f.api.mediaReady(),true);
 f.video.currentSrc='wrong-decoded-url';assert.equal(f.api.mediaReady(),false);f.video.currentSrc=f.video.src;assert.equal(f.api.mediaReady(),true);
 f.video.src='external';assert.equal(f.api.mediaReady(),false);
});
test('unexpected extra files and malformed size metadata reject before allocation',async()=>{
 for(const alter of [f=>{f.files.extra={};},f=>{f.files.video.size=NaN;},f=>{f.files.audio.size=-1;},f=>{f.replace({...f.project(),kind:'demo'});},f=>{f.replace({...f.project(),audioName:''});}]){
  const f=fixture();alter(f);assert.equal((await f.start()).ok,false);assert.equal(f.probes.length,0);assert.deepEqual(f.sources,f.beforeSources);
 }
});

test('finished first attachment and source registry are revalidated before second attachment commits',async()=>{
 for(const mutation of [f=>{f.video.src='external';},f=>{f.video.currentSrc='external';},f=>{f.video.readyState=1;},f=>{f.sources.videoFile={name:'external'};f.sources.sourceURL='external';}]){
  const f=fixture(),pending=f.start();await f.probe();f.video.emit('loadeddata');mutation(f);const external=f.sources.sourceURL;
  f.audio.emit('loadeddata');assert.equal((await pending).ok,false);assert.equal(f.api.mediaReady(),false);
  assert.equal(f.sources.sourceURL,external);assert.ok(!f.revoked.includes('external'));
 }
});
test('native src setter throw settles immediately and cleans listener/timer without waiting for timeout',async()=>{
 const f=fixture(),pending=f.start();
 Object.defineProperty(f.video,'src',{configurable:true,get:()=> 'old-video',set(){throw Error('assignment failed');}});
 await f.probe();assert.equal((await pending).ok,false);assert.equal(f.timers.size,0);assert.equal(f.video.count(),0);assert.equal(f.audio.count(),0);
 assert.deepEqual(f.sources,f.beforeSources);
});

test('fatal error after first loadeddata but before other source completion prevents adoption',async()=>{
 for(const phase of ['probe','attach']){
  const f=fixture(),pending=f.start();
  if(phase==='probe'){
   f.probes[0].emit('loadeddata');f.probes[0].error={code:3};f.probes[1].emit('loadeddata');
  }else{
   await f.probe();f.video.emit('loadeddata');f.video.error={code:3};f.audio.emit('loadeddata');
  }
  assert.equal((await pending).ok,false);assert.equal(f.api.mediaReady(),false);
  assert.deepEqual(f.sources,f.beforeSources);assert.equal(f.video.src,'old-video');assert.equal(f.audio.src,'old-audio');
  assert.equal(f.persistence.restorePhase,'failed');assert.equal(JSON.stringify(f.project()),f.baseline);
  assert.deepEqual(f.revoked.sort(),['new-1','new-2']);assert.equal(f.timers.size,0);
 }
});
