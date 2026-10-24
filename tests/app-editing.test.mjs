import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as projectModule from '../dist/core/project.mjs';
import { createAppFixture } from './fixtures/app.mjs';

test('app editing, selection, input history and keyboard boundaries', async () => {
  const { context, evaluate, element, doc, focusEvents, documentEvents } = await createAppFixture();
  for(const p of ['media','templates','captions','audio','text','effects','settings'])vm.runInContext(`switchPanel('${p}')`,context);
  assert.equal(evaluate('duration()'),12);
  assert.deepEqual(evaluate('locate(3)'),{index:0,source:3,offset:0});
  vm.runInContext('state.clips=[{start:2,end:5},{start:8,end:12}]; state.speed=2; state.captions=[{start:1,end:4,text:"A"},{start:9,end:11,text:"B"}];',context);
  assert.equal(evaluate('duration()'),7);
  assert.deepEqual(evaluate('locate(4)'),{index:1,source:9,offset:3});
  assert.deepEqual(evaluate('outputCaptions()'),[{start:0,end:1,text:'A'},{start:2,end:3,text:'B'}]);
  assert.equal(evaluate('srtTime(3661.125)'),'01:01:01,125');
  await vm.runInContext('importSrt(new Blob(["1\\n00:00:01,250 --> 00:00:03,500\\n테스트 자막\\n\\n2\\n00:00:10,000 --> 00:00:14,000\\n끝 자막"]))',context);
  assert.deepEqual(evaluate('state.captions'),[{start:1.25,end:3.5,text:'테스트 자막'},{start:10,end:12,text:'끝 자막'}]);
  vm.runInContext('state=initial();timelineCache=null;current=5;split();',context);
  assert.deepEqual(evaluate('state.clips'),[{start:0,end:5},{start:5,end:12}]);
  vm.runInContext('undo();',context);
  assert.deepEqual(evaluate('state.clips'),[{start:0,end:12}]);
  console.log('PASS: DOM IDs, all panel initializations, trim mapping, split/undo, caption clipping, speed-adjusted SRT, SRT parsing.');
  
  // A split must stay within the same clip budget enforced by project JSON and commands.
  vm.runInContext('globalThis.splitSave=scheduleSave;globalThis.splitSaves=0;scheduleSave=()=>splitSaves++;',context);
  for(const speed of [.25,1,4]){
   vm.runInContext(`state=initial();state.speed=${speed};state.clips=Array.from({length:999},(_,i)=>i%2?{start:2,end:3}:{start:8,end:9});timelineCache=null;current=.5;selected=0;history=[];future=[];splitSaves=0;`,context);
   const before=evaluate('state');element('#splitButton').onclick();
   assert.equal(evaluate('state.clips.length'),1000);assert.equal(evaluate('selected'),1);assert.equal(evaluate('splitSaves'),1);
   assert.deepEqual(evaluate('state.clips.slice(0,2)'),[{start:8,end:8.5},{start:8.5,end:9}]);
   const splitState=evaluate('state');assert.deepEqual(projectModule.readProjectDocument(JSON.parse(JSON.stringify(projectModule.createProjectDocument(splitState)))),splitState);
   vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),before);
   vm.runInContext('undo(true);edit(()=>state.zoom=1.5);undo();current=1.5;splitSaves=0;',context);
   const atLimit=evaluate('({state,history,future,current,selected})');element('#splitButton').onclick();
   assert.deepEqual(evaluate('({state,history,future,current,selected})'),atLimit,'Rejected split preserves project, selection and undo/redo');
   assert.equal(evaluate('splitSaves'),0);assert.match(element('#toast').textContent,/1,000/);
   vm.runInContext('selected=0;trim(8,8.4)',context);assert.equal(evaluate('state.clips.length'),1000);
   element('#moveRight').onclick();assert.equal(evaluate('state.clips.length'),1000);
   assert.doesNotThrow(()=>projectModule.createProjectDocument(evaluate('state')));
   element('#deleteButton').onclick();assert.equal(evaluate('state.clips.length'),999);
   vm.runInContext('current=.25;split()',context);assert.equal(evaluate('state.clips.length'),1000);
   assert.doesNotThrow(()=>projectModule.createProjectDocument(evaluate('state')));
  }
  vm.runInContext('scheduleSave=splitSave;delete globalThis.splitSave;delete globalThis.splitSaves;state=initial();timelineCache=null;current=0;selected=0;history=[];future=[];',context);
  console.log('PASS: split clip budget, exact boundary, rejected no-op, JSON round-trip, speed/source mapping, undo/redo and trim/reorder/delete at the limit.');
  
  // Context changes reveal the relevant controls without editing the project.
  const inspectorState=evaluate('state'),inspectorHistory=evaluate('history.length');
  function assertInspector(section){
   for(const name of ['frame','clip','caption'])assert.equal(element('#'+name+'Settings').open,name===section);
  }
  vm.runInContext("switchPanel('captions')",context);assertInspector('caption');
  vm.runInContext("switchPanel('settings')",context);assertInspector('frame');
  element('#videoTrack').onclick({clientX:135,target:{closest:()=>({dataset:{clip:'0'},getBoundingClientRect:()=>({left:0,width:540})})}});
  assertInspector('clip');
  assert.equal(element('#trimEnd').value,'12.0');
  assert.deepEqual(evaluate('state'),inspectorState);
  assert.equal(evaluate('history.length'),inspectorHistory,'Opening properties must not add undo entries');
  let preventedDisclosure=false;
  documentEvents.get('keydown')({target:{tagName:'SUMMARY'},code:'Space',key:' ',preventDefault(){preventedDisclosure=true;}});
  assert.equal(preventedDisclosure,false,'Space must retain native disclosure behavior');
  assert.equal(evaluate('playing'),false,'Space on a disclosure must not start playback');
  vm.runInContext("switchPanel('settings');current=5;split()",context);assertInspector('clip');
  assert.equal(element('#clipIndex').textContent,'클립 2');
  assert.equal(element('#trimStart').value,'5.0');
  vm.runInContext('undo()',context);
  element('#captionTrack').onclick();assertInspector('caption');
  vm.runInContext("textLayer='caption';switchPanel('text')",context);assertInspector('caption');
  vm.runInContext("textLayer='title';switchPanel('settings')",context);
  console.log('PASS: selection-aware inspector, split selection, unchanged project/history and caption navigation.');
  
  // Timeline navigation uses the clicked occurrence, never text or source-time matching.
  vm.runInContext(`state=initial();state.clips=[{start:8,end:12},{start:2,end:5},{start:8,end:10}];state.speed=2;
   state.captions=[{start:1,end:3,text:'same'},{start:9,end:11,text:'same'},{start:0,end:2,text:'same',basis:'timeline'}];changed();`,context);
  const navigationState=evaluate('state'),navigationHistory=evaluate('history.length');
  function assertCaptionVisibleTarget(target){
   assert.equal(doc.activeElement,target);
   const events=focusEvents.slice(-2);
   assert.deepEqual(events.map(event=>event.target),[target,target]);
   assert.deepEqual(JSON.parse(JSON.stringify(events.map(({action,options})=>({action,options})))),[
    {action:'focus',options:{preventScroll:true}},
    {action:'scroll',options:{block:'nearest',inline:'nearest',behavior:'instant'}}
   ]);
  }
  function clickCaptionBlock(index){
   const blocks=element('#captionTrack').children;
   const block=blocks[index];assert.ok(block,'Expected a rendered caption occurrence');
   element('#captionTrack').onclick({target:{closest:()=>block}});
   return +block.dataset.captionIndex;
  }
  assert.equal(clickCaptionBlock(3),1);
  assert.equal(evaluate('current'),8,'Repeated source caption seeks to its clicked edited occurrence before speed');
  assertCaptionVisibleTarget(element('[data-caption-text="1"]'));
  assert.equal(element('#captionTrack').children[3].attributes['aria-label'],'자막 2, 4.0초: same');
  assert.equal(clickCaptionBlock(2),0);assert.equal(evaluate('current'),4,'Trimmed caption seeks to its visible start');
  assert.equal(clickCaptionBlock(0),2);assert.equal(evaluate('current'),0,'Narration uses the edited clock');
  assert.equal(doc.activeElement,element('[data-caption-text="2"]'));
  assert.deepEqual(evaluate('state'),navigationState);assert.equal(evaluate('history.length'),navigationHistory);
  vm.runInContext("edit(()=>state.captions.splice(0,1),true)",context);
  assert.equal(clickCaptionBlock(2),0,'Deletion rebuilds references to the surviving row');
  assertCaptionVisibleTarget(element('[data-caption-text="0"]'));
  vm.runInContext('undo()',context);assert.equal(clickCaptionBlock(3),1,'Undo restores row mapping');
  context.navigator={mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}};
  context.MediaRecorder=class {start(){this.state='recording';}stop(){this.state='inactive';}};
  vm.runInContext("switchPanel('audio');current=3",context);
  await vm.runInContext('toggleRecording()',context);
  clickCaptionBlock(3);assert.equal(evaluate('current'),3);assert.equal(evaluate('panel'),'audio');
  await vm.runInContext('toggleRecording()',context);
  await vm.runInContext('audioRecording.current.onstop()',context);
  delete context.navigator;delete context.MediaRecorder;
  vm.runInContext('exporting=true',context);clickCaptionBlock(3);assert.equal(evaluate('current'),3);
  vm.runInContext('exporting=false',context);
  let preventedCaption=false;
  documentEvents.get('keydown')({target:{tagName:'BUTTON'},code:'Space',key:' ',preventDefault(){preventedCaption=true;}});
  assert.equal(preventedCaption,false,'Space on a caption must use native button activation');
  assert.equal(evaluate('playing'),false);
  vm.runInContext('state=initial();timelineCache=null;current=0;changed()',context);
  console.log('PASS: caption occurrence navigation, duplicate text, trim/repeat/narration/speed, deletion/undo, focus and busy guards.');
  
  // All direct range callers share keyboard/pointer history without changing seek semantics.
  vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();sources.audioFile={name:"synthetic.wav"};switchPanel("audio");switchPanel("settings")',context);
  for(const [id,key,next] of [['zoom','zoom',1.2],['volume','volume',.7],['audioVolume','audioVolume',.6],['mobileZoom','zoom',1.4],['captionSize','captionSize',35],['captionY','captionY',.7],['panelVolume','volume',.5]]){
   const control=element('#'+id),before=evaluate('state.'+key),count=evaluate('history.length'),step=id==='captionSize'?1:.01;
   control.value=String(before);control.oninput();assert.equal(evaluate('history.length'),count,'No-op must not add history');
   control.value=String(next);control.oninput();control.value=String(next+step);control.oninput();
   assert.equal(evaluate('history.length'),count+1,id+' keyboard inputs form one group');
   vm.runInContext('undo()',context);assert.equal(evaluate('state.'+key),before);
   vm.runInContext('undo(true)',context);assert.equal(evaluate('state.'+key),next+step);
   control.value=String(next+step*2);control.oninput();assert.equal(evaluate('history.length'),count+2,'Undo/redo ends an old group');
   control.onblur();
  }
  vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();sources.audioFile=null;changed()',context);
  const zoomControl=element('#zoom');zoomControl.onpointerdown();zoomControl.value='1.5';zoomControl.oninput();zoomControl.value='1.8';zoomControl.oninput();zoomControl.onpointerup();
  assert.equal(evaluate('history.length'),1);vm.runInContext('undo()',context);assert.equal(evaluate('state.zoom'),1);
  zoomControl.onpointerdown();zoomControl.value='1';zoomControl.oninput();zoomControl.onpointerup();assert.equal(evaluate('future.length'),1,'No-op pointer interaction preserves redo');
  zoomControl.value='1.2';zoomControl.oninput();vm.runInContext('edit(()=>state.name="Interleaved")',context);zoomControl.value='1.3';zoomControl.oninput();
  assert.equal(evaluate('history.length'),3,'Another edit ends a range group');
  vm.runInContext('exporting=true',context);zoomControl.value='2';zoomControl.oninput();assert.equal(evaluate('state.zoom'),1.3);
  vm.runInContext('exporting=false;state=initial();history=[];future=[];inputHistory.reset();current=0;changed()',context);
  console.log('PASS: range history across inspector/audio/mirror controls, no-op/redo, interleaved edits and export guard.');
  
  // Live mirrors must share the model without rebuilding focused settings controls.
  vm.runInContext('state=initial();state.clips=[{start:0,end:4},{start:4,end:12}];selected=1;current=5;history=[];future=[];inputHistory.reset();switchPanel("settings");renderInspector();',context);
  const mirrorZoom=element('#mobileZoom'),mirrorVolume=element('#panelVolume');
  // This fixture does not parse native input values from generated HTML.
  mirrorZoom.value='1';mirrorVolume.value='1';
  const settingsMarkup=element('#panelContent').innerHTML,mirrorHandlers=[mirrorZoom.oninput,mirrorVolume.oninput];
  element('#panelTrimStart').value='4.5';element('#panelTrimEnd').value='11.5';
  function assertRangeCopies(zoom,volume){
   assert.deepEqual([Number(element('#zoom').value),Number(mirrorZoom.value),Number(element('#volume').value),Number(mirrorVolume.value)],[zoom,zoom,volume,volume]);
   assert.deepEqual(evaluate('[state.zoom,state.volume]'),[zoom,volume]);
  }
  zoomControl.focus();zoomControl.value='1.5';zoomControl.oninput();zoomControl.value='1.75';zoomControl.oninput();
  assertRangeCopies(1.75,1);assert.equal(evaluate('history.length'),1);
  assert.equal(doc.activeElement,zoomControl);zoomControl.onblur();
  mirrorVolume.focus();mirrorVolume.onpointerdown();mirrorVolume.value='.5';mirrorVolume.oninput();mirrorVolume.value='.35';mirrorVolume.oninput();mirrorVolume.onpointerup();
  assertRangeCopies(1.75,.35);assert.equal(evaluate('history.length'),2);
  assert.equal(doc.activeElement,mirrorVolume);
  assert.equal(element('#panelContent').innerHTML,settingsMarkup,'live sync must not rebuild the panel');
  assert.deepEqual([mirrorZoom.oninput,mirrorVolume.oninput],mirrorHandlers);
  assert.deepEqual([element('#panelTrimStart').value,element('#panelTrimEnd').value],['4.5','11.5']);
  assert.deepEqual(evaluate('[selected,current]'),[1,5]);
  vm.runInContext('undo()',context);assertRangeCopies(1.75,1);
  const mirrorHistory=evaluate('[history.length,future.length]');
  const mirrorValueDescriptor=Object.getOwnPropertyDescriptor(mirrorVolume,'value');
  let mirrorValue=mirrorVolume.value,mirrorWrites=0;
  Object.defineProperty(mirrorVolume,'value',{configurable:true,get:()=>mirrorValue,set:value=>{mirrorValue=value;mirrorWrites++;}});
  vm.runInContext('renderInspector();renderInspector();',context);
  assert.equal(mirrorWrites,0,'unchanged mirror values should not be assigned again');
  Object.defineProperty(mirrorVolume,'value',{...mirrorValueDescriptor,value:mirrorValue});
  assert.deepEqual(evaluate('[history.length,future.length]'),mirrorHistory);
  vm.runInContext('undo(true)',context);assertRangeCopies(1.75,.35);
  mirrorZoom.focus();mirrorZoom.value='2';mirrorZoom.oninput();mirrorZoom.value='2.25';mirrorZoom.oninput();mirrorZoom.onblur();
  assertRangeCopies(2.25,.35);assert.equal(evaluate('history.length'),3);
  element('#volume').onpointerdown();element('#volume').value='.6';element('#volume').oninput();element('#volume').onpointerup();
  assertRangeCopies(2.25,.6);assert.equal(evaluate('history.length'),4);
  assert.equal((await context.window.moment.execute('project.update',{patch:{zoom:1.6,volume:.4}})).ok,true);
  assertRangeCopies(1.6,.4);
  element('#resetPosition').onclick();assertRangeCopies(1,.4);
  const mirrorImport=projectModule.createProjectDocument(projectModule.createDemoProject());
  mirrorImport.project.zoom=2.1;mirrorImport.project.volume=.2;
  assert.equal((await context.window.moment.execute('project.import',{document:mirrorImport})).ok,true);
  assertRangeCopies(2.1,.2);
  vm.runInContext('confirmReset()',context);element('#confirmReset').onclick();assertRangeCopies(1,1);
  const mirrorQueries=doc.querySelector;
  doc.querySelector=selector=>['#mobileZoom','#panelVolume'].includes(selector)?null:mirrorQueries(selector);
  assert.doesNotThrow(()=>vm.runInContext('switchPanel("media");renderInspector();',context));
  assert.equal((await context.window.moment.execute('project.update',{patch:{zoom:1.3,volume:.7}})).ok,true);
  doc.querySelector=mirrorQueries;
  vm.runInContext('switchPanel("settings");renderInspector();',context);assertRangeCopies(1.3,.7);
  assert.match(element('#panelContent').innerHTML,/id="mobileZoom"[^>]*value="1.3"/);
  assert.match(element('#panelContent').innerHTML,/id="panelVolume"[^>]*value="0.7"/);
  vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();current=0;selected=0;changed()',context);
  console.log('PASS: zoom/volume mirrors sync in both directions without live panel replacement, focus/history changes or pending trim loss; commands, undo, reset, import and absent panels work.');
  
  // Inspector trim fields are drafts until Apply, scoped to the selected clip.
  function trimDraft(start,end){element('#trimStart').value=start;element('#trimEnd').value=end;}
  function assertTrimDraft(start,end){assert.deepEqual([element('#trimStart').value,element('#trimEnd').value],[start,end]);}
  function selectTrimClip(index){
   const clip={dataset:{clip:String(index)},getBoundingClientRect:()=>({left:0,width:100})};
   element('#videoTrack').onclick({target:{closest:()=>clip},clientX:0});
  }
  vm.runInContext('state=initial();state.clips=[{start:0,end:4},{start:4,end:12}];selected=0;current=2;history=[];future=[];inputHistory.reset();switchPanel("media");renderInspector();',context);
  trimDraft('1.50','3.50');element('#trimStart').focus();
  const trimClipBefore=evaluate('state.clips');
  zoomControl.value='1.4';zoomControl.oninput();zoomControl.onblur();
  assertTrimDraft('1.50','3.50');assert.equal(doc.activeElement,element('#trimStart'));
  element('#volume').focus();element('#volume').value='.6';element('#volume').oninput();element('#volume').onblur();
  assertTrimDraft('1.50','3.50');assert.deepEqual(evaluate('state.clips'),trimClipBefore);
  for(const [command,args] of [['project.update',{patch:{fit:'contain'}}],['title.update',{patch:{lines:['first','second']}}],['captions.replace',{captions:[{start:0,end:2,text:'caption'}]}]]){
   assert.equal((await context.window.moment.execute(command,args)).ok,true);
   assertTrimDraft('1.50','3.50');assert.deepEqual(evaluate('state.clips'),trimClipBefore);
  }
  const trimHistory=evaluate('history.length');
  trimDraft('3','2');element('#trimButton').onclick();
  assertTrimDraft('3','2');assert.equal(evaluate('history.length'),trimHistory);assert.match(element('#toast').textContent,/시작·끝/);
  vm.runInContext('renderInspector()',context);assertTrimDraft('3','2');
  trimDraft('1.5','3.5');vm.runInContext('exporting=true',context);element('#trimButton').onclick();
  assertTrimDraft('1.5','3.5');assert.deepEqual(evaluate('state.clips'),trimClipBefore);assert.equal(evaluate('history.length'),trimHistory);
  vm.runInContext('exporting=false',context);element('#trimButton').onclick();
  assert.deepEqual(evaluate('state.clips[0]'),{start:1.5,end:3.5});assertTrimDraft('1.5','3.5');
  trimDraft('2','3');vm.runInContext('undo()',context);assertTrimDraft('0.0','4.0');
  trimDraft('1','2');vm.runInContext('undo(true)',context);assertTrimDraft('1.5','3.5');
  trimDraft('1.50','3.50');element('#trimButton').onclick();assertTrimDraft('1.5','3.5');
  trimDraft('2','3');selectTrimClip(1);assertTrimDraft('4.0','12.0');selectTrimClip(0);assertTrimDraft('1.5','3.5');
  // Equal bounds must not make two different clips share a draft.
  await context.window.moment.execute('timeline.replace',{clips:[{start:0,end:4},{start:0,end:4}]});
  trimDraft('1','3');selectTrimClip(1);assertTrimDraft('0.0','4.0');
  // Moving the same selected occurrence retains its draft; selecting its equal-range sibling does not.
  trimDraft('1','3');element('#moveLeft').onclick();assertTrimDraft('1','3');
  assert.equal(evaluate('selected'),0);assert.deepEqual(evaluate('state.clips[0]'),{start:0,end:4});
  trimDraft('1','3');element('#deleteButton').onclick();assertTrimDraft('0.0','4.0');
  trimDraft('1','3');vm.runInContext('current=2;split()',context);assertTrimDraft('2.0','4.0');
  trimDraft('2.5','3.5');
  const replacementTrimProject=projectModule.createProjectDocument(evaluate('state'));
  const invalidTrimProject=structuredClone(replacementTrimProject);invalidTrimProject.project.clips=[];
  assert.equal((await context.window.moment.execute('project.import',{document:invalidTrimProject})).ok,false);assertTrimDraft('2.5','3.5');
  assert.equal((await context.window.moment.execute('project.import',{document:replacementTrimProject})).ok,true);
  assertTrimDraft('2.0','4.0');
  trimDraft('2.5','3.5');await context.window.moment.execute('timeline.replace',{clips:evaluate('state.clips')});assertTrimDraft('2.0','4.0');
  trimDraft('2.5','3.5');await context.window.moment.execute('template.apply',{templateId:'clean',withContent:false});assertTrimDraft('2.0','4.0');
  trimDraft('2.5','3.5');vm.runInContext('confirmReset()',context);element('#confirmReset').onclick();assertTrimDraft('0.0','12.0');
  vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();selected=0;current=0;changed()',context);
  console.log('PASS: trim drafts survive unrelated edits and failed/blocked Apply; successful Apply, clip selection/structure, undo/redo and project replacement reset their context.');
  
  for(const [startId,endId,applyId] of [['trimStart','trimEnd','trimButton'],['panelTrimStart','panelTrimEnd','panelTrimApply']]){
   vm.runInContext('state=initial();state.clips=[{start:2,end:8}];selected=0;current=0;history=[];future=[];inputHistory.reset();switchPanel("settings");renderInspector();',context);
   vm.runInContext('edit(()=>state.zoom=1.2);undo();',context);
   const beforeNumericTrim=evaluate('[state,history,future]'),startInput=element('#'+startId),endInput=element('#'+endId);
   for(const [start,end] of [['','6'],[' \t','6'],['2',''],['2',' \t'],['bad','6'],['2','bad'],['Infinity','6'],['2','Infinity'],['1e999','6'],['-1','6'],['2','13'],['6','2'],['2','2.05']]){
    startInput.value=start;endInput.value=end;element('#'+applyId).onclick();
    assert.deepEqual(evaluate('[state,history,future]'),beforeNumericTrim,`${startId}: ${JSON.stringify([start,end])}`);
    assert.deepEqual([startInput.value,endInput.value],[start,end]);assert.match(element('#toast').textContent,/시작·끝/);
   }
   // A native bad-input state may expose an empty string and NaN simultaneously.
   const numericGetter=Object.getOwnPropertyDescriptor(startInput,'valueAsNumber');
   startInput.value='';endInput.value='6';Object.defineProperty(startInput,'valueAsNumber',{configurable:true,value:NaN});
   element('#'+applyId).onclick();assert.deepEqual(evaluate('[state,history,future]'),beforeNumericTrim);
   Object.defineProperty(startInput,'valueAsNumber',numericGetter);
   startInput.value='0';endInput.value='6.25';element('#'+applyId).onclick();
   assert.deepEqual(evaluate('state.clips'),[{start:0,end:6.25}]);assert.equal(evaluate('history.length'),1);assert.equal(evaluate('future.length'),0);
   vm.runInContext('undo()',context);assert.deepEqual(evaluate('state.clips'),[{start:2,end:8}]);
   startInput.value='0';endInput.value='0.1';element('#'+applyId).onclick();assert.deepEqual(evaluate('state.clips'),[{start:0,end:.1}]);
  }
  const typedTrimBefore=evaluate('[state,history,future]');
  for(const start of ['', ' ', NaN, Infinity]){
   assert.equal((await context.window.moment.execute('timeline.replace',{clips:[{start,end:6}]})).ok,false);
   assert.deepEqual(evaluate('[state,history,future]'),typedTrimBefore);
  }
  vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();selected=0;current=0;changed()',context);
  console.log('PASS: both trim Apply paths reject empty/invalid/nonfinite inputs without losing drafts/history; zero, decimals, minimum duration, correction and undo remain supported.');
  
  // Focusing mounted design text/color controls must leave actual project redo intact.
  const titleInput=element('#titleFirst'),titleColor=element('[data-design="design.title.colors.0"]');
  Object.assign(titleInput,{type:'text',dataset:{design:'design.title.lines.0'},value:'평범했던 하루가',setCustomValidity(){}});
  Object.assign(titleColor,{type:'color',dataset:{design:'design.title.colors.0'},value:'#ffffff',setCustomValidity(){}});
  const designRoot=element('#panelContent'),previousQueries=designRoot.querySelectorAll;
  designRoot.querySelectorAll=selector=>selector==='[data-design]'?[titleInput,titleColor]:[];
  vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();switchPanel("text")',context);
  zoomControl.value='1.01';zoomControl.oninput();vm.runInContext('undo()',context);
  assert.equal(evaluate('future.length'),1);titleInput.focus();titleInput.onblur();titleColor.onclick();titleColor.onchange();titleColor.onblur();
  assert.equal(evaluate('history.length'),0);assert.equal(evaluate('future.length'),1);
  vm.runInContext('undo(true)',context);assert.equal(evaluate('state.zoom'),1.01);
  const originalTitle=evaluate('state.design.title.lines[0]');
  titleInput.value='한';titleInput.oninput();titleInput.value='한글 제목';titleInput.oninput();titleInput.onblur();
  assert.equal(evaluate('history.length'),2);vm.runInContext('undo()',context);assert.equal(evaluate('state.design.title.lines[0]'),originalTitle);
  vm.runInContext('undo(true)',context);assert.equal(evaluate('state.design.title.lines[0]'),'한글 제목');
  designRoot.querySelectorAll=previousQueries;
  vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();current=0;changed()',context);
  console.log('PASS: mounted text/color focus preserves redo; typing groups and undo/redo restores the final title.');
  
  // Space belongs to focused controls; global playback still works elsewhere.
  function keydown(tagName,key,extra={}){
   let prevented=false;
   documentEvents.get('keydown')({target:{tagName},key,code:key===' '?'Space':key,preventDefault(){prevented=true;},...extra});
   return prevented;
  }
  const keyboardState=evaluate('state'),keyboardHistory=evaluate('history.length');
  for(const playing of [false,true]){
   vm.runInContext(`playing=${playing}`,context);
   for(const tag of ['BUTTON','INPUT','TEXTAREA','SELECT','SUMMARY']){
    assert.equal(keydown(tag,' '),false,`Space must retain native ${tag} behavior`);
    assert.equal(evaluate('playing'),playing,'Focused controls must not toggle playback');
   }
  }
  assert.equal(keydown('BODY',' '),true);assert.equal(evaluate('playing'),false,'Space outside a control pauses playback');
  assert.deepEqual(evaluate('state'),keyboardState);assert.equal(evaluate('history.length'),keyboardHistory);
  vm.runInContext('current=3',context);
  keydown('BUTTON','ArrowRight');assert.equal(evaluate('current'),4,'Button focus must not disable timeline arrow shortcuts');
  keydown('TEXTAREA','ArrowLeft');assert.equal(evaluate('current'),4,'Text cursor arrows must not seek');
  keydown('BUTTON','ArrowLeft');assert.equal(evaluate('current'),3);
  vm.runInContext("edit(()=>state.name='Keyboard regression')",context);
  assert.equal(keydown('BUTTON','z',{ctrlKey:true}),true);assert.equal(evaluate('state.name'),keyboardState.name,'Undo remains available from buttons');
  vm.runInContext('current=0;changed()',context);
  console.log('PASS: native Space activation boundary, form controls, global playback, arrow keys and undo.');
  
  
});
