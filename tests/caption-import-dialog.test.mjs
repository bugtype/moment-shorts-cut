import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {createProjectDocument,projectSubtitles,timelineDuration,outputDuration} from '../dist/core/project.mjs';
import {parseSubtitles,MAX_SUBTITLE_BYTES} from '../dist/captions.mjs';
import {initLocale,setLocale} from '../dist/i18n.mjs';
const srt='1\n00:00:00,000 --> 00:00:01,000\nImported';
async function fixture(){
 const f=await createAppFixture();vm.runInContext("switchPanel('captions');history=[];future=[];current=2;",f.context);
 f.open=()=>{f.element('#importSrt').onclick({});f.element('#subtitleImportFile').files=[];};
 f.file=file=>{f.element('#subtitleImportFile').files=[file];f.element('#subtitleImportFile').onchange();};
 f.clock=mode=>{f.element('#subtitleImportClock').value=mode;f.element('#subtitleImportClock').onchange();};
 f.confirm=()=>f.element('#confirmSubtitleImport').onclick({});
 return f;
}
function deferredFile(text=srt){let finish,reads=0;const bytes=new TextEncoder().encode(text).buffer;return {file:{name:'review.srt',size:bytes.byteLength,arrayBuffer(){reads++;return new Promise(resolve=>finish=()=>resolve(bytes));}},finish:()=>finish(),reads:()=>reads};}

test('import selection is unread until Replace; default source and legacy hidden import stay source-clock',async()=>{
 const f=await fixture(),d=deferredFile();f.open();assert.equal(f.element('#subtitleImportClock').value,'source');
 assert.match(f.element('#modal').innerHTML,/현재 자막 전체/);f.file(d.file);assert.equal(d.reads(),0);
 f.element('#cancelSubtitleImport').onclick();assert.equal(d.reads(),0);assert.equal(f.evaluate('history.length'),0);
 f.open();f.file(d.file);const pending=f.confirm();assert.equal(d.reads(),1);d.finish();await pending;
 assert.deepEqual(f.evaluate('state.captions'),[{start:0,end:1,text:'Imported'}]);assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),2);
 assert.equal(f.evaluate('!!modal.open'),false);assert.equal(f.doc.activeElement,f.element('[data-caption-text="0"]'));
 f.context.legacyFile=new Blob([srt.replace('Imported','Legacy')]);await vm.runInContext('importSrt(legacyFile)',f.context);assert.equal(f.evaluate('state.captions[0].basis===undefined'),true);
});

test('edited-output SRT/VTT roundtrip preserves temporal occurrences across repeated/reordered clips and speeds',async()=>{
 for(const speed of [.25,4])for(const format of ['srt','vtt']){
  const f=await fixture();vm.runInContext(`state.speed=${speed};state.clips=[{start:6,end:10},{start:2,end:6},{start:2,end:6}];state.captions=[{start:2.12345,end:3.98765,text:'Repeat'},{start:6,end:9.5,text:'First'}];current=1;renderPanel();`,f.context);
  const before=f.evaluate('state'),output=projectSubtitles(before,{format}),duration=outputDuration(before),expected=parseSubtitles(output,duration);
  f.open();f.file(new Blob([output]));f.clock('output');await f.confirm();
  const after=f.evaluate('state');assert.equal(after.captions.length,3);assert.ok(after.captions.every(c=>c.basis==='timeline'));
  for(let i=0;i<expected.length;i++){
   assert.equal(after.captions[i].start,expected[i].start*speed);
   assert.equal(after.captions[i].end,expected[i].end===duration?timelineDuration(before):expected[i].end*speed);
  }
  const reexport=parseSubtitles(projectSubtitles(after,{format}),duration);assert.equal(reexport.length,expected.length);
  for(let i=0;i<expected.length;i++){assert.equal(reexport[i].text,expected[i].text);assert.ok(Math.abs(reexport[i].start-expected[i].start)<=.001000001);assert.ok(Math.abs(reexport[i].end-expected[i].end)<=.001000001);}
  after.captions=before.captions;assert.deepEqual(after,before);assert.equal(f.evaluate('history.length'),1);assert.equal(f.evaluate('current'),1);
  vm.runInContext('undo()',f.context);assert.deepEqual(f.evaluate('state'),before);
 }
});

