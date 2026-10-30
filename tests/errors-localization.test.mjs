import {createCaptionFlow} from '../dist/caption-flow.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {message,translateFor,getLocale,setLocale,localize} from '../dist/i18n.mjs';
import {messages} from '../dist/i18n/catalogs/errors.mjs';
import {CommandError,LocalizedError} from '../dist/core/validation.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {createEditorService,errorResult} from '../dist/integration/editor-service.mjs';
import {parseSubtitles} from '../dist/captions.mjs';
import {createTranscriptionClient} from '../dist/transcription-client.mjs';
const translated=(locale,error)=>error.messageKey?translateFor(locale,error.messageKey,error.messageParams):error.message;
test('internal error metadata localizes while default serialized API shape and Korean diagnostics stay stable',async()=>{
 const descriptor=message('errors.numberRange'),error=new CommandError('INVALID_ARGUMENT',descriptor,'arguments.patch.speed');
 assert.equal(error.message,'숫자 범위를 확인하세요.');
 assert.equal(translated('en',error),'Check the numeric range.');
 assert.equal(translated('zh-CN',error),'请检查数值范围。');
 const baseline=errorResult('project.update',error);
 assert.deepEqual(Object.keys(baseline.error).sort(),['code','message','path']);
 assert.equal(baseline.error.message,error.message);
 assert.equal(errorResult('project.update',error,e=>translated('en',e)).error.message,'Check the numeric range.');
 assert.equal(errorResult('x',error,()=>{throw new Error('formatter failure');}).error.message,error.message);
 const project=createDemoProject(),before=structuredClone(project);let commits=0;
 for(const locale of ['en','zh-CN']){
  const service=createEditorService({getProject:()=>project,commitProject:()=>commits++,formatErrorMessage:e=>translated(locale,e)});
  const result=await service.execute('project.update',{patch:{speed:0}});
  assert.equal(result.ok,false);assert.equal(result.error.message,messages[locale]['errors.numberRange']);
  assert.deepEqual(Object.keys(result.error).sort(),['code','message','path']);
 }
 assert.equal(commits,0);assert.deepEqual(project,before);
});
test('parser, split and batch wrappers retain message metadata without changing error code or indexed path',()=>{
 assert.throws(()=>parseSubtitles('not subtitles',12),e=>e instanceof LocalizedError&&e.messageKey==='errors.noSubtitles');
 const p=createDemoProject();
 assert.throws(()=>prepareCommand(p,'captions.import',{text:'not subtitles',basis:'source'}),e=>e.code==='INVALID_ARGUMENT'&&e.messageKey==='errors.noSubtitles'&&e.path==='arguments.text');
 assert.throws(()=>prepareCommand(p,'project.batch',{operations:[{command:'project.update',arguments:{patch:{speed:0}}}]}),e=>e.code==='INVALID_ARGUMENT'&&e.messageKey==='errors.numberRange'&&e.path==='arguments.operations[0].arguments.patch.speed');
 assert.throws(()=>prepareCommand(p,'captions.split',{captionIndex:0,textOffset:0}),e=>e.messageKey==='errors.splitCaret');
});
test('nested recovery causes and hostile external detail remain plain text',()=>{
 const cause=message('errors.storedVideoOpen'),notice=message('errors.restoreWithBackup',{cause});
 const english=translateFor('en',notice.messageKey,notice.messageParams);
 assert.match(english,/stored video could not be opened/);assert.match(english,/Changes will not be saved/);assert.doesNotMatch(english,/\[object Object\]/);
 const detail='<img src=x onerror=alert(1)> & "file"';
 assert.equal(translateFor('en','errors.modelDownload',{progress:5,file:detail}),'Downloading speech model · 5% ('+detail+')');
});
test('worker message metadata reaches the UI without changing recognition language or legacy messages',async()=>{
 let worker;const client=createTranscriptionClient(()=>worker={postMessage(value){this.sent=value;},terminate(){}});
 const statuses=[],pcm=new Float32Array(2),pending=client.transcribe(pcm,'korean',value=>statuses.push(value));
 worker.onmessage({data:{type:'progress',...message('errors.modelDownload',{progress:25,file:'model.bin'})}});
 assert.equal(statuses[0].messageKey,'errors.modelDownload');assert.equal(statuses[0].messageParams.progress,25);
 assert.equal(worker.sent.language,'korean');
 worker.onmessage({data:{type:'progress',message:'external detail'}});
 assert.equal(statuses[1],'external detail');
 worker.onmessage({data:{type:'error',...message('errors.recognitionFailed')}});
 await assert.rejects(pending,e=>e.messageKey==='errors.recognitionFailed'&&translated('en',e).startsWith('Automatic captions failed.'));
});

test('raw provider progress replaces localized status without retaining stale translation markers',async()=>{
 const attributes=new Map(),previous=getLocale();
 const statusNode={tagName:'DIV',children:[],textContent:'',hidden:true,
  setAttribute:(key,value)=>attributes.set(key,value),
  getAttribute:key=>attributes.get(key)??null,
  removeAttribute:key=>attributes.delete(key),
  matches:()=>attributes.has('data-i18n'),querySelectorAll:()=>[]};
 const raw='Provider detail: <audio> & waiting';
 const app={recoveryBlocked:()=>false,audioRecording:{},sources:{videoFile:{}},
  state:{duration:12},panel:'other',toast:()=>assert.fail('unexpected error'),
  query:selector=>selector==='#asrStatus'?statusNode:{value:selector==='#captionSource'?'video':'korean'},
  captionGeneration:{async generate(source,file,language,{status}){
   status(message('errors.recognizing'));
   assert.equal(attributes.get('data-i18n'),'errors.recognizing');
   status(raw);assert.equal(app.transcriptionStatus,raw);
   assert.equal(statusNode.textContent,raw);
   assert.equal(attributes.has('data-i18n'),false);
   assert.equal(attributes.has('data-i18n-params'),false);
   setLocale('en',{persist:false});localize(statusNode);
   assert.equal(statusNode.textContent,raw);
   setLocale('zh-CN',{persist:false});localize(statusNode);
   assert.equal(statusNode.textContent,raw);
  }}};
 try{await createCaptionFlow(app).generateCaptions();}
 finally{setLocale(previous,{persist:false});}
});
