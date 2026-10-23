import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

import { createProjectStore } from '../dist/project-store.mjs';
import { createMediaStorageFixture } from './fixtures/media-storage.mjs';

test('media persistence, recording and export ownership', async () => {
  const { context, evaluate, element, doc } = await createAppFixture();
  // Storage writes are serialized and only changed media is persisted.
  const writes=[],savedMedia=new Map();let opens=0;
  const db={close(){},transaction(){
   const tx={objectStore(){return {
    put(value,key){writes.push(['put',key]);savedMedia.set(key,value);},
    delete(key){writes.push(['delete',key]);savedMedia.delete(key);},
    get(key){const request={};queueMicrotask(()=>{request.result=savedMedia.get(key);request.onsuccess?.();});return request;}
   };}};
   queueMicrotask(()=>tx.oncomplete?.());return tx;
  }};
  const factory={open(){opens++;const request={};queueMicrotask(()=>{request.result=db;request.onsuccess();});return request;}};
  const store=createProjectStore(factory),v={name:'large-video.mp4'},a={name:'voice.webm'};
  await store.setMedia(v,null);writes.length=0;
  await store.setMedia(v,a);
  assert.deepEqual(writes,[['put','audio']],'Adding audio must not rewrite the video');
  writes.length=0;await store.setMedia(v,a);assert.equal(writes.length,0);
  const a2={name:'second.webm'},a3={name:'third.webm'};
  await Promise.all([store.setMedia(v,a2),store.setMedia(v,a3)]);
  assert.equal(await store.get('audio'),a3);assert.equal(opens,1);
  console.log('PASS: changed-media deduplication and serialized storage write ordering.');

  // Storage retry after a denied connection must not discard subsequent retries.
  let retryAttempts=0;
  const retryStore=createProjectStore({open(){const request={};retryAttempts++;queueMicrotask(()=>{if(retryAttempts===1){request.error=new Error('denied');request.onerror();}else{request.result=db;request.onsuccess();}});return request;}});
  await assert.rejects(retryStore.setMedia(v,a),/denied/);await retryStore.setMedia(v,a);assert.equal(retryAttempts,2);
  let syncAttempts=0;
  const syncStore=createProjectStore({open(){syncAttempts++;if(syncAttempts===1)throw new Error('temporary');const request={};queueMicrotask(()=>{request.result=db;request.onsuccess();});return request;}});
  await assert.rejects(syncStore.setMedia(v,a),/temporary/);await syncStore.setMedia(v,a);assert.equal(syncAttempts,2);
  console.log('PASS: asynchronous and synchronous storage failures can be retried.');
  
  // Exercise the real save coordinator with isolated media and JSON stores.
  const mediaFixture=createMediaStorageFixture([['video',{name:'old.mp4'}]]);
  const appStore=vm.runInContext('projectStore',context),originalStore={...appStore};
  const originalSetItem=context.localStorage.setItem;
  let savedJson=JSON.stringify({fileName:'old.mp4'}),jsonWrites=0;
  try{
   Object.assign(appStore,createProjectStore(mediaFixture.factory));
   context.localStorage.setItem=(key,value)=>{assert.equal(key,'moment-state-v1');savedJson=value;jsonWrites++;};
   context.fixtureVideo={name:'new.mp4'};context.fixtureAudio={name:'voice.wav'};
   mediaFixture.failures.push(new Error('synthetic quota failure'));
   await vm.runInContext('state=initial();state.kind="video";state.fileName=fixtureVideo.name;sources.videoFile=fixtureVideo;sources.audioFile=null;persistMedia();sources.audioFile=fixtureAudio;state.audioName=fixtureAudio.name;persistMedia();saveProject()',context);
   assert.deepEqual(Object.fromEntries(mediaFixture.records),{video:context.fixtureVideo,audio:context.fixtureAudio});
   assert.equal(JSON.parse(savedJson).fileName,'new.mp4');assert.equal(JSON.parse(savedJson).audioName,'voice.wav');
   assert.equal(jsonWrites,1);assert.ok(element('#saveStatus').innerHTML.includes('이 브라우저에 저장됨'));
   const committedJson=savedJson;
   context.fixtureVideo={name:'replacement.mp4'};
   mediaFixture.failures.push(new Error('latest media write failed'));
   await vm.runInContext('sources.videoFile=fixtureVideo;state.fileName=fixtureVideo.name;persistMedia();saveProject()',context);
   assert.equal(savedJson,committedJson);assert.equal(jsonWrites,1,'Failed media must not advance project JSON');
   assert.equal(mediaFixture.records.get('video').name,'new.mp4');
   assert.ok(element('#saveStatus').innerHTML.includes('저장 공간을 확인하세요'));
   await vm.runInContext('persistMedia();saveProject()',context);
   assert.equal(JSON.parse(savedJson).fileName,'replacement.mp4');assert.equal(jsonWrites,2);
   assert.deepEqual(mediaFixture.records.get('video'),context.fixtureVideo);
   assert.ok(element('#saveStatus').innerHTML.includes('이 브라우저에 저장됨'));
  }finally{
   Object.assign(appStore,originalStore);context.localStorage.setItem=originalSetItem;
   vm.runInContext('persistence.pendingSave=Promise.resolve();sources.videoFile=null;sources.audioFile=null;state=initial();timelineCache=null;',context);
   delete context.fixtureVideo;delete context.fixtureAudio;
  }
  console.log('PASS: queued media recovery precedes JSON success; latest failure preserves JSON and retry restores saving.');
  
  // Validate rejected uploads and unsupported export before requesting native media APIs.
  vm.runInContext('state=initial();timelineCache=null;',context);
  await vm.runInContext('loadVideo({name:"notes.txt",type:"text/plain",size:42})',context);
  assert.ok(element('#toast').textContent.includes('동영상 파일'));assert.equal(evaluate('state.kind'),'demo');
  await vm.runInContext('loadVideo({name:"large.mp4",type:"video/mp4",size:600*1024*1024})',context);
  assert.ok(element('#toast').textContent.includes('500 MB'));assert.equal(evaluate('state.kind'),'demo');
  await vm.runInContext('loadAudio({name:"large.wav",size:120*1024*1024})',context);
  assert.ok(element('#toast').textContent.includes('100 MB'));
  vm.runInContext('exportDialog()',context);assert.ok(element('#toast').textContent.includes('내보내기를 지원하지'));
  vm.runInContext('switchPanel("captions")',context);element('#captionSource').value='video';await vm.runInContext('generateCaptions()',context);
  assert.ok(element('#toast').textContent.includes('음성이 없습니다.'));assert.equal(evaluate('transcribing'),false);
  console.log('PASS: unsupported uploads, size limits, absent audio, and export capability detection.');
  
  // Native APIs are mocked here: these assertions cover lifecycle, not device/codec quality.
  let releasedTracks=0;
  context.navigator={mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){releasedTracks++;}}]})}};
  context.MediaRecorder=class {constructor(){throw new Error('encoder unavailable');}};
  vm.runInContext('switchPanel("audio")',context);await vm.runInContext('toggleRecording()',context);
  assert.equal(releasedTracks,1,'release microphone if recorder construction fails');assert.equal(evaluate('audioRecording.current'),null);assert.equal(evaluate('audioRecording.requesting'),false);
  let finishPermission;
  context.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>finishPermission=resolve);
  const waitingMic=vm.runInContext('toggleRecording()',context);
  vm.runInContext('switchPanel("templates")',context);
  finishPermission({getTracks:()=>[{stop(){releasedTracks++;}}]});await waitingMic;
  assert.equal(releasedTracks,2,'release permission-granted stream when user has left audio panel');
  console.log('PASS: recording initialization failure and delayed permission both release microphone tracks.');
  
  const pendingRecorders=[];
  context.MediaRecorder=class {constructor(){this.state='inactive';pendingRecorders.push(this);}start(){this.state='recording';}stop(){this.state='inactive';}};
  context.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){releasedTracks++;}}]});
  vm.runInContext("switchPanel('audio')",context);await vm.runInContext('toggleRecording()',context);
  await vm.runInContext('toggleRecording();toggleRecording()',context);
  assert.equal(pendingRecorders.length,1,'Do not replace an inactive recorder awaiting final data/stop');
  await pendingRecorders[0].onstop();assert.equal(evaluate('audioRecording.current'),null);
  await vm.runInContext('toggleRecording()',context);assert.equal(pendingRecorders.length,2);
  await vm.runInContext('toggleRecording()',context);await pendingRecorders[1].onstop();
  
  // Recorder state becomes inactive before its final events; own timers and streams survive that gap.
  vm.runInContext('globalThis.savedRecordingAudio=loadAudio;',context);
  const oldInterval=context.setInterval,oldClearInterval=context.clearInterval,recordTimers=new Map(),recordStreams=[],sessions=[];
  let timerId=0,micRequests=0,recordFailure='';
  context.setInterval=fn=>{recordTimers.set(++timerId,fn);return timerId;};context.clearInterval=id=>recordTimers.delete(id);
  context.File=class extends Blob {constructor(parts,name,options){super(parts,options);this.name=name;}};
  context.navigator.mediaDevices.getUserMedia=async()=>{micRequests++;const track={stops:0,stop(){this.stops++;}},stream={track,getTracks:()=>[track]};recordStreams.push(stream);return stream;};
  context.MediaRecorder=class {
   constructor(stream){if(recordFailure==='construct')throw new Error('constructor');this.stream=stream;this.state='inactive';this.mimeType='audio/webm';this.stopCalls=0;sessions.push(this);}
   start(){if(recordFailure==='start')throw new Error('start');this.state='recording';}
   stop(){this.stopCalls++;if(recordFailure==='stop')throw new Error('stop');this.state='inactive';}
  };
  let completeAudio,failAudio,audioHandoffs=0;
  context.deferredRecordedAudio=(file,owner)=>{audioHandoffs++;assert.equal(file.name,'내 목소리.webm');assert.equal(owner,sessions.at(-1));return new Promise((resolve,reject)=>{completeAudio=resolve;failAudio=reject;});};
  vm.runInContext('loadAudio=deferredRecordedAudio;',context);
  for(const outcome of ['resolve','reject']){
   await vm.runInContext('toggleRecording()',context);const recorder=sessions.at(-1),events={data:recorder.ondataavailable,error:recorder.onerror,stop:recorder.onstop},timer=recordTimers.get(timerId);
   const acquisitions=micRequests;await vm.runInContext('toggleRecording();toggleRecording()',context);
   assert.equal(micRequests,acquisitions);assert.equal(recorder.stopCalls,1);assert.equal(vm.runInContext('audioRecording.current',context),recorder);
   events.data({data:new Blob(['recorded bytes'])});const finishing=events.stop();
   assert.equal(recorder.stream.track.stops,1);assert.equal(recordTimers.size,0);assert.equal(vm.runInContext('audioRecording.current',context),recorder);
   await vm.runInContext('toggleRecording()',context);assert.equal(micRequests,acquisitions,'Audio handoff remains single-flight');
   assert.equal((await context.window.moment.execute('project.update',{patch:{zoom:1.5}})).error.code,'BUSY');
   const before=evaluate('state');await vm.runInContext('loadVideo({});startExport({},720);generateCaptions();confirmReset();switchPanel("templates");',context);
   assert.deepEqual(evaluate('state'),before);assert.equal(evaluate('panel'),'audio');
   timer();assert.equal(recorder.stopCalls,1);events.error();events.data({data:new Blob(['late'])});await events.stop();
   if(outcome==='reject')failAudio(new Error('audio decode failed'));else completeAudio();await finishing;
   assert.equal(evaluate('audioRecording.current'),null);assert.equal(recorder.stream.track.stops,1);
   await vm.runInContext('toggleRecording()',context);const newest=sessions.at(-1),newTimer=timerId;
   const text=element('#recordButton').innerHTML;events.error();await events.stop();events.data({data:new Blob(['stale'])});timer();
   assert.equal(vm.runInContext('audioRecording.current',context),newest);assert.ok(recordTimers.has(newTimer));assert.equal(newest.stream.track.stops,0);assert.equal(element('#recordButton').innerHTML,text);
   const end=newest.onstop;await vm.runInContext('toggleRecording()',context);await end();assert.equal(newest.stream.track.stops,1);
  }
  assert.equal(audioHandoffs,2);
  for(const failure of ['construct','start','stop','event']){
   recordFailure=failure;const handoffs=audioHandoffs;await vm.runInContext('toggleRecording()',context);
   if(failure==='stop')await vm.runInContext('toggleRecording()',context);
   if(failure==='event'){const recorder=sessions.at(-1),error=recorder.onerror,stop=recorder.onstop;error();error();await stop();}
   assert.equal(evaluate('audioRecording.current'),null);assert.equal(evaluate('audioRecording.requesting'),false);assert.equal(recordStreams.at(-1).track.stops,1);assert.equal(recordTimers.size,0);assert.equal(audioHandoffs,handoffs);
  }
  recordFailure='';await vm.runInContext('toggleRecording()',context);
  const timedRecorder=sessions.at(-1),timedTick=recordTimers.get(timerId),timedStop=timedRecorder.onstop;
  for(let i=0;i<181;i++)timedTick();assert.equal(timedRecorder.stopCalls,1);assert.equal(recordTimers.size,0);await timedStop();assert.equal(timedRecorder.stream.track.stops,1);
  vm.runInContext('loadAudio=savedRecordingAudio;delete globalThis.savedRecordingAudio;',context);context.setInterval=oldInterval;context.clearInterval=oldClearInterval;
  // Exercise the actual audio metadata handoff with synthetic bytes, never a native decoder.
  vm.runInContext('globalThis.savedRecordingMedia={waitForMedia:sources.waitForMedia,persistMedia,scheduleSave};globalThis.recordingWrites=0;persistMedia=()=>recordingWrites++;scheduleSave=()=>recordingWrites++;',context);
  context.Audio=class {removeAttribute(){}load(){}};
  let settleMetadata,rejectMetadata;
  context.recordingMetadata=()=>new Promise((resolve,reject)=>{settleMetadata=resolve;rejectMetadata=reject;});
  vm.runInContext('sources.waitForMedia=recordingMetadata;',context);
  for(const outcome of ['resolve','reject']){
   vm.runInContext("state=initial();state.audioName='original.wav';sources.audioFile={name:'original.wav'};panel='audio';renderPanel();recordingWrites=0;",context);
   await vm.runInContext('toggleRecording()',context);const recorder=sessions.at(-1);
   recorder.ondataavailable({data:new Blob(['synthetic audio'])});await vm.runInContext('toggleRecording()',context);
   const completing=recorder.onstop();assert.equal(evaluate('loadingMedia'),true);
   const before=evaluate('state');element('#removeAudio').onclick();assert.deepEqual(evaluate('state'),before);
   if(outcome==='reject')rejectMetadata(new Error('synthetic decode failure'));else settleMetadata();await completing;
   assert.equal(evaluate('audioRecording.current'),null);assert.equal(evaluate('loadingMedia'),false);
   assert.equal(evaluate('state.audioName'),outcome==='resolve'?'내 목소리.webm':'original.wav');
   assert.equal(evaluate('sources.audioFile.name'),outcome==='resolve'?'내 목소리.webm':'original.wav');
   assert.equal(evaluate('recordingWrites'),outcome==='resolve'?2:0);
   assert.equal(recorder.stream.track.stops,1);
  }
  vm.runInContext('sources.waitForMedia=savedRecordingMedia.waitForMedia;persistMedia=savedRecordingMedia.persistMedia;scheduleSave=savedRecordingMedia.scheduleSave;delete globalThis.savedRecordingMedia;sources.audioFile=null;if(sources.audioURL)URL.revokeObjectURL(sources.audioURL);sources.audioURL="";audio.removeAttribute("src");state=initial();',context);
  // A delayed acquisition cannot attach to a project replaced by undo/import/reset.
  context.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>finishPermission=resolve);
  const pendingAcquisition=vm.runInContext('toggleRecording()',context),recordersBefore=sessions.length;
  await vm.runInContext('loadAudio({});loadVideo({});confirmReset();',context);
  assert.equal(evaluate('loadingMedia'),false);vm.runInContext('state=initial();',context);
  const lateTrack={stops:0,stop(){this.stops++;}};finishPermission({getTracks:()=>[lateTrack]});await pendingAcquisition;
  assert.equal(lateTrack.stops,1);assert.equal(sessions.length,recordersBefore);assert.equal(evaluate('audioRecording.requesting'),false);
  console.log('PASS: recording finalization/audio handoff is single-flight; stale callbacks/timers, failures and 180s stop preserve ownership and release own tracks once.');
  
  const mediaNode=()=>({connect(){},gain:{value:1}});
  let stoppedExportTracks=0,recorderStarts=0,downloads=0;
  const mediaTrack=()=>({clone:mediaTrack,stop(){stoppedExportTracks++;}});
  context.AudioContext=class {constructor(){this.destination={};}resume(){return Promise.resolve();}createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[mediaTrack()]}};}createMediaElementSource(){return mediaNode();}createGain(){return mediaNode();}};
  function captureStream(){const tracks=[mediaTrack()];return {addTrack(track){tracks.push(track);},getTracks(){return tracks;}};}
  const originalCreate=doc.createElement;
  doc.createElement=tag=>{const el=originalCreate(tag);if(tag==='canvas')el.captureStream=captureStream;else if(tag==='a'){el.click=()=>downloads++;el.remove=()=>{};}return el;};
  doc.body.append=()=>{};
  context.MediaRecorder=class {static isTypeSupported(mime){return mime.includes('vp8');}constructor(stream,options){this.mimeType=options.mimeType;this.state='inactive';}start(){this.state='recording';recorderStarts++;}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['fake-encoded-bytes'])});this.onstop?.();}};
  vm.runInContext('state=initial();timelineCache=null;current=0;',context);
  await vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},720)',context);
  assert.equal(evaluate('exporting'),true);assert.equal(recorderStarts,1);
  await vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},720)',context);
  assert.equal(recorderStarts,1,'double-click does not start another recorder');
  vm.runInContext('stopExport(true)',context);
  assert.equal(evaluate('exporting'),false);assert.equal(evaluate('playing'),false);assert.equal(stoppedExportTracks,2);assert.equal(downloads,0,'cancelled exports never download');
  await vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},1080)',context);
  assert.deepEqual(evaluate('[videoExport.canvas.width,videoExport.canvas.height]'),[1080,1920]);
  vm.runInContext('current=duration();stopExport(false);',context);
  assert.equal(downloads,1);assert.equal(evaluate('exporting'),false);assert.equal(stoppedExportTracks,4);
  console.log('PASS: export start/double-click guard/cancel/restart/completion, output dimensions and media-track cleanup with mocked codecs.');
  
  // Deferred media promises exercise request ownership, not browser playback timing.
  vm.runInContext('globalThis.savedPlayback={ensureAudio,seekVideo,play:video.play,pause:video.pause};globalThis.mediaPauses=0;video.pause=()=>mediaPauses++;',context);
  for(const stage of ['audio','seek','play'])for(const outcome of ['resolve','reject'])for(const next of ['paused','pending','playing']){
   vm.runInContext("pause();state=initial();state.kind='video';current=1;video.currentTime=0;exporting=false;history=[];future=[];",context);
   let finish,fail;const deferred=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
   context.mediaDeferred=()=>deferred;
   vm.runInContext(`ensureAudio=${stage==='audio'?'mediaDeferred':'async()=>{}'};seekVideo=${stage==='seek'?'mediaDeferred':'async()=>{}'};video.play=${stage==='play'?'mediaDeferred':'async()=>{}'};`,context);
   const oldPlay=vm.runInContext('play()',context);await Promise.resolve();await Promise.resolve();await Promise.resolve();
   vm.runInContext('pause();ensureAudio=async()=>{};seekVideo=async()=>{};video.play=async()=>{};',context);
   let finishNext,newPlay;
   if(next==='pending'){
    context.newMediaDeferred=()=>new Promise(resolve=>{finishNext=resolve;});vm.runInContext('ensureAudio=newMediaDeferred',context);
    newPlay=vm.runInContext('play()',context);
   }else if(next==='playing')await vm.runInContext('play()',context);
   element('#toast').textContent='unchanged';const before=evaluate('({state,history,future,playing,frameHandle,mediaPauses})');
   if(outcome==='reject')fail(new Error('old media request'));else finish();await oldPlay;
   assert.deepEqual(evaluate('({state,history,future,playing,frameHandle,mediaPauses})'),before,`${stage} ${outcome} cannot disturb ${next}`);
   assert.equal(element('#toast').textContent,'unchanged');
   if(newPlay){finishNext();await newPlay;assert.equal(evaluate('playing'),true);}
  }
  for(const stage of ['audio','seek','play']){
   vm.runInContext("pause();state=initial();state.kind='video';current=1;video.currentTime=0;exporting=false;history=[];future=[];",context);
   context.currentMediaFailure=async()=>{throw new Error('current media failure');};
   vm.runInContext(`ensureAudio=${stage==='audio'?'currentMediaFailure':'async()=>{}'};seekVideo=${stage==='seek'?'currentMediaFailure':'async()=>{}'};video.play=${stage==='play'?'currentMediaFailure':'async()=>{}'};`,context);
   await vm.runInContext('play()',context);assert.match(element('#toast').textContent,/재생할 수 없습니다/);assert.equal(evaluate('playing'),false);
   assert.equal(evaluate('history.length'),0);assert.equal(evaluate('future.length'),0);
  }
  for(const phase of ['preparing','recording'])for(const outcome of ['resolve','reject']){
   vm.runInContext("pause();state=initial();state.kind='video';current=0;video.currentTime=0;exporting=false;ensureAudio=async()=>{};seekVideo=async()=>{};",context);
   let finishOld,failOld;
   context.oldExportPlay=()=>new Promise((resolve,reject)=>{finishOld=resolve;failOld=reject;});
   vm.runInContext('video.play=oldExportPlay',context);
   const oldPlay=vm.runInContext('play()',context);await Promise.resolve();await Promise.resolve();assert.equal(typeof finishOld,'function');
   let readyExport;const preparation=new Promise(resolve=>{readyExport=resolve;});context.exportPreparation=()=>preparation;
   vm.runInContext('video.play=async()=>{};ensureAudio=exportPreparation;',context);
   const exportingNow=vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},720)',context);
   if(phase==='recording'){readyExport();await exportingNow;}
   element('#toast').textContent='new export';
   const before=evaluate('({exporting,exportCancelled,playing,frameHandle,mediaPauses})'),beforeStops=stoppedExportTracks,beforeDownloads=downloads;
   assert.equal(before.exporting,true);
   if(outcome==='reject')failOld(new Error('old preview failure'));else finishOld();await oldPlay;
   assert.deepEqual(evaluate('({exporting,exportCancelled,playing,frameHandle,mediaPauses})'),before,`${outcome} cannot affect ${phase} export`);
   assert.equal(stoppedExportTracks,beforeStops);assert.equal(downloads,beforeDownloads);assert.equal(element('#toast').textContent,'new export');
   if(phase==='preparing'){readyExport();await exportingNow;}
   assert.equal(evaluate('playing'),true);assert.equal(evaluate('videoExport.recorder.state'),'recording');
   vm.runInContext('stopExport(true)',context);assert.equal(evaluate('exporting'),false);assert.equal(downloads,beforeDownloads);
  }
  vm.runInContext("state=initial();state.kind='video';current=0;video.currentTime=0;ensureAudio=async()=>{};seekVideo=async()=>{};video.play=currentMediaFailure;",context);
  const beforeFailedExportDownloads=downloads,beforeFailedExportStops=stoppedExportTracks;
  await vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},720)',context);
  assert.equal(evaluate('exporting'),false);assert.equal(evaluate('playing'),false);assert.equal(evaluate('exportCancelled'),true);
  assert.match(element('#toast').textContent,/재생할 수 없습니다/);
  assert.equal(stoppedExportTracks,beforeFailedExportStops+2);assert.equal(downloads,beforeFailedExportDownloads);
  vm.runInContext('ensureAudio=savedPlayback.ensureAudio;seekVideo=savedPlayback.seekVideo;video.play=savedPlayback.play;video.pause=savedPlayback.pause;delete globalThis.savedPlayback;delete globalThis.mediaPauses;pause();state=initial();',context);
  console.log('PASS: superseded audio/seek/play fulfillment and rejection preserve current playback; current failures still report.');
  console.log('PASS: stale preview completion cannot cancel preparing/running export; current export playback failure releases tracks without download.');
  
  // Cancelling preparation must invalidate its continuation before any recorder is created.
  vm.runInContext('globalThis.preparationAudio=ensureAudio;state=initial();current=0;',context);
  let releasePreparation;context.pendingPreparation=()=>new Promise(resolve=>{releasePreparation=resolve;});
  vm.runInContext('ensureAudio=pendingPreparation',context);
  const preparationStarts=recorderStarts;
  const cancelledPreparation=vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},720)',context);
  vm.runInContext('stopExport(true);ensureAudio=preparationAudio;',context);
  releasePreparation();await cancelledPreparation;
  assert.equal(recorderStarts,preparationStarts,'Cancelled preparation never starts a recorder');
  assert.equal(evaluate('exporting'),false);assert.equal(evaluate('playing'),false);
  vm.runInContext('delete globalThis.preparationAudio;',context);
  
  vm.runInContext('globalThis.savedExportPreparation={ensureAudio,seekVideo};',context);
  const savedFontReady=doc.fonts.ready;
  for(const stage of ['audio','fonts','seek'])for(const outcome of ['resolve','reject'])for(const retry of [false,true]){
   vm.runInContext("state=initial();state.kind='video';current=0;ensureAudio=async()=>{};seekVideo=async()=>{};",context);
   let finish,fail,entered=false;const pending=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
   context.exportWait=()=>{entered=true;return pending;};
   if(stage==='fonts')doc.fonts.ready={then(resolve,reject){entered=true;pending.then(resolve,reject);}};
   else vm.runInContext(stage==='audio'?'ensureAudio=exportWait':'seekVideo=exportWait',context);
   const old=vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},720)',context);
   for(let i=0;i<5;i++)await Promise.resolve();assert.equal(entered,true,stage+' await reached');
   vm.runInContext('stopExport(true);ensureAudio=async()=>{};seekVideo=async()=>{};',context);doc.fonts.ready=Promise.resolve();
   if(retry)await vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},1080)',context);
   const active=vm.runInContext('videoExport.recorder',context),before=evaluate('({state,exporting,exportCancelled,playing})'),counts=[recorderStarts,stoppedExportTracks,downloads];
   element('#toast').textContent='current state';
   if(outcome==='reject')fail(new Error('old preparation'));else finish();await old;
   assert.deepEqual(evaluate('({state,exporting,exportCancelled,playing})'),before,`${stage} ${outcome} after cancel/retry`);
   assert.equal(vm.runInContext('videoExport.recorder',context),active);assert.deepEqual([recorderStarts,stoppedExportTracks,downloads],counts);
   assert.equal(element('#toast').textContent,'current state');
   if(retry)vm.runInContext('stopExport(true)',context);
  }
  for(const stage of ['audio','fonts','seek']){
   vm.runInContext("state=initial();state.kind='video';current=0;ensureAudio=async()=>{};seekVideo=async()=>{};",context);
   context.failedPreparation=async()=>{throw new Error('current preparation failed');};
   if(stage==='fonts')doc.fonts.ready={then(resolve,reject){reject(new Error('font preparation failed'));}};
   else vm.runInContext(stage==='audio'?'ensureAudio=failedPreparation':'seekVideo=failedPreparation',context);
   const counts=[recorderStarts,stoppedExportTracks,downloads];
   await vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},720)',context);
   assert.equal(evaluate('exporting'),false);assert.equal(evaluate('videoExport.canvas'),null);assert.match(element('#toast').textContent,/시작하지 못했습니다/);
   assert.deepEqual([recorderStarts,stoppedExportTracks,downloads],counts);doc.fonts.ready=Promise.resolve();
  }
  vm.runInContext('ensureAudio=savedExportPreparation.ensureAudio;seekVideo=savedExportPreparation.seekVideo;delete globalThis.savedExportPreparation;state=initial();',context);doc.fonts.ready=savedFontReady;
  
  // Native stop queues data/stop events; keep them deferred to test cleanup and stale callbacks.
  const immediateRecorder=context.MediaRecorder,delayedRecorders=[];
  context.MediaRecorder=class {
   constructor(stream,options){this.mimeType=options.mimeType;this.state='inactive';this.stream=stream;this.stopCalls=0;delayedRecorders.push(this);}
   start(){this.state='recording';recorderStarts++;}
   stop(){this.stopCalls++;this.state='inactive';}
  };
  const exportStart=()=>vm.runInContext('startExport({mime:"video/webm;codecs=vp8,opus",ext:"webm"},720)',context);
  const callbacks=recorder=>({data:recorder.ondataavailable,stop:recorder.onstop,error:recorder.onerror});
  const dataEvent={data:new Blob(['synthetic final chunk'])};
  await exportStart();let previous=delayedRecorders.at(-1),oldCallbacks=callbacks(previous),oldCancel=element('#cancelRunningExport').onclick;
  let exportStops=stoppedExportTracks,exportDownloads=downloads;
  vm.runInContext('stopExport(true);stopExport(true)',context);
  assert.equal(previous.stopCalls,1);assert.equal(stoppedExportTracks,exportStops+2);assert.equal(evaluate('videoExport.recorder'),null);
  assert.equal(previous.onstop,null);await exportStart();const replacement=delayedRecorders.at(-1);
  oldCallbacks.data(dataEvent);oldCallbacks.error();oldCallbacks.stop();oldCancel();
  assert.equal(vm.runInContext('videoExport.recorder',context),replacement);assert.equal(replacement.state,'recording');assert.equal(downloads,exportDownloads);assert.equal(stoppedExportTracks,exportStops+2);
  let finalCallbacks=callbacks(replacement);finalCallbacks.data(dataEvent);
  vm.runInContext('stopExport(false);stopExport(false)',context);
  assert.equal(replacement.stopCalls,1);assert.equal(evaluate('exporting'),true,'Wait for final data and stop, including repeated stop calls');
  assert.equal(stoppedExportTracks,exportStops+2);finalCallbacks.data(dataEvent);finalCallbacks.stop();
  assert.equal(downloads,exportDownloads+1);assert.equal(stoppedExportTracks,exportStops+4);assert.equal(evaluate('exporting'),false);
  finalCallbacks.stop();finalCallbacks.error();finalCallbacks.data(dataEvent);assert.equal(downloads,exportDownloads+1);assert.equal(stoppedExportTracks,exportStops+4);
  await exportStart();previous=delayedRecorders.at(-1);oldCallbacks=callbacks(previous);exportStops=stoppedExportTracks;exportDownloads=downloads;
  vm.runInContext('stopExport(false);stopExport(true)',context);assert.equal(previous.stopCalls,1);assert.equal(stoppedExportTracks,exportStops+2);
  oldCallbacks.data(dataEvent);oldCallbacks.stop();assert.equal(downloads,exportDownloads,'Cancel during finalization never downloads');
  for(const failure of ['construct','start','stop','cancel-stop','error','empty']){
   context.MediaRecorder=class extends immediateRecorder {
    constructor(...args){if(failure==='construct')throw new Error('constructor failed');super(...args);}
    start(...args){if(failure==='start')throw new Error('start failed');super.start(...args);}
    stop(){if(failure==='stop'||failure==='cancel-stop')throw new Error('stop failed');super.stop();}
   };
   exportStops=stoppedExportTracks;exportDownloads=downloads;await exportStart();
   if(failure==='stop')vm.runInContext('stopExport(false)',context);
   if(failure==='cancel-stop')vm.runInContext('stopExport(true)',context);
   if(failure==='error')vm.runInContext('videoExport.recorder.onerror()',context);
   if(failure==='empty')vm.runInContext('videoExport.recorder.onstop()',context);
   assert.equal(evaluate('exporting'),false,failure+' releases export');assert.equal(evaluate('videoExport.recorder'),null);
   assert.equal(stoppedExportTracks,exportStops+2,failure+' releases tracks once');assert.equal(downloads,exportDownloads);
   if(failure==='error')assert.match(element('#toast').textContent,/영상 저장 중 오류/);
  }
  context.MediaRecorder=immediateRecorder;await exportStart();vm.runInContext('stopExport(true)',context);
  console.log('PASS: cancelled audio/font/seek preparation never resumes; stale callbacks preserve replacement exports; final data, cancellation, errors, cleanup once and explicit retry.');
  console.log('LIMIT: no actual browser layout, microphone capture, AI inference or encoded MP4/WebM playback was tested.');
  
  // A 60 Hz display must not turn a 30 fps target into ~20 fps through rounding drift.
  vm.runInContext('globalThis.savedDraw=draw;globalThis.frameCount=0;draw=()=>frameCount++;state=initial();timelineCache=null;current=0;lastTick=0;lastDrawTime=-Infinity;playing=true;',context);
  for(let i=1;i<=120;i++)vm.runInContext(`tick(${i*1000/60})`,context);
  const cadenceFrames=evaluate('frameCount');
  vm.runInContext('draw=savedDraw;pause();',context);
  assert.ok(cadenceFrames>=59&&cadenceFrames<=61,`30 fps target over 2 seconds: got ${cadenceFrames}`);
  console.log('PASS: frame cadence preserves elapsed time at 60 Hz.');
  
});
