import { createTemplateWorkspace } from '../dist/template-workspace.mjs';
import { createMediaSources } from '../dist/media-sources.mjs';
import { createProjectPersistence } from '../dist/project-persistence.mjs';
import { createCaptionGeneration } from '../dist/caption-generation.mjs';
import { createTemplatePreview } from '../dist/template-preview.mjs';
import { createAudioRecording } from '../dist/audio-recording.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as projectModule from '../dist/core/project.mjs';
import { createAppFixture } from './fixtures/app.mjs';

import * as templateModule from '../dist/template-catalog.mjs';
import { mountTemplateGallery } from '../dist/template-gallery.mjs';
import fs from 'node:fs';

test('startup mounts the restored panel once and retains independent font/sample refreshes', async () => {
  const staticIds = new Set([...fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
    .matchAll(/id="([\w-]+)"/g)].map(match => match[1]));
  for (const mode of ['empty', 'restored', 'corrupt', 'deferred-settings']) {
    let mounts = 0, writes = 0, reads = 0, resolveFonts;
    const fontSet = {ready: new Promise(resolve => { resolveFonts = resolve; })};
    const project = projectModule.createDemoProject();
    Object.assign(project, {name: '복구 프로젝트', ratio: '4:5', volume: .42});
    const f = await createAppFixture({fontSet, beforeInit({context, doc, element}) {
      let markup = '';
      Object.defineProperty(element('#panelContent'), 'innerHTML', {
        configurable: true, get: () => markup,
        set(value) { markup = String(value); mounts++; },
      });
      // Unlike the general fixture, absent optional panel controls are null.
      const query = doc.querySelector;
      doc.querySelector = selector => /^#[\w-]+$/.test(selector) && !staticIds.has(selector.slice(1)) &&
        !markup.includes(`id="${selector.slice(1)}"`) ? null : query(selector);
      context.localStorage.getItem = key => key === 'moment-state-v1'
        ? mode === 'empty' ? null : mode === 'corrupt' ? 'null' : JSON.stringify(project) : null;
      context.localStorage.setItem = () => { writes++; };
      context.createProjectStore = () => ({
        async get() {
          reads++;
          if (mode === 'deferred-settings') {
            if (reads === 1) queueMicrotask(() => vm.runInContext("switchPanel('settings', {openSheet:false})", context));
            await Promise.resolve();
          }
          return undefined;
        },
        setMedia() { assert.fail('Startup must not write media'); },
      });
    }});
    const settings = mode === 'deferred-settings';
    assert.equal(mounts, settings ? 2 : 1, mode); // Explicit pending navigation + one final mount.
    assert.equal(f.evaluate('editorReady'), true);
    assert.equal(f.evaluate('persistence.restorePhase'), mode === 'corrupt' ? 'failed' : 'ready');
    assert.equal(f.evaluate('panel'), settings ? 'settings' : 'templates');
    assert.equal(reads, ['restored', 'deferred-settings'].includes(mode) ? 2 : 0);
    if (mode === 'restored' || settings) assert.deepEqual(f.evaluate('state'), project);
    if (settings) {
      assert.equal(f.element('#mobileZoom').value, '1');
      assert.equal(f.element('#panelVolume').value, '0.42');
      assert.match(f.element('#savePreviewPng').getAttribute('aria-label'), /540.*675/);
      assert.equal(typeof f.element('#openScenePng').onclick, 'function');
    } else assert.match(f.element('#panelContent').innerHTML, /template-grid/);
    const before = f.evaluate('({state, current, selected, history, future})');
    assert.equal(before.history.length, 0); assert.equal(before.future.length, 0);
    const initial = mounts;
    resolveFonts(); await Promise.resolve(); await Promise.resolve();
    assert.equal(mounts, initial + (settings ? 0 : 1));
    vm.runInContext('sample.complete=true;sample.onload()', f.context);
    assert.equal(mounts, initial + (settings ? 0 : 2));
    assert.deepEqual(f.evaluate('({state, current, selected, history, future})'), before);
    assert.equal(writes, 0);
    for (const [id, callback] of f.pendingFrames) { f.pendingFrames.delete(id); callback(performance.now()); }
    assert.equal(f.pendingFrames.size, 0);
  }
});

