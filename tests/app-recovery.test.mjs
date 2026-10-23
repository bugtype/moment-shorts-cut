import { createTemplatePreview } from '../dist/template-preview.mjs';
import { createAudioRecording } from '../dist/audio-recording.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as projectModule from '../dist/core/project.mjs';
import { createAppFixture } from './fixtures/app.mjs';

import * as templateModule from '../dist/template-catalog.mjs';
import { mountTemplateGallery } from '../dist/template-gallery.mjs';

test('restore protection and isolated template library failures', async () => {
  const { source, context, evaluate, element } = await createAppFixture();
  const originalGetItem=context.localStorage.getItem;
  const corruptSaved=projectModule.createDemoProject();corruptSaved.design=null;
  context.localStorage.getItem=key=>key==='moment-state-v1'?JSON.stringify(corruptSaved):null;
  await vm.runInContext('init()',context);
  assert.doesNotThrow(()=>projectModule.validateProject(evaluate('state')));
  assert.match(element('#saveStatus').innerHTML,/편집 설정을 읽을 수 없습니다/);
  context.localStorage.getItem=originalGetItem;
  console.log('PASS: corrupt browser storage is rejected before rendering.');
  
  // Each recovery scenario gets a fresh app VM and synthetic storage/media only.
  function recoveryApp({raw=null,media={},readError=null,mediaError=null,decodeError=null,audioResult='loadeddata',audioDuration=5,readGate=null,templateRaw=null,favoritesRaw=null,libraryReadError=null,libraryWriteError=null}={}){
   const f={raw,media:structuredClone(media),jsonWrites:0,mediaWrites:0,reads:0,downloads:[],events:new Map(),timers:[],micCalls:0,libraryWrites:[],library:{'moment-templates-v1':templateRaw,'moment-favorites-v1':favoritesRaw}};
   const audioEvents=new Map(),fixtureAudio={duration:audioDuration,paused:true,pause(){this.paused=true;},removeAttribute(){},addEventListener(name,handler){audioEvents.set(name,handler);},removeEventListener(name){audioEvents.delete(name);},set src(value){queueMicrotask(()=>audioEvents.get(audioResult)?.());}};
   const app=vm.createContext({...context,
    createTemplatePreview: options => createTemplatePreview(options, {
      requestFrame: callback => app.requestAnimationFrame(callback),
      cancelFrame: id => app.cancelAnimationFrame(id),
      clock: () => app.performance.now(),
    }),
    createAudioRecording: callbacks => createAudioRecording(callbacks, {
      acquireStream: () => app.navigator.mediaDevices.getUserMedia({audio:true}),
      createRecorder: stream => new app.MediaRecorder(stream),
      createFile: (chunks,name,options) => new app.File(chunks,name,options),
      setTimer: (callback,delay) => app.setInterval(callback,delay),
      clearTimer: timer => app.clearInterval(timer),
    }),
    document:{...context.document,querySelector:selector=>selector==='#sourceAudio'?fixtureAudio:context.document.querySelector(selector)},
    window:{addEventListener:(name,handler)=>f.events.set(name,handler)},
    localStorage:{getItem(key){if(key in f.library){if(libraryReadError)throw libraryReadError;return f.library[key];}if(key!=='moment-state-v1')return null;if(readError)throw readError;return f.raw;},setItem(key,value){if(key in f.library){if(libraryWriteError)throw libraryWriteError;f.libraryWrites.push(key);f.library[key]=value;return;}assert.equal(key,'moment-state-v1');f.jsonWrites++;f.raw=value;}},
    createProjectStore:()=>({async get(key){f.reads++;if(readGate)await readGate;if(mediaError)throw mediaError;return structuredClone(f.media[key]);},setMedia(video,audio){f.mediaWrites++;f.media={video,audio};return Promise.resolve();}}),
    URL:{createObjectURL:()=> 'blob:synthetic-recovery',revokeObjectURL(){}},
    navigator:{mediaDevices:{getUserMedia(){f.micCalls++;throw new Error('Unexpected microphone call');}}},
    requestAnimationFrame:()=>0,cancelAnimationFrame(){},
    setTimeout(callback,delay){const timer={callback,cancelled:false};f.timers.push(timer);if(delay===20000&&audioResult==='timeout')queueMicrotask(()=>{if(!timer.cancelled)callback();});return timer;},clearTimeout(timer){if(timer)timer.cancelled=true;},
    fixtureDecodeError:decodeError,fixtureDownloads:f.downloads,
   });
   vm.runInContext(source.replace(/^import .*;$/gm,'').replace(/init\(\);\s*$/,''),app);
   const run=code=>vm.runInContext(code,app);
   run('setVideoFile=async()=>{if(fixtureDecodeError)throw fixtureDecodeError;};download=(blob,name)=>fixtureDownloads.push({blob,name});');
   return {...f,app,run,f,init:()=>run('init()'),value:code=>JSON.parse(JSON.stringify(run(code)))};
  }
  const recoveryProject=projectModule.createDemoProject();
  Object.assign(recoveryProject,{kind:'video',fileName:'saved.mp4',audioName:'voice.wav',audioOffset:1,audioVolume:.4,clips:[{start:2,end:7}],captions:[{start:1,end:3,text:'보존할 음성 자막',basis:'timeline'}]});
  recoveryProject.design.title.lines=['보존할 제목',''];
  const recoveryRaw=JSON.stringify(recoveryProject),recoveryMedia={video:{name:'saved.mp4'},audio:{name:'voice.wav'}};
  for(const options of [
   {decodeError:new Error('decoder failure')},
   {decodeError:new Error('decoder timeout')},
   {audioResult:'error'},
   {audioResult:'timeout'},
   {audioDuration:NaN},
   {audioDuration:0},
   {media:{audio:recoveryMedia.audio}},
   {media:{video:recoveryMedia.video}},
   {mediaError:new Error('storage read failed')},
  ]){
   const a=recoveryApp({raw:recoveryRaw,media:recoveryMedia,...options});await a.init();
   assert.equal(a.run('restorePhase'),'failed');assert.deepEqual(a.value('state'),recoveryProject);
   assert.match(element('#saveStatus').innerHTML,/변경사항은 저장되지 않습니다/);
   assert.match(element('#saveStatus').innerHTML,/새로고침 전에.*내보내세요/);
   let cancelled=false;const unload=()=>{cancelled=false;a.f.events.get('beforeunload')({preventDefault(){cancelled=true;}});return cancelled;};
   assert.equal(unload(),false);
   assert.equal(a.run('runEditorCommand("project.update",{patch:{name:"메모리에서 편집"}})'),true);
   assert.equal(unload(),true);
   a.run('undo()');assert.deepEqual(a.value('state'),recoveryProject);assert.equal(unload(),false);
   a.run('undo(true)');assert.equal(a.run('state.audioName'),'voice.wav');assert.equal(unload(),true);
   a.run('downloadProjectSettings();downloadSrt()');
   assert.deepEqual(JSON.parse(await a.f.downloads[0].blob.text()).project,a.value('state'));
   assert.equal(unload(),true,'Starting a download does not confirm a successful backup');
   const api=await a.app.window.moment.execute('project.get');assert.equal(api.ok,true);assert.equal(api.data.project.audioName,'voice.wav');
   const imported=await a.app.window.moment.execute('project.import',{document:projectModule.createProjectDocument(recoveryProject)});assert.equal(imported.ok,true);
   const before=a.value('state'),files=structuredClone(a.f.media);
   a.run('switchPanel("audio")');if(a.run('audioFile'))element('#removeAudio').onclick();
   await a.run('loadVideo({name:"new.mp4",type:"video/mp4",size:1});loadAudio({name:"new.wav",size:1});toggleRecording();generateCaptions();play();startExport({mime:"video/webm",ext:"webm"},720)');
   a.run('confirmReset();exportDialog();persistMedia();scheduleSave()');await a.run('saveProject(true)');
   assert.deepEqual(a.value('state'),before);assert.deepEqual(a.f.media,files);
   assert.equal(a.f.micCalls,0);assert.equal(a.run('playing'),false);assert.equal(a.run('exporting'),false);
   assert.equal(a.f.jsonWrites,0);assert.equal(a.f.mediaWrites,0);assert.equal(a.f.raw,recoveryRaw);
   assert.match(element('#saveStatus').innerHTML,/변경사항은 저장되지 않습니다/);
  }
  for(const raw of ['', ' ', 'null', 'false', '42', '[]', '{}', '{broken', JSON.stringify({...recoveryProject,clips:[]}),JSON.stringify({...recoveryProject,design:null})]){
   const a=recoveryApp({raw});await a.init();assert.equal(a.run('restorePhase'),'failed');
   assert.equal(a.run('recoveryValid'),false);assert.equal(a.f.reads,0);
   a.run('edit(()=>state.name="임시 화면");downloadProjectSettings();downloadSrt();persistMedia();scheduleSave()');await a.run('saveProject(true)');
   assert.equal(a.f.downloads.length,0);assert.equal(a.f.jsonWrites,0);assert.equal(a.f.mediaWrites,0);assert.equal(a.f.raw,raw);
   assert.equal((await a.app.window.moment.execute('project.get')).error.code,'RECOVERY_REQUIRED');
  }
  const readFailure=recoveryApp({readError:new Error('storage blocked')});await readFailure.init();
  assert.equal(readFailure.run('restorePhase'),'failed');await readFailure.run('saveProject(true)');assert.equal(readFailure.f.jsonWrites,0);
  const emptyStart=recoveryApp();await emptyStart.init();assert.equal(emptyStart.run('restorePhase'),'ready');assert.equal(emptyStart.f.reads,0);
  await emptyStart.run('saveProject()');assert.equal(emptyStart.f.jsonWrites,1);
  emptyStart.run('confirmReset()');element('#confirmReset').onclick();await emptyStart.run('saveProject()');assert.equal(emptyStart.f.mediaWrites,1);
  const retried=recoveryApp({raw:recoveryRaw,media:recoveryMedia});await retried.init();
  assert.equal(retried.run('restorePhase'),'ready');assert.deepEqual(retried.value('state'),recoveryProject);
  await retried.run('saveProject(true)');assert.equal(retried.f.jsonWrites,1);assert.equal(retried.f.mediaWrites,1);
  const unknownAudioDuration=recoveryApp({raw:recoveryRaw,media:recoveryMedia,audioDuration:Infinity});
  await unknownAudioDuration.init();assert.equal(unknownAudioDuration.run('restorePhase'),'ready','Loaded audio with unknown duration remains supported');
  const noAudioProject={...recoveryProject,audioName:''};
  const noAudio=recoveryApp({raw:JSON.stringify(noAudioProject),media:{video:recoveryMedia.video}});await noAudio.init();assert.equal(noAudio.run('restorePhase'),'ready');
  
  let finishRead;const restoring=recoveryApp({raw:recoveryRaw,media:recoveryMedia,readGate:new Promise(resolve=>finishRead=resolve)});
  const initializing=restoring.init();assert.equal(restoring.run('restorePhase'),'restoring');
  restoring.run('persistMedia();scheduleSave();confirmReset()');await restoring.run('saveProject(true)');
  assert.equal(restoring.f.jsonWrites,0);assert.equal(restoring.f.mediaWrites,0);
  assert.equal((await restoring.app.window.moment.execute('project.update',{patch:{name:'too early'}})).error.code,'BUSY');
  finishRead();await initializing;assert.equal(restoring.run('restorePhase'),'ready');
  assert.match(element('#saveStatus').innerHTML,/저장된 프로젝트를 불러왔습니다/);
  
  const stale=recoveryApp();await stale.init();stale.run('scheduleSave();confirmReset()');
  const staleTimer=stale.f.timers.at(-1),oldReset=element('#confirmReset').onclick;
  stale.run('switchPanel("audio");audioFile={name:"voice.wav"};renderPanel()');const oldRemove=element('#removeAudio').onclick;
  let finishSave;stale.app.fixturePending=new Promise(resolve=>finishSave=resolve);stale.run('pendingSave=fixturePending');
  const saving=stale.run('saveProject()');stale.f.raw='null';await stale.init();
  assert.equal(staleTimer.cancelled,true);finishSave();await saving;await staleTimer.callback();oldReset();oldRemove();
  assert.equal(stale.f.jsonWrites,0);assert.equal(stale.f.mediaWrites,0);assert.equal(stale.f.raw,'null');
  assert.match(element('#saveStatus').innerHTML,/변경사항은 저장되지 않습니다/);
  console.log('PASS: protected restore preserves settings/metadata/export, blocks writes and media actions, distinguishes absent/invalid storage, guards stale callbacks, warns on memory-only edits and retries in a fresh app instance.');
  
  // Library faults are isolated from project startup; all storage here is synthetic.
  const libraryProject=projectModule.createDemoProject();templateModule.applyTemplate(libraryProject,templateModule.TEMPLATES[3],true);
  const validLibraryTemplate=templateModule.saveCustomTemplate('Fixture template',libraryProject);
  for(const options of [
   {templateRaw:'[null]'},{templateRaw:'[1]'}, {templateRaw:'{}'}, {templateRaw:''}, {templateRaw:'null'},
   {templateRaw:JSON.stringify([validLibraryTemplate,null])},
   {templateRaw:JSON.stringify([{...validLibraryTemplate,settings:{}}])},
   {templateRaw:JSON.stringify([validLibraryTemplate]),favoritesRaw:'[null]'},
   {libraryReadError:new Error('synthetic library read failure')},
  ]){
   const r=recoveryApp({...options,raw:JSON.stringify({...projectModule.createDemoProject(),name:'preserved project'})});let api;
   r.app.mountTemplateGallery=(root,value)=>{api=value;mountTemplateGallery(root,value);};
   await r.init();assert.equal(r.value('editorReady'),true);assert.equal(r.value('restorePhase'),'ready');assert.equal(r.value('state.name'),'preserved project');
   assert.match(r.value('templateLibraryError'),/원본 저장값은 유지/);assert.ok(element('#panelContent').innerHTML.includes('role="alert"'));
   const stored=structuredClone(r.f.library),before=r.value('({savedTemplates,favoriteTemplates,state,history,future})');
   api.favorite('reference');api.remove('unknown');r.run('saveTemplateDialog();persistTemplateLibrary();');
   assert.deepEqual(r.value('({savedTemplates,favoriteTemplates,state,history,future})'),before);
   assert.deepEqual(r.f.library,stored);assert.equal(r.f.libraryWrites.length,0);assert.equal(r.f.jsonWrites,0);assert.equal(r.f.mediaWrites,0);
   assert.equal((await r.app.window.moment.execute('template.apply',{templateId:'clean'})).ok,true);
   assert.equal((await r.app.window.moment.execute('project.update',{patch:{name:'still editable'}})).ok,true);
   assert.equal(r.value('state.name'),'still editable');assert.deepEqual(r.f.library,stored);
  }
  for(const writeFailure of [false,true]){
   const r=recoveryApp({templateRaw:JSON.stringify([validLibraryTemplate]),favoritesRaw:'["reference"]',libraryWriteError:writeFailure?new Error('synthetic quota'):null});let api;
   r.app.mountTemplateGallery=(root,value)=>{api=value;mountTemplateGallery(root,value);};
   await r.init();assert.equal(r.value('templateLibraryError'),'');assert.equal(r.value('savedTemplates.length'),1);
   r.run('templatePreview.draw(document.createElement("canvas"),savedTemplates[0])'); // synthetic canvas only
   api.favorite('clean');assert.equal(r.value('favoriteTemplates.includes("clean")'),!writeFailure);
   if(!writeFailure){assert.equal(JSON.parse(r.f.library['moment-favorites-v1']).includes('clean'),true);}
   else {assert.equal(r.f.libraryWrites.length,0);assert.deepEqual(r.value('favoriteTemplates'),['reference']);}
   r.run('saveTemplateDialog()');element('#customTemplateName').value='Second fixture';element('#saveCustomTemplate').onclick();
   assert.equal(r.value('savedTemplates.length'),writeFailure?1:2);
   api.remove(validLibraryTemplate.id);element('#confirmRemoveTemplate').onclick();
   assert.equal(r.value('savedTemplates.length'),1);assert.equal(r.value('savedTemplates[0].id')===validLibraryTemplate.id,writeFailure);
   if(writeFailure)assert.equal(r.f.libraryWrites.length,0);
   else assert.equal(JSON.parse(r.f.library['moment-templates-v1']).length,1);
  }
  console.log('PASS: malformed template/favorites data and read failures preserve raw storage, isolate library writes and keep startup/built-in editing usable; valid reload and write rollback pass.');
});
