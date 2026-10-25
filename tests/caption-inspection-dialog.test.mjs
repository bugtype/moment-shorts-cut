import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createCaptionInspectionDialog} from '../dist/caption-inspection-dialog.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {setLocale, translateFor} from '../dist/i18n.mjs';
import {createAppFixture} from './fixtures/app.mjs';
function fixture() {
 let project=createDemoProject(),blocked=false,downloadBlocked=false,downloadFailure=false,media=[],panel=true;const nodes=new Map(),events=[],downloads=[];
 const mount=(html,root=false)=>{
  if(root)nodes.clear();else for(const key of nodes.keys())if(/^#inspect(Caption|Occurrence)/.test(key))nodes.delete(key);
  for(const match of html.matchAll(/\bid="([^"]+)"/g)){
   const node={value:'',focus(){events.push(['focus',match[1]]);}};
   let contents='';Object.defineProperty(node,'innerHTML',{get:()=>contents,set:value=>{contents=value;mount(value);}});nodes.set('#'+match[1],node);
  }
 };
 const query=selector=>nodes.get(selector)||null;
 const modal={open:false,onclose:null,close(){this.open=false;events.push(['close']);this.onclose?.();}};
 const openModal=(title,body)=>{modal.onclose?.();modal.onclose=null;mount(body,true);modal.open=true;events.push(['open',title]);};
 const controller=createCaptionInspectionDialog({getProject:()=>project,getMedia:()=>media,isCurrentPanel:()=>panel,query,modal,openModal,blocked:()=>blocked,downloadBlocked:()=>downloadBlocked,download:(blob,name)=>{if(downloadFailure)throw new Error('blocked');downloads.push({blob,name});},pause:()=>events.push(['pause']),seek:t=>events.push(['seek',t]),focusCaption:i=>{assert.equal(modal.open,false);events.push(['caption',i]);},toast:t=>events.push(['toast',t])});
 return {controller,query,modal,events,downloads,project:()=>project,set:p=>project=p,block:b=>blocked=b,blockDownload:b=>downloadBlocked=b,failDownload:b=>downloadFailure=b,media:m=>media=m,panel:p=>panel=p,replace:()=>openModal('Other','<button id="other">Other</button>'),run(value='1'){query('#captionInspectionThreshold').value=value;query('#runCaptionInspection').onclick();}};
}
test('blank numeric checks are optional; invalid values fail and reports are bounded',()=>{
 const f=fixture();f.project().captions=Array.from({length:30},(_,i)=>({start:i/10,end:(i+1)/10,text:'ABC'}));const before=structuredClone(f.project());f.controller.open();assert.equal(f.query('#captionInspectionThreshold').value,'');
 for(const value of ['','0','-1','NaN','Infinity']){f.run(value);assert.equal(f.query('#inspectCaption0'),null);}
 f.run('1');const html=f.query('#captionInspectionResults').innerHTML;assert.match(html,/출력 발생 30개 · 관련 발생 30개 · 전체 결과 30개/);assert.match(html,/필터 결과 30개 · 표시 20개 · 생략 10개/);assert.equal([...html.matchAll(/id="inspectCaption/g)].length,20);assert.equal(f.query('#inspectCaption20'),null);assert.deepEqual(f.project(),before);
 const stale=f.query('#inspectCaption0').onclick;f.query('#captionInspectionThreshold').oninput();stale();assert.ok(!f.events.some(e=>e[0]==='caption'));
});
test('occurrence navigation uses output seconds converted to pre-speed and focus-only does not seek',()=>{
 const f=fixture();f.project().speed=2;f.project().clips=[{start:0,end:2},{start:0,end:2}];f.project().captions=[{start:0,end:1,text:'AB'}];const before=structuredClone(f.project());
 f.controller.open();f.run();const old=f.query('#inspectOccurrence1').onclick;old();assert.deepEqual(f.events.slice(-4),[['close'],['pause'],['seek',2],['caption',0]]);old();assert.equal(f.events.filter(e=>e[0]==='seek').length,1);
 f.controller.open();f.run();const n=f.events.length;f.query('#inspectCaption1').onclick();assert.deepEqual(f.events.slice(n),[['close'],['caption',0]]);assert.deepEqual(f.project(),before);
 f.project().captions=[{start:1,end:2,text:'AB',basis:'timeline'}];f.controller.open();f.run();f.query('#inspectOccurrence0').onclick();assert.deepEqual(f.events.slice(-4),[['close'],['pause'],['seek',1],['caption',0]]);
});
test('same-object edits, API replacements and undo-like replacements invalidate before any navigation',()=>{
 for(const change of [f=>f.project().captions[0].text='Edited',f=>f.set(structuredClone(f.project())),f=>{const old=structuredClone(f.project());f.project().speed=2;f.set(old);}]){
  const f=fixture();f.controller.open();f.run();const old=f.query('#inspectOccurrence0').onclick;change(f);old();assert.match(f.query('#captionInspectionResults').innerHTML,/다시 검사/);assert.ok(!f.events.some(e=>e[0]==='seek'||e[0]==='caption'));old();
  f.run();f.query('#inspectCaption0').onclick();assert.ok(f.events.some(e=>e[0]==='caption'));
 }
});
test('closed/replaced dialogs, stale report buttons and busy navigation never act',()=>{
 for(const close of [f=>f.modal.close(),f=>f.replace(),f=>f.controller.open()]){
  const f=fixture();f.controller.open();f.run();const old=f.query('#inspectOccurrence0').onclick,oldRun=f.query('#runCaptionInspection').onclick;close(f);old();oldRun();assert.ok(!f.events.some(e=>e[0]==='seek'||e[0]==='caption'));
 }
 const f=fixture();f.controller.open();f.run();const stale=f.query('#inspectOccurrence0').onclick;f.run('2');stale();assert.ok(!f.events.some(e=>e[0]==='seek'));
 f.block(true);f.query('#inspectOccurrence0').onclick();assert.equal(f.modal.open,true);assert.ok(!f.events.some(e=>e[0]==='seek'));f.block(false);f.query('#inspectOccurrence0').onclick();assert.ok(f.events.some(e=>e[0]==='seek'));
});
test('inspection captures latest project at run, not at dialog opening',()=>{
 const f=fixture();f.controller.open();const p=createDemoProject();p.captions=[{start:0,end:1,text:'AB'}];f.set(p);f.run();assert.match(f.query('#captionInspectionResults').innerHTML,/출력 발생 1개/);f.query('#inspectCaption0').onclick();assert.ok(f.events.some(e=>e[0]==='caption'));
});
test('actual tools action inspects without edits and navigates an off-page authored cue after closing',async()=>{
 const {context,evaluate,element,doc}=await createAppFixture();
 vm.runInContext("state.duration=120;state.clips=[{start:0,end:120}];state.captions=Array.from({length:51},(_,i)=>({start:i,end:i+1,text:i===50?'LONG CAPTION':'A'}));history=[];future=[];current=2;globalThis.saves=0;scheduleSave=()=>saves++;switchPanel('captions');",context);
 const before=evaluate('({state,history,future,current})');element('#inspectCaptions').onclick();assert.equal(element('#modal').open,true);element('#captionInspectionThreshold').value='2';element('#runCaptionInspection').onclick();element('#inspectCaption0').onclick();
 assert.equal(element('#modal').open,false);assert.equal(doc.activeElement,element('[data-caption-text="50"]'));assert.match(element('#panelContent').innerHTML,/data-caption-text="50"/);assert.deepEqual(evaluate('({state,history,future,current})'),before);assert.equal(evaluate('saves'),0);
});

test('queued close from a previous dialog does not invalidate the immediately reopened inspection',()=>{
 const f=fixture();let queued;
 f.modal.close=function(){this.open=false;queued=()=>this.onclose?.();};
 f.controller.open();f.run();const old=f.query('#inspectCaption0').onclick;
 f.modal.close();f.controller.open();queued();
 assert.equal(f.modal.open,true);f.run();assert.ok(f.query('#inspectCaption0'));
 old();assert.ok(!f.events.some(e=>e[0]==='caption'));
 f.query('#inspectCaption0').onclick();assert.ok(f.events.some(e=>e[0]==='caption'));
});

test('actual app failed recovery allows read-only inspection but blocks result navigation',async()=>{
 const {context,evaluate,element}=await createAppFixture();
 vm.runInContext("history=[];future=[];current=2;globalThis.saves=0;scheduleSave=()=>saves++;switchPanel('captions');Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'});",context);
 const before=evaluate('({state,history,future,current})');
 element('#inspectCaptions').onclick();element('#captionInspectionThreshold').value='1';element('#runCaptionInspection').onclick();
 assert.match(element('#captionInspectionResults').innerHTML,/관련 발생/);
 element('#inspectOccurrence0').onclick();assert.equal(element('#modal').open,true);assert.deepEqual(evaluate('({state,history,future,current})'),before);assert.equal(evaluate('saves'),0);
});


test('duration-only review finds flashes and lingering cues without inventing a speed threshold',()=>{
 const f=fixture();f.project().captions=[{start:0,end:.1,text:'!'},{start:1,end:11,text:'Yes'}];
 const before=structuredClone(f.project());f.controller.open();f.query('#captionInspectionOverlaps').checked=false;
 f.query('#captionInspectionMin').value='.5';f.query('#captionInspectionMax').value='5';f.run('');
 let html=f.query('#captionInspectionResults').innerHTML;
 assert.match(html,/짧은 표시 시간/);assert.match(html,/긴 표시 시간/);assert.match(html,/전체 결과 2개/);
 assert.doesNotMatch(html,/>Yes</);assert.deepEqual(f.project(),before);
 for(const [min,max] of [['0','5'],['2','1'],['Infinity','5'],['NaN','5']]){
  f.query('#captionInspectionMin').value=min;f.query('#captionInspectionMax').value=max;f.run('');
  assert.equal(f.query('#inspectCaption0'),null);
 }
 f.query('#captionInspectionMin').value='';f.query('#captionInspectionMax').value='';f.run('');
 assert.equal(f.events.at(-2)[0],'toast');assert.equal(f.query('#inspectCaption0'),null);
});

test('filter recomputes before limit, preserves global totals, and invalidates prior callbacks',()=>{
 const f=fixture();f.project().captions=[...Array.from({length:25},(_,i)=>({start:i/10,end:(i+1)/10,text:'ABC'})),{start:3,end:11,text:'Yes'}];
 f.controller.open();f.query('#captionInspectionMax').value='5';f.run('1');
 const old=f.query('#inspectCaption0').onclick;
 assert.match(f.query('#captionInspectionResults').innerHTML,/전체 결과 26개/);
 f.query('#captionInspectionFilter').value='too-long';f.query('#captionInspectionFilter').onchange();
 const html=f.query('#captionInspectionResults').innerHTML;
 assert.match(html,/전체 결과 26개/);assert.match(html,/필터 결과 1개 · 표시 1개 · 생략 0개/);
 old();assert.ok(!f.events.some(e=>e[0]==='caption'));
 f.query('#inspectCaption0').onclick();assert.deepEqual(f.events.at(-1),['caption',25]);
});

test('disabled check filter is empty; overlap findings retain related-row and overlap-start navigation',()=>{
 const f=fixture();f.project().speed=2;f.project().captions=[{start:0,end:4,text:'A'},{start:2,end:6,text:'B'}];
 f.controller.open();f.run('');assert.match(f.query('#captionInspectionResults').innerHTML,/전체 결과 2개/);
 f.query('#inspectOther0').onclick();assert.deepEqual(f.events.at(-1),['caption',1]);
 f.controller.open();f.run('');f.query('#inspectOccurrence0').onclick();assert.deepEqual(f.events.slice(-4),[['close'],['pause'],['seek',2],['caption',0]]);
 f.controller.open();f.run('');f.query('#captionInspectionFilter').value='too-short';f.query('#captionInspectionFilter').onchange();
 assert.match(f.query('#captionInspectionResults').innerHTML,/필터 결과 0개/);
 assert.match(f.query('#captionInspectionResults').innerHTML,/꺼진 검사/);
});

test('each criterion, media changes, panel exit and IME block retained review actions',()=>{
 for(const id of ['captionInspectionThreshold','captionInspectionMin','captionInspectionMax','captionInspectionOverlaps']){
  const f=fixture();f.controller.open();f.run('1');const old=f.query('#inspectCaption0').onclick;
  f.query('#'+id).oninput();old();assert.ok(!f.events.some(e=>e[0]==='caption'));
 }
 for(const change of [f=>f.media([{}]),f=>f.panel(false)]){
  const f=fixture();f.controller.open();f.run('1');const old=f.query('#inspectOccurrence0').onclick;change(f);old();
  assert.ok(!f.events.some(e=>e[0]==='seek'||e[0]==='caption'));
 }
 const f=fixture();f.controller.open();f.query('#captionInspectionThreshold').value='1';
 f.query('#runCaptionInspection').onclick({isComposing:true});assert.equal(f.query('#inspectCaption0'),null);
 f.query('#captionInspectionMin').oncompositionstart();f.query('#runCaptionInspection').onclick();assert.equal(f.query('#inspectCaption0'),null);
 f.query('#captionInspectionMin').oncompositionend();f.run('1');
 f.query('#inspectCaption0').onclick({keyCode:229});assert.ok(!f.events.some(e=>e[0]==='caption'));
 const old=f.query('#inspectCaption0').onclick;f.query('#captionInspectionMin').value='.5';old();assert.ok(!f.events.some(e=>e[0]==='caption'));
});

test('locale changes retain review drafts, callbacks and state while translating marked leaves',async()=>{
 const f=await createAppFixture();f.evaluate("switchPanel('captions'); true");
 f.element('#inspectCaptions').onclick();f.element('#captionInspectionThreshold').value='1';
 f.element('#captionInspectionMin').value='0.25';f.element('#captionInspectionMax').value='9';
 f.element('#runCaptionInspection').onclick();
 const input=f.element('#captionInspectionMin');input.focus();input.setSelectionRange(0,3);
 const callback=f.element('#inspectCaption0').onclick, run=f.element('#runCaptionInspection').onclick;
 const before=f.evaluate('JSON.stringify({state,history,future,current})');
 // The fixture does not parse innerHTML leaves; model the actual marked result leaf.
 const leaf=f.element('#advisory-result-label');leaf.setAttribute('data-i18n','advisory.reading-speed');leaf.setAttribute('data-i18n-params','{}');
 try{
  for(const locale of ['ko','en','zh-CN']){
   setLocale(locale,{persist:false});assert.equal(leaf.textContent,translateFor(locale,'advisory.reading-speed'));
   assert.equal(input.value,'0.25');assert.equal(input.selectionEnd,3);assert.equal(f.doc.activeElement,input);
   assert.equal(f.element('#captionInspectionMax').value,'9');assert.equal(f.element('#captionInspectionOverlaps').checked,true);
   assert.equal(f.element('#inspectCaption0').onclick,callback);assert.equal(f.element('#runCaptionInspection').onclick,run);
   assert.equal(f.evaluate('JSON.stringify({state,history,future,current})'),before);
  }
 }finally{setLocale('ko',{persist:false});}
});

test('findings download is the exact bounded filtered report, never authored text or a project backup',async()=>{
 const f=fixture();f.project().name='Private project 🎬';f.project().duration=30;
 f.project().clips=[{start:0,end:30},{start:0,end:30}];f.project().speed=2;
 f.project().captions=Array.from({length:30},(_,i)=>({start:i,end:i+1,text:'PRIVATE e\u0301🎬'}));
 const before=structuredClone(f.project());f.controller.open();assert.equal(f.query('#saveCaptionFindings'),null);
 f.query('#captionInspectionMin').value='.75';f.run('1');
 f.query('#captionInspectionFilter').value='too-short';f.query('#captionInspectionFilter').onchange();
 const report=prepareCommand(before,'captions.inspect',{review:{maxGraphemesPerSecond:1,minDuration:.75,includeOverlaps:true,filter:'too-short'},limit:20}).data;
 f.query('#saveCaptionFindings').onclick();
 assert.equal(f.downloads.length,1);const {blob,name}=f.downloads[0],bytes=await blob.text();
 assert.equal(name,'Private project 🎬.caption-findings.json');assert.equal(blob.type,'application/json');
 assert.equal(bytes,JSON.stringify(report,null,2)+'\n');assert.deepEqual(JSON.parse(bytes),report);
 assert.equal(report.totalOccurrences,60);assert.equal(report.totalFindings,120);
 assert.equal(report.issues.length,20);assert.equal(report.omittedFindings,40);
 assert.equal(report.issues[0].captionIndex,0);assert.equal(report.issues[0].start,0);assert.equal(report.issues[0].end,.5);
 assert.doesNotMatch(bytes,/PRIVATE|Private project|e\u0301🎬/);
 assert.equal(f.modal.open,true);assert.deepEqual(f.project(),before);
 assert.ok(!f.events.some(([kind])=>['seek','pause','caption','close'].includes(kind)));
});

test('empty filtered findings remain exportable with criteria and all-check counts intact',async()=>{
 const f=fixture();f.controller.open();f.run('1');
 f.query('#captionInspectionFilter').value='too-short';f.query('#captionInspectionFilter').onchange();
 f.query('#saveCaptionFindings').onclick();const report=JSON.parse(await f.downloads[0].blob.text());
 assert.equal(report.filter,'too-short');assert.deepEqual(report.issues,[]);assert.equal(report.matchedFindings,0);
 assert.ok(report.totalFindings>0);assert.ok(report.counts.readingSpeed>0);
 f.project().captions=[];f.run('1');f.query('#saveCaptionFindings').onclick();
 assert.equal(JSON.parse(await f.downloads[1].blob.text()).totalOccurrences,0);
});

test('old findings download callbacks refuse changed criteria, contexts and dialog ownership',()=>{
 const changes=[f=>f.query('#captionInspectionMin').oninput(),f=>{f.query('#captionInspectionMin').value='.5';},
  f=>{f.query('#captionInspectionFilter').value='overlap';f.query('#captionInspectionFilter').onchange();},
  f=>f.run('2'),f=>{f.project().captions[0].text='changed';},f=>f.set(structuredClone(f.project())),
  f=>f.media([{}]),f=>f.panel(false),f=>f.modal.close(),f=>f.replace(),f=>f.controller.open()];
 for(const change of changes){
  const f=fixture();f.controller.open();f.run('1');const old=f.query('#saveCaptionFindings').onclick;
  change(f);old();assert.equal(f.downloads.length,0);assert.ok(!f.events.some(([kind])=>kind==='seek'));
 }
});

test('findings download preserves IME, metadata guards and retry after download failure',()=>{
 const f=fixture();f.controller.open();f.run('1');let save=f.query('#saveCaptionFindings').onclick;
 save({isComposing:true});save({keyCode:229});assert.equal(f.downloads.length,0);
 f.query('#captionInspectionThreshold').oncompositionstart();save();assert.equal(f.downloads.length,0);
 f.query('#captionInspectionThreshold').oncompositionend();f.run('1');save=f.query('#saveCaptionFindings').onclick;
 f.blockDownload(true);save();assert.equal(f.downloads.length,0);assert.equal(f.modal.open,true);
 f.blockDownload(false);f.failDownload(true);save();assert.equal(f.downloads.length,0);
 assert.equal(f.events.at(-1)[1].messageKey,'advisory.saveFailed');
 f.failDownload(false);f.block(true);save();assert.equal(f.downloads.length,1,'missing media blocks navigation, not metadata download');
 assert.equal(f.modal.open,true);assert.equal(f.query('#saveCaptionFindings').onclick,save);
});

test('locale changes preserve findings bytes and the same report control without writes',async()=>{
 const f=fixture();f.controller.open();f.run('1');const save=f.query('#saveCaptionFindings').onclick,before=structuredClone(f.project());
 try{
  for(const locale of ['ko','en','zh-CN']){
   setLocale(locale,{persist:false});save();assert.equal(f.query('#saveCaptionFindings').onclick,save);
  }
  const bytes=await Promise.all(f.downloads.map(({blob})=>blob.text()));
  assert.equal(bytes[0],bytes[1]);assert.equal(bytes[1],bytes[2]);assert.deepEqual(f.project(),before);
 }finally{setLocale('ko',{persist:false});}
});

test('actual app findings downloads use metadata recovery guards without project/history/storage/playhead edits',async()=>{
 for(const [setup,allowed] of [
  ['',true],["persistence.restorePhase='failed';persistence.recoveryValid=true",true],
  ["persistence.restorePhase='failed';persistence.recoveryValid=false",false],
  ["persistence.restorePhase='restoring'",false],['loadingMedia=true',false],['exporting=true',false],
  ['transcribing=true',false],["Object.defineProperty(audioRecording,'requesting',{get:()=>true})",false],
  ["Object.defineProperty(audioRecording,'current',{get:()=>({})})",false],
 ]){
  const f=await createAppFixture(),downloads=[],writes=[];
  f.context.collectFindings=(blob,name)=>downloads.push({blob,name});f.context.localStorage.setItem=(...args)=>writes.push(args);
  vm.runInContext("download=(blob,name)=>collectFindings(blob,name);history=[];future=[];current=2;globalThis.findingSaves=0;scheduleSave=()=>findingSaves++;switchPanel('captions');",f.context);
  f.element('#inspectCaptions').onclick();f.element('#captionInspectionThreshold').value='1';f.element('#runCaptionInspection').onclick();
  vm.runInContext(setup,f.context);const before=f.evaluate('({state,history,future,current,playing,findingSaves})');
  f.element('#saveCaptionFindings').onclick();assert.equal(downloads.length,allowed?1:0,setup);
  assert.deepEqual(f.evaluate('({state,history,future,current,playing,findingSaves})'),before);assert.deepEqual(writes,[]);
  assert.equal(f.element('#modal').open,true);
 }
});
