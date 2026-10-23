import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as projectModule from '../dist/core/project.mjs';
import * as captionModule from '../dist/captions.mjs';
import { createAppFixture } from './fixtures/app.mjs';

test('browser command API, imports and subtitle output guards', async () => {
  const { context, evaluate, element } = await createAppFixture();
  let downloads = 0;
  context.countDownload = () => downloads++;
  vm.runInContext('download=countDownload;',context);
  // The installed browser API uses the real commit path, including undo and busy guards.
  await context.window.moment.ready;
  vm.runInContext('state=initial();timelineCache=null;history=[];future=[];exporting=false;current=0;selected=0;',context);
  const apiOriginal=evaluate('state');
  assert.equal((await context.window.moment.execute('template.apply',{templateId:'quiz',withContent:true})).ok,true);
  assert.equal(evaluate('state.templateId'),'quiz');assert.equal(evaluate('history.length'),1);
  vm.runInContext('undo();',context);assert.deepEqual(evaluate('state'),apiOriginal);
  vm.runInContext('exporting=true;',context);
  assert.equal((await context.window.moment.execute('project.update',{patch:{name:'blocked'}})).error.code,'BUSY');
  assert.deepEqual(evaluate('state'),apiOriginal);vm.runInContext('exporting=false;',context);
  const imported=projectModule.createProjectDocument(apiOriginal);imported.project.kind='video';imported.project.fileName='different.mp4';
  assert.equal((await context.window.moment.execute('project.import',{document:imported})).error.code,'MEDIA_RELINK_REQUIRED');
  assert.deepEqual(evaluate('state'),apiOriginal);
  console.log('PASS: browser command API initialization, shared template editing, undo, export-busy guard and media relink checks.');
  
  // A synchronous command must not overwrite a direct input in its former await gap.
  const concurrencySetItem=context.localStorage.setItem;
  for(const timing of ['before-snapshot','former-await-gap','after-commit']){
   vm.runInContext('state=initial();state.clips=[{start:0,end:6},{start:6,end:12}];timelineCache=null;history=[];future=[];inputHistory.reset();selected=1;current=8;renderInspector()',context);
   const pending=context.window.moment.execute('project.update',{patch:{name:'atomic command'}});
   if(timing==='former-await-gap')await Promise.resolve();
   if(timing==='after-commit')await pending;
   const control=element('#zoom');control.value='1.5';control.oninput();
   assert.equal((await pending).ok,true);
   assert.equal(evaluate('state.zoom'),1.5,timing);assert.equal(evaluate('state.name'),'atomic command');
   assert.equal(evaluate('selected'),1);assert.equal(evaluate('current'),8);
   const finalState=evaluate('state');let saved;
   context.localStorage.setItem=(key,value)=>{if(key==='moment-state-v1')saved=JSON.parse(value);};
   await vm.runInContext('saveProject()',context);assert.deepEqual(saved,finalState);
   assert.equal(evaluate('history.length'),2);
   vm.runInContext('undo()',context);
   assert.equal(evaluate('state.zoom'),timing==='before-snapshot'?1.5:1);
   assert.equal(evaluate('state.name'),timing==='before-snapshot'?projectModule.createDemoProject().name:'atomic command');
   vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),finalState);
   const groups=evaluate('history.length');control.value='1.6';control.oninput();control.value='1.7';control.oninput();
   assert.equal(evaluate('history.length'),groups+1);assert.equal(evaluate('state.zoom'),1.7);
   control.onblur();control.value='1.8';control.oninput();assert.equal(evaluate('history.length'),groups+2);
  }
  context.localStorage.setItem=concurrencySetItem;
  vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();timelineCache=null;selected=0;current=0;',context);
  const pendingTimeline=context.window.moment.execute('timeline.replace',{clips:[{start:0,end:6}]});
  await Promise.resolve();vm.runInContext('edit(()=>state.captions[0].text="direct caption edit")',context);
  assert.equal((await pendingTimeline).ok,true);
  assert.deepEqual(evaluate('state.clips'),[{start:0,end:6}]);assert.equal(evaluate('state.captions[0].text'),'direct caption edit');
  const pendingName=context.window.moment.execute('project.update',{patch:{name:'undo this command'}});
  await Promise.resolve();vm.runInContext('undo()',context);assert.equal((await pendingName).ok,true);
  assert.notEqual(evaluate('state.name'),'undo this command');assert.equal(evaluate('state.captions[0].text'),'direct caption edit');
  console.log('PASS: command/direct-input ordering preserves model, saves, selection, undo/redo and continuous input grouping without replay.');
  
  // Subtitle import failures must preserve the project and reset the file picker.
  vm.runInContext('state=initial();timelineCache=null;',context);
  const subtitleOriginal=evaluate('state');
  let readOversized=false;
  context.largeSubtitle={size:captionModule.MAX_SUBTITLE_BYTES+1,arrayBuffer:async()=>{readOversized=true;return '';}};
  await vm.runInContext('importSrt(largeSubtitle)',context);
  assert.equal(readOversized,false,'oversized subtitles are rejected before reading');
  assert.deepEqual(evaluate('state'),subtitleOriginal);
  context.failedSubtitle={arrayBuffer:async()=>{throw new Error('read failed');}};
  await vm.runInContext('importSrt(failedSubtitle)',context);
  assert.deepEqual(evaluate('state'),subtitleOriginal);
  vm.runInContext('exporting=true;',context);
  await vm.runInContext('importSrt(new Blob(["00:01.000 --> 00:02.000\\nMust not replace during export"]))',context);
  assert.deepEqual(evaluate('state'),subtitleOriginal);
  vm.runInContext('exporting=false;',context);
  await vm.runInContext('importSrt(new Blob(["00:01.000 --> 00:02.000\\n&lt;b&gt;한글 🌊&lt;/b&gt; &amp; &amp;lt;"]))',context);
  assert.equal(evaluate('state.captions[0].text'),'<b>한글 🌊</b> & &lt;');
  const escapedExport=await context.window.moment.execute('captions.export');
  assert.equal(escapedExport.ok,true);
  assert.ok(escapedExport.data.text.includes('&lt;b&gt;한글 🌊&lt;/b&gt; &amp; &amp;lt;'));
  assert.deepEqual(captionModule.parseSubtitles(escapedExport.data.text,12),evaluate('state.captions'));
  vm.runInContext('undo();',context);
  assert.deepEqual(evaluate('state'),subtitleOriginal);
  assert.equal(element('#srtInput').value,'');
  console.log('PASS: bounded subtitle imports, escaped text export/reimport, read failure recovery, export guard and undo.');
  
  // Actual app import handlers, with byte fixtures and native decoding in the VM.
  vm.runInContext('globalThis.utf8ScheduleSave=scheduleSave;globalThis.utf8Saves=0;scheduleSave=()=>utf8Saves++;state=initial();timelineCache=null;history=[JSON.stringify(state)];future=[JSON.stringify(state)];current=2;selected=0;',context);
  const utf8Before=evaluate('[state,history,future,current,selected]');
  const utf8Document=projectModule.createProjectDocument(evaluate('state'));utf8Document.project.name='MARKER';
  const utf8Imports=[
   {handler:'importProjectSettings',picker:'#projectInput',limit:10*1024*1024,text:JSON.stringify(utf8Document)},
   {handler:'importSrt',picker:'#srtInput',limit:captionModule.MAX_SUBTITLE_BYTES,text:'1\n00:00:00,000 --> 00:00:02,000\nMARKER'},
  ];
  for(const entry of utf8Imports){
   const unchanged=()=>{assert.deepEqual(evaluate('[state,history,future,current,selected]'),utf8Before);assert.equal(context.utf8Saves,0);assert.equal(element(entry.picker).value,'');};
   for(const bytes of [[0xff],[0x80],[0xc0,0xaf],[0xe2,0x82],[0xed,0xa0,0x80],[0xf4,0x90,0x80,0x80]]){
    for(const bom of ['', '\ufeff']){
     const index=entry.text.indexOf('MARKER');
     context.utf8File=new Blob([bom+entry.text.slice(0,index),new Uint8Array(bytes),entry.text.slice(index+6)]);
     element(entry.picker).value='synthetic input';
     await vm.runInContext(`${entry.handler}(utf8File)`,context);
     assert.match(element('#toast').textContent,/UTF-8/);unchanged();
    }
   }
   for(const text of entry.handler==='importProjectSettings'?['\ufeff\ufeff'+entry.text,'\ufeff{"project":}']:['1\ninvalid timing\ncaption']){
    context.utf8File=new Blob([text]);await vm.runInContext(`${entry.handler}(utf8File)`,context);unchanged();
   }
   let reads=0;
   context.utf8File={size:entry.limit+1,arrayBuffer:async()=>{reads++;throw new Error('must not read');}};
   await vm.runInContext(`${entry.handler}(utf8File)`,context);assert.equal(reads,0);unchanged();
   context.utf8File={size:1,arrayBuffer:async()=>{throw new Error('synthetic read failure');}};
   await vm.runInContext(`${entry.handler}(utf8File)`,context);assert.match(element('#toast').textContent,/synthetic read failure/);unchanged();
   if(entry.handler==='importSrt'){
    // Underreported size models a direct caller; ordinary File imports already check real bytes.
    const oversized=('00:00:00,000 --> 00:00:01,000\n'+'가'.repeat(1000)+'\n\n').repeat(1000);
    context.utf8File={size:1,arrayBuffer:()=>new Blob([oversized]).arrayBuffer()};
    await vm.runInContext('importSrt(utf8File)',context);assert.match(element('#toast').textContent,/2 MB/);unchanged();
   }
   const authored='한글 🌊 e\u0301 앞\ufeff뒤 �';
   const text=entry.text.replace('MARKER',authored),validBytes=Buffer.from('\ufeff'+text);
   let finish;
   context.utf8File={size:validBytes.length,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})};
   const pending=vm.runInContext(`${entry.handler}(utf8File)`,context);
   vm.runInContext('exporting=true',context);finish(await new Blob([validBytes]).arrayBuffer());
   await pending;unchanged();vm.runInContext('exporting=false',context);
   // A failed protected restore must remain protected after decoding valid bytes.
   context.utf8File=new Blob([validBytes]);
   vm.runInContext('restorePhase="failed";recoveryValid=false;',context);
   await vm.runInContext(`${entry.handler}(utf8File)`,context);unchanged();
   vm.runInContext('restorePhase="ready";',context);
   // Exact limits include the BOM; trailing JSON/subtitle whitespace is valid.
   const atLimit=Buffer.alloc(entry.limit,0x20);validBytes.copy(atLimit);
   context.utf8File=new Blob([atLimit]);
   await vm.runInContext(`${entry.handler}(utf8File)`,context);
   assert.equal(evaluate(entry.handler==='importSrt'?'state.captions[0].text':'state.name'),authored);
   assert.equal(evaluate('history.length'),utf8Before[1].length+1);assert.equal(evaluate('future.length'),0);assert.equal(context.utf8Saves,1);
   const accepted=evaluate('state');
   assert.deepEqual(projectModule.readProjectDocument(JSON.parse(JSON.stringify(projectModule.createProjectDocument(accepted)))),accepted);
   vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),utf8Before[0]);
   vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),accepted);
   context.utf8Original=utf8Before;
   vm.runInContext('[state,history,future,current,selected]=structuredClone(utf8Original);timelineCache=null;utf8Saves=0;',context);
  }
  const subtitleDelayedBytes=Buffer.from('00:00.000 --> 00:01.000\nlate captions');let finishSubtitleRead;
  context.utf8File={size:subtitleDelayedBytes.length,arrayBuffer:()=>new Promise(resolve=>{finishSubtitleRead=resolve;})};
  const pendingSubtitleImport=vm.runInContext('importSrt(utf8File)',context);
  vm.runInContext('state={...state,name:"replacement project"}',context);
  const replacedDuringRead=evaluate('[state,history,future]');finishSubtitleRead(await new Blob([subtitleDelayedBytes]).arrayBuffer());await pendingSubtitleImport;
  assert.deepEqual(evaluate('[state,history,future]'),replacedDuringRead);assert.equal(context.utf8Saves,0);
  assert.match(element('#toast').textContent,/프로젝트가 변경/);
  vm.runInContext('state=initial();timelineCache=null;history=[];future=[];current=0;scheduleSave=utf8ScheduleSave;',context);
  console.log('PASS: app JSON/SRT byte imports reject malformed UTF-8 without state/history/redo/save loss; Unicode/BOM, exact size limits, read failures, busy/recovery guards, delayed subtitles and undo/redo pass in the VM.');
  
  // Deferred synthetic reads exercise imports without a browser file picker.
  vm.runInContext('globalThis.importSave=scheduleSave;globalThis.importSaves=0;scheduleSave=()=>importSaves++;',context);
  function resetImportFixture(){vm.runInContext('state=initial();timelineCache=null;history=[];future=[JSON.stringify(state)];current=0;selected=0;importSaves=0;inputHistory.reset();',context);}
  function delayedImport(kind,marker='imported'){
   const document=projectModule.createProjectDocument(evaluate('state'));document.project.name=marker;document.project.zoom=1;
   const text=kind==='json'?JSON.stringify(document):`00:00.000 --> 00:01.000\n${marker}`;
   let finish;context.importFile={size:Buffer.byteLength(text),arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})};
   const pending=vm.runInContext(kind==='json'?'importProjectSettings(importFile)':'importSrt(importFile)',context);
   return {pending,finish(){finish(new Uint8Array(Buffer.from(text)).buffer);}};
  }
  const importSnapshot=()=>evaluate('[state,history,future,current,selected,importSaves]');
  for(const kind of ['json','srt']){
   for(const mutation of [
    'edit(()=>state.zoom=1.5)',
    'edit(()=>state.captions[0].text="manual correction")',
    'state={...initial(),name:"replacement"};changed()',
    'state=initial();timelineCache=null;changed()',
    'edit(()=>state.zoom=1.5);undo()',
    'edit(()=>state.zoom=1.5);undo();undo(true)',
   ]){
    resetImportFixture();const read=delayedImport(kind);vm.runInContext(mutation,context);
    const before=importSnapshot();read.finish();await read.pending;
    assert.deepEqual(importSnapshot(),before,`${kind}: stale import preserves model/history/redo/saves`);
    assert.match(element('#toast').textContent,/프로젝트가 변경/);
   }
   resetImportFixture();const continuous=delayedImport(kind);
   element('#zoom').onfocus?.();element('#zoom').value='1.5';element('#zoom').oninput();
   const before=importSnapshot();continuous.finish();await continuous.pending;assert.deepEqual(importSnapshot(),before);
   element('#zoom').value='1.6';element('#zoom').oninput();
   assert.equal(evaluate('history.length'),1,'rejection must not reset continuous input grouping');
   vm.runInContext('undo()',context);assert.equal(evaluate('state.zoom'),1);
   // Read-only view changes do not invalidate an intentional import.
   resetImportFixture();const allowed=delayedImport(kind);vm.runInContext('current=2;selected=0;panel="captions"',context);
   allowed.finish();await allowed.pending;
   assert.equal(evaluate(kind==='json'?'state.name':'state.captions[0].text'),'imported');
   assert.equal(evaluate('history.length'),1);assert.equal(evaluate('future.length'),0);assert.equal(context.importSaves,1);
   const accepted=evaluate('state');vm.runInContext('undo();undo(true)',context);assert.deepEqual(evaluate('state'),accepted);
  }
  // Newest selection wins, including cross-format imports and failed newer reads.
  for(const first of ['json','srt'])for(const second of ['json','srt'])for(const reverse of [false,true]){
   resetImportFixture();const old=delayedImport(first,'older'),latest=delayedImport(second,'newest');
   if(reverse){latest.finish();await latest.pending;const before=importSnapshot();old.finish();await old.pending;assert.deepEqual(importSnapshot(),before);}
   else{const before=importSnapshot();old.finish();await old.pending;assert.deepEqual(importSnapshot(),before);latest.finish();await latest.pending;}
   assert.equal(evaluate(second==='json'?'state.name':'state.captions[0].text'),'newest');
   assert.equal(evaluate('history.length'),1);assert.equal(context.importSaves,1);
  }
  for(const kind of ['json','srt']){
   resetImportFixture();const old=delayedImport(kind);context.importFile=new Blob(['invalid']);
   await vm.runInContext(kind==='json'?'importProjectSettings(importFile)':'importSrt(importFile)',context);
   const before=importSnapshot();old.finish();await old.pending;assert.deepEqual(importSnapshot(),before);
   const retry=delayedImport(kind,'retried');retry.finish();await retry.pending;
   assert.equal(evaluate(kind==='json'?'state.name':'state.captions[0].text'),'retried');
  }
  // Enqueue a mutation during parsing, after any read-time check but before apply.
  resetImportFixture();
  vm.runInContext('globalThis.importParser=parseSubtitles;parseSubtitles=(...args)=>{window.moment.execute("project.update",{patch:{zoom:1.5}});return importParser(...args);};',context);
  const queuedImport=delayedImport('srt');queuedImport.finish();await queuedImport.pending;
  assert.equal(evaluate('state.zoom'),1.5);assert.notEqual(evaluate('state.captions[0].text'),'imported');
  assert.equal(evaluate('history.length'),1);assert.equal(context.importSaves,1);assert.match(element('#toast').textContent,/프로젝트가 변경/);
  vm.runInContext('parseSubtitles=importParser;',context);
  // Existing queued commands retain order; stale imports cannot jump the queue.
  resetImportFixture();const queuedJson=delayedImport('json');
  const commands=[context.window.moment.execute('project.update',{patch:{zoom:1.5}}),context.window.moment.execute('title.update',{patch:{lines:['queued title','second line']}})];
  queuedJson.finish();assert.ok((await Promise.all(commands)).every(result=>result.ok));await queuedJson.pending;
  assert.equal(evaluate('state.zoom'),1.5);assert.deepEqual(evaluate('state.design.title.lines'),['queued title','second line']);
  assert.equal(evaluate('history.length'),2);assert.equal(context.importSaves,2);
  vm.runInContext('state=initial();timelineCache=null;history=[];future=[];current=0;scheduleSave=importSave;',context);
  console.log('PASS: stale JSON/SRT imports preserve committed edits, redo and continuous history; latest-selection ordering, failed reads/retry, queued mutations, view-only navigation and undo/redo pass in the VM.');
  
  // Invalid SRT text stays editable and must never produce a partial download.
  context.blankLineCaption='first\n\nsecond';
  vm.runInContext('edit(()=>state.captions[0].text=blankLineCaption);',context);
  const beforeRejectedSrt=evaluate('[state,history,future]'),beforeSrtDownloads=downloads;
  assert.doesNotThrow(()=>vm.runInContext('downloadSrt();',context));
  assert.equal(downloads,beforeSrtDownloads);
  assert.match(element('#toast').textContent,/1번째 자막.*빈 줄/);
  assert.deepEqual(evaluate('[state,history,future]'),beforeRejectedSrt);
  context.correctedCaption='first\nsecond';
  vm.runInContext('edit(()=>state.captions[0].text=correctedCaption);downloadSrt();',context);
  assert.equal(downloads,beforeSrtDownloads+1,'corrected text can be downloaded');
  vm.runInContext('undo();downloadSrt();',context);
  assert.equal(evaluate('state.captions[0].text'),context.blankLineCaption);
  assert.equal(downloads,beforeSrtDownloads+1,'undo preserves the original text and export validation');
  console.log('PASS: SRT blank-line validation displays an error without download/history changes; correction and undo recover.');
  
  vm.runInContext('state=initial();state.clips=[{start:0,end:2}];state.speed=4;state.captions=[{start:1.999,end:4,text:"trimmed speech"}];timelineCache=null;',context);
  const beforePrecisionExport=evaluate('[state,history,future]'),beforePrecisionDownloads=downloads;
  assert.doesNotThrow(()=>vm.runInContext('downloadSrt();',context));
  assert.equal(downloads,beforePrecisionDownloads);
  assert.match(element('#toast').textContent,/1번째 자막.*밀리초/);
  assert.deepEqual(evaluate('[state,history,future]'),beforePrecisionExport);
  await context.window.moment.execute('project.update',{patch:{speed:1}});
  vm.runInContext('downloadSrt();',context);
  assert.equal(downloads,beforePrecisionDownloads+1);
  vm.runInContext('undo();downloadSrt();',context);
  assert.equal(evaluate('state.speed'),4);assert.equal(downloads,beforePrecisionDownloads+1);
  console.log('PASS: SRT precision failure preserves state/history and prevents download; speed correction and undo recover.');
  
  // Output failure is local to the caption lane/action, never a project validity failure.
  vm.runInContext('state=initial();state.captions=Array.from({length:101},()=>({start:0,end:1,text:"caption"}));state.clips=Array.from({length:100},()=>({start:0,end:1}));timelineCache=null;history=[];future=[];current=0;renderTimeline();',context);
  assert.equal(element('#captionTrack').children.length,1);
  assert.equal(element('#captionTrack').children[0].attributes.role,'status');
  assert.ok(element('#captionTrack').children.every(node=>!node.dataset.captionIndex));
  const overflowBefore=evaluate('[state,history,future]'),overflowDownloads=downloads;
  vm.runInContext('downloadSrt();',context);
  assert.equal(downloads,overflowDownloads);assert.match(element('#toast').textContent,/10,000/);
  assert.deepEqual(evaluate('[state,history,future]'),overflowBefore);
  assert.equal((await context.window.moment.execute('project.get')).ok,true);
  assert.equal((await context.window.moment.execute('render.plan',{quality:720,format:'webm'})).ok,true);
  assert.equal((await context.window.moment.execute('project.update',{patch:{name:'still editable'}})).ok,true);
  vm.runInContext('downloadProjectSettings();play();pause();',context);
  assert.equal(downloads,overflowDownloads+1);
  let overflowWrites=0;const beforeOverflowSet=context.localStorage.setItem;
  context.localStorage.setItem=()=>overflowWrites++;
  await vm.runInContext('saveProject(true)',context);context.localStorage.setItem=beforeOverflowSet;
  assert.equal(overflowWrites,1,'output limits do not block project JSON persistence');
  assert.equal((await context.window.moment.execute('timeline.replace',{clips:[{start:0,end:1}]})).ok,true);
  assert.equal(element('#captionTrack').children.length,101);
  assert.ok(element('#captionTrack').children.every(node=>node.dataset.captionIndex!==undefined));
  vm.runInContext('undo();',context);assert.equal(element('#captionTrack').children.length,1);
  vm.runInContext('undo(true);downloadSrt();',context);assert.equal(downloads,overflowDownloads+2);
  assert.equal(element('#captionTrack').children.length,101);
  vm.runInContext('state.captions=Array.from({length:300},()=>({start:0,end:1,text:"&".repeat(1600)}));renderTimeline();downloadSrt();',context);
  assert.equal(element('#captionTrack').children.length,300,'serialization-only overflow keeps the valid occurrence lane');
  assert.equal(downloads,overflowDownloads+2);assert.match(element('#toast').textContent,/SRT.*2 MiB/);
  vm.runInContext('state.captions=Array.from({length:500},()=>({start:0,end:1,text:"한".repeat(1600)}));renderTimeline();downloadSrt();',context);
  assert.equal(element('#captionTrack').children.length,1);assert.equal(downloads,overflowDownloads+2);
  assert.match(element('#toast').textContent,/원문.*2 MiB/);
  const reducedDocument=projectModule.createProjectDocument(evaluate('state'));reducedDocument.project.captions.splice(1);
  assert.equal((await context.window.moment.execute('project.import',{document:reducedDocument})).ok,true);
  assert.equal(element('#captionTrack').children.length,1);assert.equal(element('#captionTrack').children[0].dataset.captionIndex,'0');
  vm.runInContext('globalThis.outputBudgetDownload=download;globalThis.outputBudgetBlob=null;download=blob=>outputBudgetBlob=blob;downloadSrt();download=outputBudgetDownload;',context);
  const emittedBytes=new Uint8Array(await context.outputBudgetBlob.arrayBuffer());
  assert.deepEqual([...emittedBytes.slice(0,3)],[239,187,191]);
  assert.equal(emittedBytes.byteLength,Buffer.byteLength(projectModule.projectSrt(evaluate('state'),{bom:true})));
  console.log('PASS: derived limits preserve editing, JSON/storage, playback eligibility and undo; lane/SRT recover completely.');
});
