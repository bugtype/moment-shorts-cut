import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as projectModule from '../dist/core/project.mjs';
import * as captionModule from '../dist/captions.mjs';
import * as effectsModule from '../dist/effects.mjs';
import { createAppFixture } from './fixtures/app.mjs';

test('caption workspace, budgets and asynchronous recognition lifecycle', async () => {
  const { context, evaluate, element, doc, focusEvents } = await createAppFixture();
  function assertCaptionVisibleTarget(target){
   assert.equal(doc.activeElement,target);
   const events=focusEvents.slice(-2);
   assert.deepEqual(events.map(event=>event.target),[target,target]);
   assert.deepEqual(JSON.parse(JSON.stringify(events.map(({action,options})=>({action,options})))),[
    {action:'focus',options:{preventScroll:true}},
    {action:'scroll',options:{block:'nearest',inline:'nearest',behavior:'instant'}}
   ]);
  }
  
  // Existing captions lead the workspace; setup is disclosed for empty/running states.
  vm.runInContext('state=initial();timelineCache=null;current=0;switchPanel("captions")',context);
  const captionMarkup=()=>element('#panelContent').innerHTML;
  const createIsOpen=()=>/id="captionCreate" open/.test(captionMarkup());
  assert.ok(captionMarkup().indexOf('id="captionRows"')<captionMarkup().indexOf('id="captionCreate"'));
  assert.equal(createIsOpen(),false);
  assert.ok(captionMarkup().includes('role="region" aria-label="자막 목록" tabindex="0"'));
  vm.runInContext('state.captions=[];renderPanel()',context);assert.equal(createIsOpen(),true);
  element('#addCaption').onclick();assert.equal(evaluate('state.captions.length'),1);
  assertCaptionVisibleTarget(element('[data-caption-text="0"]'));
  assert.equal(createIsOpen(),false);
  const captionDelete={dataset:{deleteCaption:'0'}};
  doc.querySelectorAll=selector=>selector==='[data-delete-caption]'?[captionDelete]:[];
  vm.runInContext('renderPanel()',context);captionDelete.onclick();
  doc.querySelectorAll=()=>[];
  assert.equal(evaluate('state.captions.length'),0);assert.equal(createIsOpen(),true);
  assertCaptionVisibleTarget(element('#addCaption'));
  await vm.runInContext('importSrt(new Blob(["1\\n00:00:00,000 --> 00:00:02,000\\nImported caption"]))',context);
  assert.equal(evaluate('state.captions[0].text'),'Imported caption');assert.equal(createIsOpen(),false);
  assertCaptionVisibleTarget(element('[data-caption-text="0"]'));
  vm.runInContext('state.captions[0].timing="estimated";state.captions[0].basis="timeline";renderPanel()',context);
  assert.ok(captionMarkup().includes('시간 추정 · 음성과 확인 필요'));
  assert.ok(captionMarkup().includes('추가 오디오 · 편집 타임라인'));
  
  // Hold audio decoding to exercise running/cancelled UI without loading a model.
  let releaseCaptionAudio;
  context.captionTestFile={arrayBuffer:()=>new Promise(resolve=>releaseCaptionAudio=resolve)};
  context.AudioContext=class {async decodeAudioData(){return {duration:1};}async close(){}};
  context.OfflineAudioContext=class {createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array([.1])};}};
  vm.runInContext('sources.videoFile=captionTestFile;renderPanel()',context);
  element('#captionSource').value='video';element('#language').value='korean';
  const beforeCaptionGeneration=evaluate('state.captions');
  const pendingCaptionGeneration=vm.runInContext('generateCaptions()',context);
  assert.equal(evaluate('transcribing'),true);
  vm.runInContext('switchPanel("text");switchPanel("captions")',context);
  assert.equal(createIsOpen(),true);
  assert.ok(captionMarkup().includes('인식 중 · 취소'));
  assert.ok(captionMarkup().includes('오디오를 읽고 있습니다…'));
  assert.ok(captionMarkup().includes('인터넷 연결이 필요하며'));
  assert.ok(captionMarkup().includes('최대 3분의 원본'));
  element('#generateCaptions').id='generateCaptions';element('#generateCaptions').focus();
  await element('#generateCaptions').onclick();releaseCaptionAudio(new ArrayBuffer(0));await pendingCaptionGeneration;
  assert.equal(evaluate('transcribing'),false);assert.equal(createIsOpen(),false);
  assert.deepEqual(evaluate('state.captions'),beforeCaptionGeneration);
  assert.equal(doc.activeElement,element('#captionCreate summary'));
  vm.runInContext('sources.videoFile=null;state=initial();timelineCache=null;renderPanel()',context);
  delete context.captionTestFile;delete context.AudioContext;delete context.OfflineAudioContext;
  console.log('PASS: captions-first layout, empty/add/delete/import focus, timing notices and running/cancelled generation without a model download.');
  
  // Count failures happen before edit(): preserve history, redo, pending save and focus.
  function setCaptionLimitFixture(captions){
   context.captionLimitFixture=captions;
   vm.runInContext('state=initial();state.captions=structuredClone(captionLimitFixture);timelineCache=null;history=[];future=[];edit(()=>state.name="redo target");undo();switchPanel("captions");persistence.saveTimer={pending:true};',context);
   projectModule.createProjectDocument(evaluate('state'));
   element('#captionChunkSize').value='12';
  }
  function assertCaptionCountRejected(button){
   const before=evaluate('({state,history,future})'),timer=vm.runInContext('persistence.saveTimer',context);
   button.focus();const focused=doc.activeElement,events=focusEvents.length;
   button.onclick();
   assert.deepEqual(evaluate('({state,history,future})'),before);
   assert.equal(vm.runInContext('persistence.saveTimer',context),timer);
   assert.equal(doc.activeElement,focused);assert.equal(focusEvents.length,events);
   assert.match(element('#toast').textContent,/10,000/);
   assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(evaluate('state'))),before.state);
  }
  // A split that changes nothing must not consume redo or schedule a save.
  function assertSplitNoop(){
   const before=evaluate('({state,history,future})'),timer=vm.runInContext('persistence.saveTimer',context);
   const original=vm.runInContext('state.captions',context);element('#splitLongCaptions').focus();const events=focusEvents.length;
   element('#splitLongCaptions').onclick();
   assert.deepEqual(evaluate('({state,history,future})'),before);assert.equal(vm.runInContext('state.captions',context),original);
   assert.equal(vm.runInContext('persistence.saveTimer',context),timer);assert.equal(focusEvents.length,events);
   assert.equal(doc.activeElement,element('#splitLongCaptions'));assert.match(element('#toast').textContent,/나눌 긴 자막이 없습니다/);
  }
  for(const captions of [[],[{start:0,end:2,text:'짧은 자막'}],[{start:0,end:2,text:'  short  '}],[{start:0,end:2,text:' \t\n '}],[{start:0,end:2,text:'a'+'\u0301'.repeat(1999),basis:'timeline'}]]){
   setCaptionLimitFixture(captions);assertSplitNoop();vm.runInContext('undo(true)',context);assert.equal(evaluate('state.name'),'redo target');
  }
  // Compare values too: equivalent cloned output is unchanged, same-count content changes are edits.
  setCaptionLimitFixture([{start:0,end:2,text:' short ',basis:'timeline'}]);
  context.splitCaptionText=caption=>[structuredClone(caption)];assertSplitNoop();
  for(const patch of [{text:'short'},{start:.5},{timing:'estimated'}]){
   setCaptionLimitFixture([{start:0,end:2,text:' short ',basis:'timeline'}]);const before=evaluate('state');
   context.splitCaptionText=caption=>[{...caption,...patch}];element('#splitLongCaptions').onclick();
   const after=evaluate('state');assert.notDeepEqual(after,before);assert.equal(evaluate('history.length'),1);assert.equal(evaluate('future.length'),0);
   vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),after);
  }
  context.splitCaptionText=effectsModule.splitCaptionText;
  for(const basis of ['source','timeline']){
   setCaptionLimitFixture([{start:0,end:2,text:'short',basis},{start:2,end:8,text:'  alpha   beta gamma delta  ',basis,speaker:'1'}]);
   const before=evaluate('state');element('#splitLongCaptions').onclick();const after=evaluate('state');
   assert.notDeepEqual(after,before);assert.equal(evaluate('history.length'),1);assert.equal(evaluate('future.length'),0);
   assert.equal(after.captions.slice(1).map(c=>c.text).join('').replace(/\s/g,''),'alphabetagammadelta');
   vm.runInContext('edit(()=>state.zoom=1.5);undo();persistence.saveTimer={pending:true};',context);assertSplitNoop();
   vm.runInContext('undo(true)',context);assert.equal(evaluate('state.zoom'),1.5);
   vm.runInContext('undo();undo()',context);assert.deepEqual(evaluate('state'),before);
   vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),after);
   assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(after)),after);
  }
  console.log('PASS: no-op/repeated caption splits preserve redo, save and focus; actual text/timing/metadata and mixed splits remain undoable.');
  // Older/custom runtimes must leave the whole operation untouched, including redo/focus.
  const unsupportedSplit=vm.runInNewContext(fs.readFileSync('dist/effects.mjs','utf8').replaceAll('export ','')+';splitCaptionText',{Intl:{}});
  setCaptionLimitFixture([{start:0,end:4,text:'e\u0301'.repeat(25)}]);
  context.splitCaptionText=unsupportedSplit;
  const unsupportedBefore=evaluate('({state,history,future})'),unsupportedTimer=vm.runInContext('persistence.saveTimer',context);
  element('#splitLongCaptions').focus();const unsupportedFocus=focusEvents.length;
  element('#splitLongCaptions').onclick();
  assert.deepEqual(evaluate('({state,history,future})'),unsupportedBefore);
  assert.equal(vm.runInContext('persistence.saveTimer',context),unsupportedTimer);assert.equal(focusEvents.length,unsupportedFocus);
  assert.equal(doc.activeElement,element('#splitLongCaptions'));assert.match(element('#toast').textContent,/문자 분할/);
  context.splitCaptionText=effectsModule.splitCaptionText;
  const shortLimitCaption={start:0,end:1,text:'짧게 🎬',basis:'timeline',speaker:'1',keywords:'🎬'};
  setCaptionLimitFixture(Array.from({length:102},()=>({...shortLimitCaption,text:'가'.repeat(1200)})));
  let countedSplits=0;
  context.splitCaptionText=(...args)=>{countedSplits++;return effectsModule.splitCaptionText(...args);};
  assertCaptionCountRejected(element('#splitLongCaptions'));
  assert.equal(countedSplits,101,'stop expansion at the first overflow, before processing remaining captions');
  context.splitCaptionText=effectsModule.splitCaptionText;
  const twoParts={start:2,end:4,text:'e\u0301👩‍👩‍👧‍👦'.repeat(12),basis:'source',speaker:'0',keywords:'가'};
  setCaptionLimitFixture([...Array.from({length:captionModule.MAX_CAPTIONS-1},()=>({...shortLimitCaption})),twoParts]);
  assertCaptionCountRejected(element('#splitLongCaptions'));
  for(const basis of ['source','timeline']){
   setCaptionLimitFixture([...Array.from({length:captionModule.MAX_CAPTIONS-2},()=>({...shortLimitCaption})),{...twoParts,basis}]);
   const before=evaluate('state');element('#splitLongCaptions').onclick();
   const after=evaluate('state');assert.equal(after.captions.length,captionModule.MAX_CAPTIONS);
   const parts=after.captions.slice(-2);
   assert.equal(parts.map(c=>c.text).join(''),twoParts.text);assert.equal(parts[0].start,2);assert.equal(parts[1].end,4);
   assert.equal(parts[0].end,parts[1].start);
   parts.forEach(c=>{assert.equal(c.basis,basis);assert.equal(c.speaker,'0');assert.equal(c.keywords,'가');assert.equal(c.timing,'estimated');});
   assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(after)),after);
   assert.equal(captionModule.parseSubtitles(projectModule.projectSrt(after),12).length,captionModule.MAX_CAPTIONS);
   vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
   vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),after);
  }
  setCaptionLimitFixture(Array.from({length:captionModule.MAX_CAPTIONS},()=>({...shortLimitCaption})));
  assertCaptionCountRejected(element('#addCaption'));
  setCaptionLimitFixture(Array.from({length:captionModule.MAX_CAPTIONS-1},()=>({...shortLimitCaption})));
  const beforeLastCaption=evaluate('state');element('#addCaption').onclick();const withLastCaption=evaluate('state');
  assert.equal(withLastCaption.captions.length,captionModule.MAX_CAPTIONS);
  assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(withLastCaption)),withLastCaption);
  assertCaptionVisibleTarget(element('[data-caption-text="9999"]'));
  vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),beforeLastCaption);
  vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),withLastCaption);
  
  // Synthetic worker results check the same boundary without any model/network work.
  context.AudioContext=class {async decodeAudioData(){return {duration:1};}async close(){}};
  context.OfflineAudioContext=class {createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array([.1])};}};
  context.captionTestFile={arrayBuffer:async()=>new ArrayBuffer(0)};
  context.Worker=class {constructor(){context.captionTestWorker=this;}terminate(){}postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'result',result:context.captionTestResult??{chunks:context.captionTestChunks}}}));}};
  for(const source of ['video','audio'])for(const count of [captionModule.MAX_CAPTIONS,captionModule.MAX_CAPTIONS+1]){
   setCaptionLimitFixture([shortLimitCaption]);
   vm.runInContext('sources.videoFile=captionTestFile;sources.audioFile=captionTestFile;transcription.cancel()',context);
   element('#captionSource').value=source;
   context.captionTestChunks=Array.from({length:count},()=>({timestamp:[0,1],text:'인식된 자막'}));
   const before=evaluate('({state,history,future})'),timer=vm.runInContext('persistence.saveTimer',context);
   await vm.runInContext('generateCaptions()',context);
   if(count>captionModule.MAX_CAPTIONS){
    assert.deepEqual(evaluate('({state,history,future})'),before);
    assert.equal(vm.runInContext('persistence.saveTimer',context),timer);assert.match(element('#toast').textContent,/10,000/);
   }else{
    const result=evaluate('state');assert.equal(result.captions.length,count);
    assert.equal(result.captions[0].basis,source==='audio'?'timeline':undefined);
    assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(result)),result);
   }
  }
  // Result validation is atomic: one invalid chunk rejects the whole replacement.
  context.AudioContext=class {async decodeAudioData(){return {duration:12};}async close(){}};
  const invalidAsrResults=[
   {chunks:[{timestamp:[1,3],text:'valid'},{timestamp:[3,4],text:'x'.repeat(2001)}]},
   {text:'word '.repeat(500)},
   {text:'🎬'.repeat(1000)+'a'},
   {text:'한'.repeat(2001)},
   ...[[-1,2],[NaN,2],[0,Infinity],[0,NaN],[Infinity,3],[3,2],[2,2]].map(timestamp=>({chunks:[{timestamp:[0,1],text:'valid'},{timestamp,text:'invalid'}]})),
   {chunks:[],text:'   '},
   {chunks:[{timestamp:[0,1],text:'   '}],text:''},
  ];
  for(const source of ['video','audio']){
   for(const result of invalidAsrResults){
    setCaptionLimitFixture([shortLimitCaption]);
    vm.runInContext('sources.videoFile=captionTestFile;sources.audioFile=captionTestFile;state.audioOffset=2;transcription.cancel()',context);
    element('#captionSource').value=source;context.captionTestResult=result;
    const before=evaluate('({state,history,future})'),timer=vm.runInContext('persistence.saveTimer',context);
    await vm.runInContext('generateCaptions()',context);
    assert.deepEqual(evaluate('({state,history,future})'),before,`${source}: invalid ASR must keep the entire previous state`);
    assert.equal(vm.runInContext('persistence.saveTimer',context),timer);
    assert.equal(evaluate('transcribing'),false);assert.equal(context.captionTestWorker.onmessage,null);
    assert.doesNotMatch(element('#toast').textContent,/개의 자막을 생성/);
    assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(evaluate('state'))),before.state);
    // Retry on the existing worker, then check exact mapped payload and undo metadata.
    context.captionTestResult={chunks:[{timestamp:[1,3],text:'  valid retry 🎬  '}]};
    await vm.runInContext('generateCaptions()',context);
    const expected=source==='audio'?[{start:3,end:5,text:'valid retry 🎬',basis:'timeline'}]:[{start:1,end:3,text:'valid retry 🎬'}];
    assert.deepEqual(evaluate('state.captions'),expected);
    assert.equal(evaluate('transcribing'),false);
    const after=evaluate('state');
    assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(after)),after);
    assert.equal((await context.window.moment.execute('project.get')).ok,true);
    assert.equal((await context.window.moment.execute('captions.export')).ok,true);
    vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before.state);
    vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),after);
   }
   for(const text of ['a'.repeat(2000),'한'.repeat(2000),'🎬'.repeat(1000),'e\u0301'.repeat(1000)]){
    for(const fallback of [false,true]){
     setCaptionLimitFixture([shortLimitCaption]);
     vm.runInContext('sources.videoFile=captionTestFile;sources.audioFile=captionTestFile;state.audioOffset=2;transcription.cancel()',context);
     element('#captionSource').value=source;
     context.captionTestResult=fallback?{chunks:[],text}:{chunks:[{timestamp:[0,null],text}]};
     await vm.runInContext('generateCaptions()',context);
     const expected={start:source==='audio'?2:0,end:12,text,...(source==='audio'?{basis:'timeline'}:{})};
     assert.deepEqual(evaluate('state.captions'),[expected]);
     const after=evaluate('state');assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(after)),after);
    }
   }
  }
  // Canonical source bounds still reject a finite cue extending beyond the source.
  setCaptionLimitFixture([shortLimitCaption]);
  vm.runInContext('sources.videoFile=captionTestFile;transcription.cancel()',context);element('#captionSource').value='video';
  context.captionTestResult={chunks:[{timestamp:[0,13],text:'outside source'}]};
  const beforeOutOfBounds=evaluate('({state,history,future})');
  await vm.runInContext('generateCaptions()',context);assert.deepEqual(evaluate('({state,history,future})'),beforeOutOfBounds);
  // Validation is pure; it must not release the transcription guard to commit a command.
  const beforeValidationWorker=context.Worker;
  context.Worker=class extends beforeValidationWorker {postMessage(){assert.equal(evaluate('transcribing'),true);super.postMessage();}};
  context.captionTestResult={text:'valid fallback'};
  await vm.runInContext('generateCaptions()',context);
  assert.deepEqual(evaluate('state.captions'),[{start:0,end:12,text:'valid fallback'}]);context.Worker=beforeValidationWorker;
  delete context.captionTestResult;
  console.log('PASS: ASR validation preserves prior state/redo/save on invalid chunks or fallback; Unicode boundaries, both clocks, cleanup, retry and canonical JSON succeed.');
  
  // Synthetic delayed worker/decode responses; no model, real audio or storage.
  const asrWorkers=[];let workerPosted;
  context.Worker=class {constructor(){asrWorkers.push(this);}postMessage(){workerPosted(this);}terminate(){this.terminated=true;this.terminateCalls=(this.terminateCalls||0)+1;}};
  context.AudioContext=class {async decodeAudioData(){return {duration:1};}async close(){}};
  context.asrSourceFile={name:'synthetic.wav',arrayBuffer:async()=>new ArrayBuffer(0)};
  vm.runInContext('globalThis.asrScheduleSave=scheduleSave;globalThis.asrSaves=0;scheduleSave=()=>asrSaves++;',context);
  function resetAsr(){vm.runInContext('state=initial();state.audioName=asrSourceFile.name;state.audioOffset=2;timelineCache=null;history=[];future=[JSON.stringify(state)];current=0;selected=0;sources.videoFile=asrSourceFile;sources.audioFile=asrSourceFile;transcription.cancel();transcribing=false;asrSaves=0;persistence.saveTimer={pending:true};panel="captions";renderPanel();',context);}
  async function startAsr(source){
   element('#captionSource').value=source;
   const posted=new Promise(resolve=>{workerPosted=resolve;});
   const pending=vm.runInContext('generateCaptions()',context),worker=await posted;
   return {pending,worker};
  }
  function asrResult(worker,text='recognized'){worker.onmessage({data:{type:'result',result:{chunks:[{timestamp:[0,1],text}]}}});}
  const asrSnapshot=()=>evaluate('[state,history,future,asrSaves]');
  for(const source of ['video','audio']){
   for(const mutation of [
    'edit(()=>state.captions[0].text="manual correction")',
    'edit(()=>state.captions[0].speaker="1")',
    'edit(()=>state.captions.push({start:1,end:2,text:"added"}))',
    'edit(()=>state.captions.splice(0,1))',
    'edit(()=>state.captions=structuredClone(state.captions))',
    'edit(()=>state.zoom=1.5);undo()',
    'edit(()=>state.zoom=1.5);undo();undo(true)',
    'state=structuredClone(state);timelineCache=null',
    source==='audio'?'sources.audioFile={...asrSourceFile}':'sources.videoFile={...asrSourceFile}',
    'edit(()=>{state.duration=10;state.clips=[{start:0,end:10}];})',
    ...(source==='audio'?['edit(()=>state.audioOffset=3)','edit(()=>state.clips[0].end=8)']:[]),
   ]){
    resetAsr();const task=await startAsr(source);vm.runInContext(mutation,context);
    const before=asrSnapshot(),timer=vm.runInContext('persistence.saveTimer',context);
    asrResult(task.worker);await task.pending;
    assert.deepEqual(asrSnapshot(),before,`${source}: conflict preserves current edits/history/redo/saves`);
    assert.equal(vm.runInContext('persistence.saveTimer',context),timer);assert.match(element('#toast').textContent,/변경되어/);
    assert.equal(evaluate('transcribing'),false);assert.equal(asrWorkers.at(-1).onmessage,null);
   }
   resetAsr();const allowed=await startAsr(source);
   vm.runInContext('edit(()=>{state.zoom=1.5;state.volume=.4;state.captionColor="#123456";});current=2;',context);
   vm.runInContext(source==='video'?'edit(()=>state.clips[0].end=8)':'edit(()=>state.clips=[{start:6,end:12},{start:0,end:6}])',context);
   const before=evaluate('state'),historyLength=evaluate('history.length');asrResult(allowed.worker);await allowed.pending;
   assert.equal(evaluate('state.zoom'),1.5);assert.equal(evaluate('state.volume'),.4);
   assert.deepEqual(evaluate('state.clips'),before.clips);
   assert.deepEqual(evaluate('state.captions'),source==='audio'?[{start:2,end:3,text:'recognized',basis:'timeline'}]:[{start:0,end:1,text:'recognized'}]);
   assert.equal(evaluate('history.length'),historyLength+1);
   vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
  }
  resetAsr();const removedAudio=await startAsr('audio');vm.runInContext('switchPanel("audio")',context);element('#removeAudio').onclick();
  const removedBefore=asrSnapshot();asrResult(removedAudio.worker);await removedAudio.pending;
  assert.deepEqual(asrSnapshot(),removedBefore);assert.equal(evaluate('state.audioName'),'');assert.match(element('#toast').textContent,/변경되어/);
  // A conflict during decoding does not submit work to a model worker.
  resetAsr();let releaseAsrRead;context.asrDelayedFile={arrayBuffer:()=>new Promise(resolve=>{releaseAsrRead=resolve;})};
  vm.runInContext('sources.videoFile=asrDelayedFile',context);element('#captionSource').value='video';
  const decoding=vm.runInContext('generateCaptions()',context),workerCount=asrWorkers.length;
  vm.runInContext('edit(()=>state.captions[0].text="edited during read")',context);const decodeBefore=asrSnapshot();
  releaseAsrRead(new ArrayBuffer(0));await decoding;
  assert.deepEqual(asrSnapshot(),decodeBefore);assert.equal(asrWorkers.length,workerCount);
  // Provider-reported errors leave the job retryable without applying any result.
  for(const failure of ['message','worker']){
   resetAsr();const task=await startAsr('video'),before=asrSnapshot();
   const oldMessage=task.worker.onmessage,oldError=task.worker.onerror;
   if(failure==='message')task.worker.onmessage({data:{type:'error',message:'synthetic provider failure'}});else task.worker.onerror();
   await task.pending;assert.deepEqual(asrSnapshot(),before);assert.equal(evaluate('transcribing'),false);
   if(failure==='worker'){assert.equal(task.worker.terminateCalls,1);assert.equal(task.worker.onmessage,null);oldError();assert.equal(task.worker.terminateCalls,1);}
   else{assert.equal(task.worker.terminateCalls,undefined);assert.equal(task.worker.onmessage,null);}
   const retry=await startAsr('video');assert.equal(retry.worker===task.worker,failure==='message');
   const status=evaluate('transcriptionStatus');oldMessage({data:{type:'progress',message:'stale progress'}});oldMessage({data:{type:'result',result:{text:'stale result'}}});oldError();
   assert.equal(evaluate('transcriptionStatus'),status);assert.equal(evaluate('transcribing'),true);assert.equal(typeof retry.worker.onmessage,'function');
   assert.deepEqual(asrSnapshot(),before);assert.equal(retry.worker.terminated,undefined);
   asrResult(retry.worker,'retried');await retry.pending;assert.equal(evaluate('state.captions[0].text'),'retried');
  }
  // Healthy completed workers are reused; an idle native failure retires the cache.
  resetAsr();const healthy=await startAsr('video');asrResult(healthy.worker);await healthy.pending;
  const warm=await startAsr('video');assert.equal(warm.worker,healthy.worker);asrResult(warm.worker,'warm result');await warm.pending;
  const idleBefore=asrSnapshot(),idleFailure=warm.worker.onerror;idleFailure();idleFailure();
  assert.deepEqual(asrSnapshot(),idleBefore);assert.equal(warm.worker.terminateCalls,1);assert.equal(warm.worker.onmessage,null);
  const afterIdle=await startAsr('video');assert.notEqual(afterIdle.worker,warm.worker);idleFailure();
  assert.equal(typeof afterIdle.worker.onmessage,'function');asrResult(afterIdle.worker);await afterIdle.pending;
  // Startup and synchronous transport failures never leave an unusable cached worker.
  const workingWorker=context.Worker;
  for(const failure of ['constructor','postMessage']){
   resetAsr();const before=asrSnapshot(),count=asrWorkers.length;
   context.Worker=failure==='constructor'?class {constructor(){throw new Error('synthetic constructor failure');}}:class extends workingWorker {postMessage(){throw new Error('synthetic postMessage failure');}};
   element('#captionSource').value='video';await vm.runInContext('generateCaptions()',context);
   assert.deepEqual(asrSnapshot(),before);assert.equal(evaluate('transcribing'),false);
   if(failure==='postMessage')assert.equal(asrWorkers.at(-1).terminateCalls,1);else assert.equal(asrWorkers.length,count);
   context.Worker=workingWorker;const retry=await startAsr('video');asrResult(retry.worker);await retry.pending;assert.equal(evaluate('state.captions[0].text'),'recognized');
  }
  // A second request cancels, never creates concurrent work. Late old results stay inert.
  resetAsr();const cancelled=await startAsr('video'),cancelBefore=asrSnapshot(),lateResult=cancelled.worker.onmessage,lateError=cancelled.worker.onerror;
  await vm.runInContext('generateCaptions()',context);await cancelled.pending;
  assert.equal(cancelled.worker.terminated,true);assert.deepEqual(asrSnapshot(),cancelBefore);
  const retryAfterCancel=await startAsr('video');assert.notEqual(retryAfterCancel.worker,cancelled.worker);
  lateResult({data:{type:'result',result:{text:'stale cancelled result'}}});assert.deepEqual(asrSnapshot(),cancelBefore);
  const retryStatus=evaluate('transcriptionStatus');lateResult({data:{type:'progress',message:'cancelled progress'}});lateError();
  assert.equal(evaluate('transcriptionStatus'),retryStatus);assert.equal(typeof retryAfterCancel.worker.onmessage,'function');assert.equal(cancelled.worker.terminateCalls,1);
  asrResult(retryAfterCancel.worker,'new job');await retryAfterCancel.pending;assert.equal(evaluate('state.captions[0].text'),'new job');
  // Cancel can arrive after the result promise resolves but before it is consumed.
  resetAsr();const resolved=await startAsr('video'),resolvedBefore=asrSnapshot();
  asrResult(resolved.worker);await vm.runInContext('generateCaptions()',context);await resolved.pending;
  assert.deepEqual(asrSnapshot(),resolvedBefore);assert.match(element('#toast').textContent,/취소/);
  vm.runInContext('scheduleSave=asrScheduleSave;',context);
  console.log('PASS: synthetic ASR conflicts preserve edits/history/redo/saves; source removal, time maps, decode/worker delays, cancellation/late responses, provider errors, retry and unaffected appearance edits are covered.');
  console.log('PASS: synthetic worker startup/native/postMessage failures retire only their instance; explicit retry, warm reuse, job errors, idle failure and stale message/error callbacks preserve state.');
  vm.runInContext('sources.videoFile=null;sources.audioFile=null;transcription.cancel()',context);
  delete context.AudioContext;delete context.OfflineAudioContext;delete context.Worker;delete context.captionTestFile;delete context.captionTestChunks;
  vm.runInContext('state=initial();timelineCache=null;history=[];future=[];renderPanel()',context);
  delete context.captionLimitFixture;
  console.log('PASS: split/add/ASR count boundaries, early rejection without mutation/redo/save/focus loss, Unicode and time-base metadata, exact-boundary JSON/SRT export and undo/redo.');
  
});