test('only parser-clamped output endpoint maps to exact captured timeline end',async()=>{
 const f=await fixture();vm.runInContext('state.clips=[{start:0,end:4/37}];state.speed=.79;renderPanel();',f.context);
 f.open();f.clock('output');f.file(new Blob(['1\n00:00:00,000 --> 00:00:00,137\nBoundary']));await f.confirm();
 assert.equal(f.evaluate('state.captions[0].end'),4/37);assert.equal(f.evaluate('state.captions[0].basis'),'timeline');assert.equal(f.evaluate('history.length'),1);
});

test('cancel, file/mode changes, close/reopen and modal replacement silence stale pending attempts',async()=>{
 for(const cancel of ['cancel','mode','file','replace','close']){
  const f=await fixture(),d=deferredFile();f.open();f.file(d.file);const pending=f.confirm();
  if(cancel==='cancel')f.element('#cancelSubtitleImport').onclick();
  if(cancel==='mode')f.clock('output');
  if(cancel==='file')f.file(new Blob([srt.replace('Imported','New file')]));
  if(cancel==='replace')vm.runInContext("modalOpen('other','other dialog');",f.context);
  if(cancel==='close'){f.element('#modal').close();f.element('#modal').onclose();}
  const focus=f.doc.activeElement,toast=f.element('#toast').textContent;f.element('#srtInput').value='new hidden selection';d.finish();await pending;
  assert.equal(f.evaluate('history.length'),0,cancel);assert.equal(f.doc.activeElement,focus);assert.equal(f.element('#toast').textContent,toast);assert.equal(f.element('#srtInput').value,'new hidden selection');
  if(cancel==='mode'||cancel==='file'){assert.equal(f.element('#confirmSubtitleImport').disabled,false);if(cancel==='mode')f.file(new Blob([srt]));await f.confirm();assert.equal(f.evaluate('history.length'),1);}
 }
 const f=await fixture(),d=deferredFile();f.open();f.file(d.file);const old=f.confirm();f.element('#cancelSubtitleImport').onclick();f.open();f.file(new Blob([srt.replace('Imported','New dialog')]));d.finish();await old;await f.confirm();assert.equal(f.evaluate('state.captions[0].text'),'New dialog');
});

test('project/speed/media/selection and newer settings import prevent stale commits',async()=>{
 for(const mutation of ['state.speed=2','state=structuredClone(state)',"state.name='changed'",'sources.videoFile={}', 'sources.audioFile={}', 'selected=1',"switchPanel('media')",'loadingMedia=true']){
  const f=await fixture(),d=deferredFile();f.open();f.file(d.file);const pending=f.confirm();vm.runInContext(mutation,f.context);const before=f.evaluate('state'),toast=f.element('#toast').textContent,focus=f.doc.activeElement;d.finish();await pending;assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0,mutation);assert.equal(f.element('#toast').textContent,toast,mutation);assert.equal(f.doc.activeElement,focus,mutation);
 }
 const f=await fixture(),d=deferredFile();f.open();f.file(d.file);const pending=f.confirm();const document=createProjectDocument(f.evaluate('state'));document.project.name='New settings';f.context.settingsFile=new Blob([JSON.stringify(document)]);
 await vm.runInContext('importProjectSettings(settingsFile)',f.context);const before=f.evaluate('state'),toast=f.element('#toast').textContent,focus=f.doc.activeElement;d.finish();await pending;
 assert.deepEqual(f.evaluate('state'),before);assert.equal(f.element('#toast').textContent,toast);assert.equal(f.doc.activeElement,focus);assert.equal(f.evaluate('history.length'),1);
});