test('restore protection and isolated template library failures', async () => {
  const { context, evaluate, element } = await createAppFixture();
  const originalGetItem=context.localStorage.getItem;
  const corruptSaved=projectModule.createDemoProject();corruptSaved.design=null;
  context.localStorage.getItem=key=>key==='moment-state-v1'?JSON.stringify(corruptSaved):null;
  await vm.runInContext('init()',context);
  assert.doesNotThrow(()=>projectModule.validateProject(evaluate('state')));
  assert.match(element('#saveStatus').innerHTML,/편집 설정을 읽을 수 없습니다/);
  context.localStorage.getItem=originalGetItem;
  console.log('PASS: corrupt browser storage is rejected before rendering.');
  
  // Own the base VM, DOM and callbacks per recovery; native i18n remains shared.
  async function recoveryApp({raw=null,media={},readError=null,mediaError=null,decodeError=null,audioResult='loadeddata',audioDuration=5,readGate=null,templateRaw=null,favoritesRaw=null,libraryReadError=null,libraryWriteError=null}={}){
   const { source, context } = await createAppFixture();
   const f={raw,media:structuredClone(media),jsonWrites:0,mediaWrites:0,reads:0,downloads:[],events:new Map(),timers:[],micCalls:0,libraryWrites:[],library:{'moment-templates-v1':templateRaw,'moment-favorites-v1':favoritesRaw}};
   const audioEvents=new Map(),fixtureAudio={duration:audioDuration,paused:true,pause(){this.paused=true;},removeAttribute(){},addEventListener(name,handler){audioEvents.set(name,handler);},removeEventListener(name){audioEvents.delete(name);},set src(value){queueMicrotask(()=>audioEvents.get(audioResult)?.());}};
   const app=vm.createContext({...context,
    createTemplateWorkspace: options => createTemplateWorkspace(options, {
      readStorage: key => app.localStorage.getItem(key),
      writeStorage: (key, value) => app.localStorage.setItem(key, value),
      mount: (root, options) => app.mountTemplateGallery(root, options),
    }),
    createMediaSources: options => createMediaSources(options, {
      createURL: file => app.URL.createObjectURL(file),
      revokeURL: url => app.URL.revokeObjectURL(url),
      createCanvas: () => app.document.createElement('canvas'),
      setTimer: (callback, delay) => app.setTimeout(callback, delay),
      clearTimer: timer => app.clearTimeout(timer),
    }),
    createProjectPersistence: options => createProjectPersistence(options, {
      readSettings: key => app.localStorage.getItem(key),
      writeSettings: (key, value) => app.localStorage.setItem(key, value),
      setTimer: (callback, delay) => app.setTimeout(callback, delay),
      clearTimer: timer => app.clearTimeout(timer),
    }),
    createCaptionGeneration: options => createCaptionGeneration(options, {
      createAudioContext: () => new app.AudioContext(),
      createOfflineContext: (...args) => new app.OfflineAudioContext(...args),
    }),
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
   run('sources.setVideoFile=async()=>{if(fixtureDecodeError)throw fixtureDecodeError;};download=(blob,name)=>fixtureDownloads.push({blob,name});');
   assert.equal(run('getLocale()'),'ko','Recovery expectations use the Korean locale');
   return {...f,app,run,f,element:app.document.querySelector,init:()=>run('init()'),value:code=>JSON.parse(JSON.stringify(run(code)))};
  }
  // Retained controls must keep their recovery owner when another fixture starts.
  for(const failedFirst of [false,true]){
   const first=await recoveryApp({raw:failedFirst?'null':null});await first.init();
   const button=first.element('#saveButton'),handler=button.onclick,status=first.element('#saveStatus').innerHTML;
   const second=await recoveryApp({raw:failedFirst?null:'null'});await second.init();
   assert.equal(first.run('persistence.restorePhase'),failedFirst?'failed':'ready');
   assert.equal(second.run('persistence.restorePhase'),failedFirst?'ready':'failed');
   assert.notEqual(button,second.element('#saveButton'),'Recovery fixtures must not share controls');
   assert.equal(button.onclick,handler);
   assert.equal(first.element('#saveStatus').innerHTML,status);
   assert.equal(first.element('#sourceAudio'),first.run('audio'));
   assert.notEqual(first.element('#sourceAudio'),second.element('#sourceAudio'));
   await button.onclick();
   assert.equal(first.f.jsonWrites,failedFirst?0:1);assert.equal(second.f.jsonWrites,0);
   await second.element('#saveButton').onclick();
   assert.equal(first.f.jsonWrites,failedFirst?0:1);assert.equal(second.f.jsonWrites,failedFirst?1:0);
   assert.equal(first.f.mediaWrites,0);assert.equal(second.f.mediaWrites,0);
   assert.equal(first.f.micCalls,0);assert.equal(second.f.micCalls,0);
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
   const a=await recoveryApp({raw:recoveryRaw,media:recoveryMedia,...options});await a.init();
   assert.equal(a.run('persistence.restorePhase'),'failed');assert.deepEqual(a.value('state'),recoveryProject);
   assert.match(a.element('#saveStatus').innerHTML,/변경사항은 저장되지 않습니다/);
   assert.match(a.element('#saveStatus').innerHTML,/새로고침 전에.*내보내세요/);
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
   a.run('switchPanel("audio")');if(a.run('sources.audioFile'))a.element('#removeAudio').onclick();
   await a.run('loadVideo({name:"new.mp4",type:"video/mp4",size:1});loadAudio({name:"new.wav",size:1});toggleRecording();generateCaptions();play();startExport({mime:"video/webm",ext:"webm"},720)');
   a.run('confirmReset();exportDialog();persistMedia();scheduleSave()');await a.run('saveProject(true)');
   assert.deepEqual(a.value('state'),before);assert.deepEqual(a.f.media,files);
   assert.equal(a.f.micCalls,0);assert.equal(a.run('playing'),false);assert.equal(a.run('exporting'),false);
   assert.equal(a.f.jsonWrites,0);assert.equal(a.f.mediaWrites,0);assert.equal(a.f.raw,recoveryRaw);
   assert.match(a.element('#saveStatus').innerHTML,/변경사항은 저장되지 않습니다/);
   // Selecting the exact original names is still a normal destructive-load route,
   // not permission to exit failed recovery or overwrite browser storage.
   const protectedHistory=a.value('({history,future})');
   for(let retry=0;retry<2;retry++){
    await a.run('loadVideo({name:"saved.mp4",type:"video/mp4",size:1})');
    await a.run('loadAudio({name:"voice.wav",type:"audio/wav",size:1})');
    a.run('confirmReset();toggleRecording();scheduleSave();persistMedia()');
    await a.element('#saveButton').onclick();
    for(const timer of a.f.timers.filter(timer=>!timer.cancelled)){
     timer.cancelled=true;await timer.callback();
    }
    assert.equal(a.run('persistence.restorePhase'),'failed');
    assert.equal(a.run('persistence.recoveryValid'),true);
    assert.deepEqual(a.value('state'),before);
    assert.deepEqual(a.value('({history,future})'),protectedHistory);
    assert.deepEqual(a.f.media,files);assert.equal(a.f.raw,recoveryRaw);
    assert.equal(a.f.jsonWrites,0);assert.equal(a.f.mediaWrites,0);assert.equal(a.f.micCalls,0);
   }
   // Re-running the failed restore is a read-only retry, not a persistence bypass.
   await a.run('persistence.restore()');
   assert.equal(a.run('persistence.restorePhase'),'failed');
   assert.equal(a.run('persistence.recoveryValid'),true);
   assert.deepEqual(a.value('state'),recoveryProject);
   assert.deepEqual(a.f.media,files);assert.equal(a.f.raw,recoveryRaw);
   assert.equal(a.f.jsonWrites,0);assert.equal(a.f.mediaWrites,0);
  }
  for(const raw of ['', ' ', 'null', 'false', '42', '[]', '{}', '{broken', JSON.stringify({...recoveryProject,clips:[]}),JSON.stringify({...recoveryProject,design:null})]){
   const a=await recoveryApp({raw});await a.init();assert.equal(a.run('persistence.restorePhase'),'failed');
   assert.equal(a.run('persistence.recoveryValid'),false);assert.equal(a.f.reads,0);
   a.run('edit(()=>state.name="임시 화면");downloadProjectSettings();downloadSrt();persistMedia();scheduleSave()');await a.run('saveProject(true)');
   assert.equal(a.f.downloads.length,0);assert.equal(a.f.jsonWrites,0);assert.equal(a.f.mediaWrites,0);assert.equal(a.f.raw,raw);
   assert.equal((await a.app.window.moment.execute('project.get')).error.code,'RECOVERY_REQUIRED');
  }
  const readFailure=await recoveryApp({readError:new Error('storage blocked')});await readFailure.init();
  assert.equal(readFailure.run('persistence.restorePhase'),'failed');await readFailure.run('saveProject(true)');assert.equal(readFailure.f.jsonWrites,0);
  const emptyStart=await recoveryApp();await emptyStart.init();assert.equal(emptyStart.run('persistence.restorePhase'),'ready');assert.equal(emptyStart.f.reads,0);
  await emptyStart.run('saveProject()');assert.equal(emptyStart.f.jsonWrites,1);
  emptyStart.run('confirmReset()');emptyStart.element('#confirmReset').onclick();await emptyStart.run('saveProject()');assert.equal(emptyStart.f.mediaWrites,1);
  const retried=await recoveryApp({raw:recoveryRaw,media:recoveryMedia});await retried.init();
  assert.equal(retried.run('persistence.restorePhase'),'ready');assert.deepEqual(retried.value('state'),recoveryProject);
  await retried.run('saveProject(true)');assert.equal(retried.f.jsonWrites,1);assert.equal(retried.f.mediaWrites,1);
  const unknownAudioDuration=await recoveryApp({raw:recoveryRaw,media:recoveryMedia,audioDuration:Infinity});
  await unknownAudioDuration.init();assert.equal(unknownAudioDuration.run('persistence.restorePhase'),'ready','Loaded audio with unknown duration remains supported');
  const noAudioProject={...recoveryProject,audioName:''};
  const noAudio=await recoveryApp({raw:JSON.stringify(noAudioProject),media:{video:recoveryMedia.video}});await noAudio.init();assert.equal(noAudio.run('persistence.restorePhase'),'ready');
  
  let finishRead;const restoring=await recoveryApp({raw:recoveryRaw,media:recoveryMedia,readGate:new Promise(resolve=>finishRead=resolve)});
  const initializing=restoring.init();assert.equal(restoring.run('persistence.restorePhase'),'restoring');
  restoring.run('persistMedia();scheduleSave();confirmReset()');await restoring.run('saveProject(true)');
  assert.equal(restoring.f.jsonWrites,0);assert.equal(restoring.f.mediaWrites,0);
  assert.equal((await restoring.app.window.moment.execute('project.update',{patch:{name:'too early'}})).error.code,'BUSY');
  finishRead();await initializing;assert.equal(restoring.run('persistence.restorePhase'),'ready');
  assert.match(restoring.element('#saveStatus').innerHTML,/저장된 프로젝트를 불러왔습니다/);
  
  const stale=await recoveryApp();await stale.init();stale.run('scheduleSave();confirmReset()');
  const staleTimer=stale.f.timers.at(-1),oldReset=stale.element('#confirmReset').onclick;
  stale.run('switchPanel("audio");sources.audioFile={name:"voice.wav"};renderPanel()');const oldRemove=stale.element('#removeAudio').onclick;
  let finishSave;stale.app.fixturePending=new Promise(resolve=>finishSave=resolve);stale.run('persistence.pendingSave=fixturePending');
  const saving=stale.run('saveProject()');stale.f.raw='null';await stale.init();
  assert.equal(staleTimer.cancelled,true);finishSave();await saving;await staleTimer.callback();oldReset();oldRemove();
  assert.equal(stale.f.jsonWrites,0);assert.equal(stale.f.mediaWrites,0);assert.equal(stale.f.raw,'null');
  assert.match(stale.element('#saveStatus').innerHTML,/변경사항은 저장되지 않습니다/);
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
   const r=await recoveryApp({...options,raw:JSON.stringify({...projectModule.createDemoProject(),name:'preserved project'})});let api;
   r.app.mountTemplateGallery=(root,value)=>{api=value;mountTemplateGallery(root,value);};
   await r.init();assert.equal(r.value('editorReady'),true);assert.equal(r.value('persistence.restorePhase'),'ready');assert.equal(r.value('state.name'),'preserved project');
   assert.match(api.error,/원본 저장값은 유지/);assert.ok(r.element('#panelContent').innerHTML.includes('role="alert"'));
   const stored=structuredClone(r.f.library),before={custom:structuredClone(api.custom),favorites:structuredClone(api.favorites),project:r.value('({state,history,future})')};
   api.favorite('reference');api.remove('unknown');api.save();
   assert.deepEqual({custom:api.custom,favorites:api.favorites,project:r.value('({state,history,future})')},before);
   assert.deepEqual(r.f.library,stored);assert.equal(r.f.libraryWrites.length,0);assert.equal(r.f.jsonWrites,0);assert.equal(r.f.mediaWrites,0);
   assert.equal((await r.app.window.moment.execute('template.apply',{templateId:'clean'})).ok,true);
   assert.equal((await r.app.window.moment.execute('project.update',{patch:{name:'still editable'}})).ok,true);
   assert.equal(r.value('state.name'),'still editable');assert.deepEqual(r.f.library,stored);
  }
  for(const writeFailure of [false,true]){
   const r=await recoveryApp({templateRaw:JSON.stringify([validLibraryTemplate]),favoritesRaw:'["reference"]',libraryWriteError:writeFailure?new Error('synthetic quota'):null});let api;
   r.app.mountTemplateGallery=(root,value)=>{api=value;mountTemplateGallery(root,value);};
   await r.init();assert.equal(api.error,'');assert.equal(api.custom.length,1);
   api.thumbnail(r.app.document.createElement('canvas'),api.custom[0]); // synthetic canvas only
   api.favorite('clean');assert.equal(api.favorites.includes('clean'),!writeFailure);
   if(!writeFailure){assert.equal(JSON.parse(r.f.library['moment-favorites-v1']).includes('clean'),true);}
   else {assert.equal(r.f.libraryWrites.length,0);assert.deepEqual(api.favorites,['reference']);}
   api.save();r.element('#customTemplateName').value='Second fixture';r.element('#saveCustomTemplate').onclick();
   assert.equal(api.custom.length,writeFailure?1:2);
   api.remove(validLibraryTemplate.id);r.element('#confirmRemoveTemplate').onclick();
   assert.equal(api.custom.length,1);assert.equal(api.custom[0].id===validLibraryTemplate.id,writeFailure);
   if(writeFailure)assert.equal(r.f.libraryWrites.length,0);
   else assert.equal(JSON.parse(r.f.library['moment-templates-v1']).length,1);
  }
  console.log('PASS: malformed template/favorites data and read failures preserve raw storage, isolate library writes and keep startup/built-in editing usable; valid reload and write rollback pass.');
});