test('invalid files/limits/UTF8 are atomic; busy and IME do not read; duplicate pending confirmation reads once',async()=>{
 const many=Array.from({length:10001},(_,i)=>`${i+1}\n00:00:00,000 --> 00:00:01,000\nx`).join('\n\n');
 for(const file of [new Blob(['invalid']),new Blob([srt.replace('Imported','x'.repeat(2001))]),new Blob([many]),new Blob([new Uint8Array([255])]),{size:MAX_SUBTITLE_BYTES+1,arrayBuffer(){throw Error('must not read');}},{size:0,arrayBuffer:async()=>new ArrayBuffer(MAX_SUBTITLE_BYTES+1)}]){
  const f=await fixture(),before=f.evaluate('state');f.open();f.file(file);await f.confirm();assert.deepEqual(f.evaluate('state'),before);assert.equal(f.evaluate('history.length'),0);assert.equal(f.evaluate('!!modal.open'),true);assert.equal(f.element('#confirmSubtitleImport').disabled,false);
 }
 const f=await fixture(),d=deferredFile();f.open();await f.confirm();assert.equal(f.evaluate('history.length'),0);f.file(d.file);
 for(const event of [{isComposing:true},{keyCode:229}])await f.element('#confirmSubtitleImport').onclick(event);
 vm.runInContext('loadingMedia=true',f.context);await f.confirm();vm.runInContext('loadingMedia=false',f.context);assert.equal(d.reads(),0);
 const pending=f.confirm();await f.confirm();assert.equal(d.reads(),1);d.finish();await pending;assert.equal(f.evaluate('history.length'),1);
});

test('failed-valid imports and undo remain memory-only; localized clock choice preserves file and mode drafts',async()=>{
 try{for(const [locale,label] of [['ko','편집된 출력'],['en','Edited output'],['zh-CN','编辑后输出']]){
  const f=await fixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);setLocale(locale,{persist:false});vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true;",f.context);
  f.open();assert.ok(f.element('#modal').innerHTML.includes(label));f.file(new Blob([srt]));f.clock('output');const node=f.element('#subtitleImportFile'),file=node.files[0],handler=f.element('#confirmSubtitleImport').onclick;setLocale(locale==='ko'?'en':'ko',{persist:false});
  assert.equal(f.element('#subtitleImportFile'),node);assert.equal(node.files[0],file);assert.equal(f.element('#subtitleImportClock').value,'output');assert.equal(f.element('#confirmSubtitleImport').onclick,handler);
  await f.confirm();assert.equal(f.evaluate('history.length'),1);await vm.runInContext('saveProject(true);scheduleSave();undo();',f.context);assert.deepEqual(writes,[]);
 }}finally{initLocale();}
});


test('stale read rejections are silent and busy refusal can retry after the operation ends',async()=>{
 for(const mutation of ["state.name='new project'", "sources.videoFile={}", "switchPanel('media')", 'loadingMedia=true', 'exporting=true', 'transcribing=true']){
  const f=await fixture();let reject;f.open();f.file({size:10,arrayBuffer:()=>new Promise((_,no)=>reject=no)});const pending=f.confirm();
  vm.runInContext(mutation,f.context);const toast=f.element('#toast').textContent,focus=f.doc.activeElement;reject(new Error('read failed'));await pending;
  assert.equal(f.evaluate('history.length'),0);assert.equal(f.element('#toast').textContent,toast);assert.equal(f.doc.activeElement,focus);
  if(mutation==='loadingMedia=true'){vm.runInContext('loadingMedia=false',f.context);f.file(new Blob([srt]));await f.confirm();assert.equal(f.evaluate('history.length'),1);}
 }
});

test('new dialog import supersedes older legacy subtitle read without clearing newer hidden selection',async()=>{
 const f=await fixture(),d=deferredFile('1\n00:00:00,000 --> 00:00:01,000\nOld');f.context.oldFile=d.file;
 const old=vm.runInContext('importSrt(oldFile)',f.context);f.open();f.file(new Blob([srt]));await f.confirm();
 const toast=f.element('#toast').textContent,focus=f.doc.activeElement;f.element('#srtInput').value='new hidden file';d.finish();await old;
 assert.equal(f.evaluate('state.captions[0].text'),'Imported');assert.equal(f.evaluate('history.length'),1);assert.equal(f.element('#srtInput').value,'new hidden file');assert.equal(f.element('#toast').textContent,toast);assert.equal(f.doc.activeElement,focus);
});


test('file chooser and clock select keep native Enter activation instead of submitting',async()=>{
 const f=await fixture(),d=deferredFile();f.open();f.file(d.file);let prevented=0;
 for(const id of ['subtitleImportFile','subtitleImportClock']){
  const node=f.element('#'+id);assert.equal(typeof node.onkeydown,'undefined');
  node.onkeydown?.({key:'Enter',preventDefault(){prevented++;}});
 }
 assert.equal(prevented,0);assert.equal(d.reads(),0);assert.equal(f.evaluate('history.length'),0);
 const pending=f.confirm();d.finish();await pending;assert.equal(f.evaluate('history.length'),1);
});
