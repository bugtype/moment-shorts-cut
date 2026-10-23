import * as projectModule from './dist/core/project.mjs';
import { prepareCommand } from './dist/core/commands.mjs';
import { CommandError } from './dist/core/validation.mjs';
import { createEditorService } from './dist/integration/editor-service.mjs';
import * as captionModule from './dist/captions.mjs';
import { renderCaptionTrack, renderCaptionTrackError, updateTimelineMarkup } from './dist/timeline-view.mjs';
import { createInputHistory } from './dist/input-history.mjs';
import { createTrack } from './tests/fixtures/timeline-dom.mjs';
import * as effectsModule from './dist/effects.mjs';
import * as templateModule from './dist/template-catalog.mjs';
import {readTemplateLibrary,validateTemplateLibrary} from './dist/template-library.mjs';
import { mountTemplateGallery } from './dist/template-gallery.mjs';
import { mountEffectsPanel } from './dist/effects-panel.mjs';
import * as typographyModule from './dist/typography.mjs';
import { createProjectStore } from './dist/project-store.mjs';
import { createMediaStorageFixture } from './tests/fixtures/media-storage.mjs';
import { mountDesignPanel } from './dist/design-panel.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync('dist/app.js','utf8');
const panelSource=['design-panel.mjs','effects-panel.mjs','template-gallery.mjs'].map(f=>fs.readFileSync('dist/'+f,'utf8')).join('\n');
const html=fs.readFileSync('dist/index.html','utf8');
const ids=new Set([...`${html}\n${source}\n${panelSource}`.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]));
const selectors=[...source.matchAll(/\$\('#([\w-]+)'\)/g)].map(m=>m[1]);
assert.deepEqual([...new Set(selectors.filter(id=>!ids.has(id)))],[], 'Every fixed DOM ID must be declared');
const htmlIds=[...html.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]);
assert.equal(htmlIds.length,new Set(htmlIds).size,'No duplicate IDs in the page');

const elements=new Map(),focusEvents=[];
let measurementCalls=0;
const context2d=new Proxy({}, {get:(target,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):key==='measureText'?text=>{measurementCalls++;return {width:text.length*10};}:()=>{}});
function element(key=''){
 if(elements.has(key))return elements.get(key);
 const e={value:'',innerHTML:'',textContent:'',hidden:false,style:{},dataset:{},clientWidth:700,clientHeight:500,width:540,height:960,currentTime:0,duration:12,readyState:4,videoWidth:1920,videoHeight:1080,
 classList:{add(){},remove(){},toggle(){}},setAttribute(){},setPointerCapture(){},removeAttribute(){},addEventListener(){},removeEventListener(){},insertAdjacentHTML(){},getContext(){return context2d;},querySelector(selector){return selector==='.icon'?null:element(key+' '+selector);},querySelectorAll(){return [];},focus(options){doc.activeElement=this;focusEvents.push({target:this,action:"focus",options});},scrollIntoView(options){focusEvents.push({target:this,action:"scroll",options});},pause(){},play(){return Promise.resolve();},getBoundingClientRect(){return {left:0,top:0,width:540,height:960};},showModal(){this.open=true;},close(){this.open=false;}};
 elements.set(key,e);return e;
}
let canvasCount=0,rafCounter=0;const pendingFrames=new Map();
Object.assign(element('#captionTrack'),createTrack());
for(const id of ['zoom','volume','audioVolume','mobileZoom','captionSize','captionY','panelVolume'])element('#'+id).type='range';
for(const id of ['trimStart','trimEnd','panelTrimStart','panelTrimEnd']){
 const control=element('#'+id);control.type='number';
 // Model the numeric getter contract; this is not browser input sanitization.
 Object.defineProperty(control,'valueAsNumber',{configurable:true,get(){const value=String(this.value);return value.trim()===''?NaN:Number(value);}});
}
const documentEvents=new Map();
const doc={querySelector:element,querySelectorAll:()=>[],addEventListener(name,handler){documentEvents.set(name,handler);},body:element('body'),fonts:{ready:Promise.resolve()},createElement:()=>element('canvas-'+(++canvasCount))};
const context=vm.createContext({document:doc,window:{addEventListener(){}},Image:class{complete=false;},localStorage:{getItem:()=>null,setItem(){}},requestAnimationFrame(callback){pendingFrames.set(++rafCounter,callback);return rafCounter;},cancelAnimationFrame(id){pendingFrames.delete(id);},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},console,URL,Blob,TextDecoder,performance,Number,Math,Promise,structuredClone,...projectModule,prepareCommand,CommandError,createEditorService,...captionModule,renderCaptionTrack,renderCaptionTrackError,updateTimelineMarkup,createInputHistory,...effectsModule,...templateModule,readTemplateLibrary,validateTemplateLibrary,mountTemplateGallery,mountEffectsPanel,...typographyModule,createProjectStore,mountDesignPanel});
vm.runInContext(source.replace(/^import .*;$/gm,'').replace(/init\(\);\s*$/,'globalThis.ready=init();'),context);
await context.ready;
for(const [id,cb] of pendingFrames){pendingFrames.delete(id);cb(performance.now());}
assert.equal(pendingFrames.size,0,'A paused editor must not schedule a perpetual animation loop');
for(const p of ['media','templates','captions','audio','text','effects','settings'])vm.runInContext(`switchPanel('${p}')`,context);
const evaluate=code=>JSON.parse(JSON.stringify(vm.runInContext(code,context)));
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
vm.runInContext("switchPanel('audio');record={state:'recording'};current=3",context);
clickCaptionBlock(3);assert.equal(evaluate('current'),3);assert.equal(evaluate('panel'),'audio');
vm.runInContext('record=null;exporting=true',context);clickCaptionBlock(3);assert.equal(evaluate('current'),3);
vm.runInContext('exporting=false',context);
let preventedCaption=false;
documentEvents.get('keydown')({target:{tagName:'BUTTON'},code:'Space',key:' ',preventDefault(){preventedCaption=true;}});
assert.equal(preventedCaption,false,'Space on a caption must use native button activation');
assert.equal(evaluate('playing'),false);
vm.runInContext('state=initial();timelineCache=null;current=0;changed()',context);
console.log('PASS: caption occurrence navigation, duplicate text, trim/repeat/narration/speed, deletion/undo, focus and busy guards.');

// All direct range callers share keyboard/pointer history without changing seek semantics.
vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();audioFile={name:"synthetic.wav"};switchPanel("audio");switchPanel("settings")',context);
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
vm.runInContext('state=initial();history=[];future=[];inputHistory.reset();audioFile=null;changed()',context);
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
trimDraft('1','3');element('#moveLeft').onclick();assertTrimDraft('0.0','4.0');
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


// Old saved projects retain their full-frame composition and original overlay.
const defaults=evaluate('initial()');
const migrated=typographyModule.migrateProject({kind:'video',overlay:'기존 제목',overlayColor:'#ff0000',captionY:.8},defaults);
assert.equal(migrated.design.layout,'full');
assert.equal(migrated.design.title.lines[0],'기존 제목');
assert.equal(migrated.design.title.colors[0],'#ff0000');
assert.equal(migrated.design.credit.enabled,false);
assert.equal(migrated.captionY,.8);
assert.equal(typographyModule.layerVisible({enabled:true,start:2,end:5},1),false);
assert.equal(typographyModule.layerVisible({enabled:true,start:2,end:5},2),true);
assert.equal(typographyModule.layerVisible({enabled:true,start:2,end:5},5),false);
assert.equal(typographyModule.layerVisible({enabled:true,start:2,end:null},99),true);
const frame=typographyModule.videoFrame(defaults.design,540,960);
assert.equal(frame.y,240);assert.ok(Math.abs(frame.h-518.4)<.001);
const preset=structuredClone(migrated);
typographyModule.applyDesignPreset(preset,'reference');
assert.equal(preset.design.title.lines[0],'기존 제목');assert.equal(preset.design.layout,'framed');

// Rendering the same composed frame reuses cached text rasterization.
const renderer=typographyModule.createTypographyRenderer(()=>element('cached-'+(++canvasCount)));
renderer.draw(context2d,540,960,defaults,1,1,defaults.captions[0]);
const measuredOnce=measurementCalls;
for(let i=0;i<100;i++)renderer.draw(context2d,540,960,defaults,1,1,defaults.captions[0]);
assert.equal(measurementCalls,measuredOnce,'Repeated frames must not remeasure identical text');
for(let i=0;i<80;i++)renderer.draw(context2d,540,960,defaults,1,1,{start:0,end:4,text:'서로 다른 자막 '+i});
assert.ok(renderer.cacheInfo().entries<=48);
assert.ok(renderer.cacheInfo().pixels<=8_000_000);
renderer.clear();assert.equal(renderer.cacheInfo().entries,0);

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
console.log('PASS: legacy migration, title timing, presets, bounded typography cache, idle scheduler, changed-media writes and write ordering.');
console.log('Browser rendering, media codecs and remote speech inference remain unverified.');

// Every template is checked both as styling and as a timed example composition.
const templateNames=[];
for(const template of templateModule.TEMPLATES){
 const project=structuredClone(defaults);
 project.design.title.lines=['<나의 제목>',''];project.design.credit.text='내 출처';
 project.captions[0].keywords='순간';project.overlays=[effectsModule.newCard(12,2)];
 const captions=structuredClone(project.captions),cards=structuredClone(project.overlays),clips=structuredClone(project.clips);
 templateModule.applyTemplate(project,template,false);
 assert.deepEqual(project.design.title.lines,['<나의 제목>',''],template.id+' retains title');
 assert.equal(project.design.credit.text,'내 출처');
 assert.deepEqual(project.captions,captions);assert.deepEqual(project.overlays,cards);assert.deepEqual(project.clips,clips);
 templateModule.applyTemplate(project,template,true);
 assert.deepEqual(project.design.title.lines,template.title);
 assert.deepEqual(project.captions,captions);assert.deepEqual(project.clips,clips);
 assert.ok(project.overlays.length<=12);if(['reference','punch','clean','cinema'].includes(template.id))assert.equal(project.overlays.length,0,'footage-first templates do not add information cards');else assert.ok(project.overlays.length>0);
 assert.equal(new Set(project.overlays.map(c=>c.id)).size,project.overlays.length);
 for(const card of project.overlays){assert.ok(card.start>=0&&card.end>card.start&&card.end<=12);assert.ok(!effectsModule.cardAtTime(card,card.end));}
 const adapted=structuredClone(defaults);adapted.clips=[{start:0,end:.1}];adapted.speed=2;
 templateModule.applyTemplate(adapted,template,true);
 for(const card of adapted.overlays)assert.ok(card.start>=0&&card.end>card.start&&card.end<=.05,template.id+' short output');
 const frameProject=JSON.stringify(project);
 // Exercise real shared compositor branches at both preview and output dimensions.
 for(const fraction of [0,.1,.4,.71,.99])for(const [width,height] of [[540,960],[1080,1920]]){
  vm.runInContext(`paintComposition(ctx,${width},${height},${frameProject},{source:sample,sw:540,sh:960,ready:true,sourceTime:${12*fraction},time:${12*fraction},total:12,elapsed:${12*fraction},remaining:${12*(1-fraction)},progress:${fraction}})`,context);
 }
 templateNames.push(template.id);
}
console.log('PASS templates, text preservation, duration scaling and compositor paths: '+templateNames.join(', '));

const savedProject=structuredClone(defaults);
templateModule.applyTemplate(savedProject,templateModule.TEMPLATES.find(t=>t.id==='recipe'),true);
savedProject.design.title.start=2;savedProject.design.title.end=8;
const custom=templateModule.saveCustomTemplate('내 요리 구성',savedProject),customTarget=structuredClone(defaults);
customTarget.clips=[{start:0,end:24}];customTarget.design.title.lines=['보존할 제목',''];customTarget.design.credit.text='보존할 출처';
templateModule.applyTemplate(customTarget,custom,false);
assert.deepEqual(customTarget.design.title.lines,['보존할 제목','']);assert.equal(customTarget.design.credit.text,'보존할 출처');
assert.equal(customTarget.design.title.start,4);assert.equal(customTarget.design.title.end,16);assert.equal(customTarget.templateId,custom.id);
templateModule.applyTemplate(customTarget,custom,true);
assert.deepEqual(customTarget.design.title.lines,savedProject.design.title.lines);
assert.equal(customTarget.overlays[1].start,savedProject.overlays[1].start*2);
customTarget.design.title.lines[0]='changed';assert.notEqual(custom.settings.design.title.lines[0],'changed','custom settings are not aliased');
const blankProject=structuredClone(defaults);blankProject.design.title.lines=['',''];
templateModule.applyTemplate(blankProject,templateModule.TEMPLATES[0],false);assert.deepEqual(blankProject.design.title.lines,['','']);
const reloaded=typographyModule.migrateProject(JSON.parse(JSON.stringify(savedProject)),defaults);
assert.deepEqual(reloaded,savedProject,'v4 JSON migration preserves every project field');
console.log('PASS: custom style-only text preservation, relative timing on longer videos, independent copies, blank title and save/restore.');

// All motion types and transitions stay within bounds, including very short clips.
for(const motion of ['none','in','out'])for(const transition of ['none','fadeBlack','flash'])for(const length of [.05,.2,12]){
 const fx={...effectsModule.defaultEnhancements().effects,motion,transition,strength:.4,transitionDuration:.7};
 for(const progress of [0,.25,.5,.75,1]){
  const result=effectsModule.clipEffects(fx,length*progress,length*(1-progress),progress);
  assert.ok(result.zoom>=1&&result.zoom<=1.4);assert.ok(result.opacity>=0&&result.opacity<=1);
  if(transition==='none')assert.equal(result.opacity,0);
  if(transition!=='none'&&progress===.5)assert.equal(result.opacity,0);
 }
}
const timing=structuredClone(savedProject);effectsModule.retimeOutputLayers(timing,12,6);
assert.equal(timing.design.title.start,1);assert.equal(timing.design.title.end,4);assert.equal(timing.design.credit.end,null);
assert.equal(timing.overlays[0].end,savedProject.overlays[0].end/2);
const boundary=effectsModule.newCard(.05,20);assert.ok(boundary.end>boundary.start&&boundary.end<=.05);
for(const limit of [1,12,18,24]){
 const cap={start:2,end:8,text:'이모지🎬를 포함한 긴 자막도 손상 없이 문장과 시간이 이어져야 합니다.',speaker:'1',keywords:'자막',basis:'timeline'};
 const pieces=effectsModule.splitCaptionText(cap,limit);
 assert.equal(pieces[0].start,2);assert.equal(pieces.at(-1).end,8);
 assert.equal(pieces.map(c=>c.text).join('').replace(/\s/g,''),cap.text.replace(/\s/g,''));
 pieces.forEach((part,i)=>{assert.ok(part.end>part.start);assert.equal(part.speaker,'1');assert.equal(part.basis,'timeline');assert.equal(part.timing,'estimated');assert.ok(Array.from(part.text).length<=limit);if(i)assert.equal(part.start,pieces[i-1].end);});
}
const longCaption={start:0,end:4,text:'[특수] + C++ (A) .* $ ? \\ 순간',keywords:'[특수],C++,(A),.*, $,?,\\',speaker:'1'};
renderer.draw(context2d,540,960,defaults,1,1,longCaption); // Keywords are literal, never executable regular expressions.
console.log('PASS: zoom/fade/flash boundaries, title/card retiming, short cards, Unicode caption splitting, speaker metadata and literal keyword escaping.');

const reorderedClips=[{start:8,end:12},{start:0,end:4},{start:8,end:12}];
const narrated=captionModule.mapAudioCaptions([{start:0,end:2,text:'내레이션'}],1,12);
assert.deepEqual(captionModule.editedCaptions(narrated,reorderedClips,2),[{start:.5,end:1.5,text:'내레이션'}],'narration appears only once even with repeated source clips');
assert.equal(captionModule.findCaption(narrated,9,2).text,'내레이션');assert.equal(captionModule.findCaption(narrated,9,8),undefined);
assert.deepEqual(captionModule.editedCaptions([{start:9,end:11,text:'원본 음성'}],reorderedClips,2),[{start:.5,end:1.5,text:'원본 음성'},{start:4.5,end:5.5,text:'원본 음성'}]);
vm.runInContext('state=initial();timelineCache=null;duration();current=11;edit(()=>state.clips[0].end=6);',context);
assert.equal(evaluate('duration()'),6);assert.equal(evaluate('current'),6,'clip edits invalidate cached duration before clamping');
vm.runInContext('undo();',context);assert.equal(evaluate('duration()'),12);
vm.runInContext('undo(true);',context);assert.equal(evaluate('duration()'),6);
vm.runInContext('state=initial();timelineCache=null;current=12;switchPanel("captions");',context);element('#addCaption').onclick();
assert.ok(evaluate('state.captions.at(-1).end>state.captions.at(-1).start'),'adding a caption at the end must not create a zero-length caption');
console.log('PASS: narration versus source clocks, repeated/reordered clips, cache invalidation, undo/redo and caption creation at the final frame.');

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
vm.runInContext('videoFile=captionTestFile;renderPanel()',context);
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
vm.runInContext('videoFile=null;state=initial();timelineCache=null;renderPanel()',context);
delete context.captionTestFile;delete context.AudioContext;delete context.OfflineAudioContext;
console.log('PASS: captions-first layout, empty/add/delete/import focus, timing notices and running/cancelled generation without a model download.');

// Count failures happen before edit(): preserve history, redo, pending save and focus.
function setCaptionLimitFixture(captions){
 context.captionLimitFixture=captions;
 vm.runInContext('state=initial();state.captions=structuredClone(captionLimitFixture);timelineCache=null;history=[];future=[];edit(()=>state.name="redo target");undo();switchPanel("captions");saveTimer={pending:true};',context);
 projectModule.createProjectDocument(evaluate('state'));
 element('#captionChunkSize').value='12';
}
function assertCaptionCountRejected(button){
 const before=evaluate('({state,history,future})'),timer=vm.runInContext('saveTimer',context);
 button.focus();const focused=doc.activeElement,events=focusEvents.length;
 button.onclick();
 assert.deepEqual(evaluate('({state,history,future})'),before);
 assert.equal(vm.runInContext('saveTimer',context),timer);
 assert.equal(doc.activeElement,focused);assert.equal(focusEvents.length,events);
 assert.match(element('#toast').textContent,/10,000/);
 assert.deepEqual(projectModule.readProjectDocument(projectModule.createProjectDocument(evaluate('state'))),before.state);
}
// A split that changes nothing must not consume redo or schedule a save.
function assertSplitNoop(){
 const before=evaluate('({state,history,future})'),timer=vm.runInContext('saveTimer',context);
 const original=vm.runInContext('state.captions',context);element('#splitLongCaptions').focus();const events=focusEvents.length;
 element('#splitLongCaptions').onclick();
 assert.deepEqual(evaluate('({state,history,future})'),before);assert.equal(vm.runInContext('state.captions',context),original);
 assert.equal(vm.runInContext('saveTimer',context),timer);assert.equal(focusEvents.length,events);
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
 vm.runInContext('edit(()=>state.zoom=1.5);undo();saveTimer={pending:true};',context);assertSplitNoop();
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
const unsupportedBefore=evaluate('({state,history,future})'),unsupportedTimer=vm.runInContext('saveTimer',context);
element('#splitLongCaptions').focus();const unsupportedFocus=focusEvents.length;
element('#splitLongCaptions').onclick();
assert.deepEqual(evaluate('({state,history,future})'),unsupportedBefore);
assert.equal(vm.runInContext('saveTimer',context),unsupportedTimer);assert.equal(focusEvents.length,unsupportedFocus);
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
context.Worker=class {postMessage(){queueMicrotask(()=>this.onmessage({data:{type:'result',result:context.captionTestResult??{chunks:context.captionTestChunks}}}));}};
for(const source of ['video','audio'])for(const count of [captionModule.MAX_CAPTIONS,captionModule.MAX_CAPTIONS+1]){
 setCaptionLimitFixture([shortLimitCaption]);
 vm.runInContext('videoFile=captionTestFile;audioFile=captionTestFile;recognitionWorker=null',context);
 element('#captionSource').value=source;
 context.captionTestChunks=Array.from({length:count},()=>({timestamp:[0,1],text:'인식된 자막'}));
 const before=evaluate('({state,history,future})'),timer=vm.runInContext('saveTimer',context);
 await vm.runInContext('generateCaptions()',context);
 if(count>captionModule.MAX_CAPTIONS){
  assert.deepEqual(evaluate('({state,history,future})'),before);
  assert.equal(vm.runInContext('saveTimer',context),timer);assert.match(element('#toast').textContent,/10,000/);
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
  vm.runInContext('videoFile=captionTestFile;audioFile=captionTestFile;state.audioOffset=2;recognitionWorker=null',context);
  element('#captionSource').value=source;context.captionTestResult=result;
  const before=evaluate('({state,history,future})'),timer=vm.runInContext('saveTimer',context);
  await vm.runInContext('generateCaptions()',context);
  assert.deepEqual(evaluate('({state,history,future})'),before,`${source}: invalid ASR must keep the entire previous state`);
  assert.equal(vm.runInContext('saveTimer',context),timer);
  assert.equal(evaluate('transcribing'),false);assert.equal(vm.runInContext('pendingTranscriptionReject',context),null);
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
   vm.runInContext('videoFile=captionTestFile;audioFile=captionTestFile;state.audioOffset=2;recognitionWorker=null',context);
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
vm.runInContext('videoFile=captionTestFile;recognitionWorker=null',context);element('#captionSource').value='video';
context.captionTestResult={chunks:[{timestamp:[0,13],text:'outside source'}]};
const beforeOutOfBounds=evaluate('({state,history,future})');
await vm.runInContext('generateCaptions()',context);assert.deepEqual(evaluate('({state,history,future})'),beforeOutOfBounds);
// Validation is pure; it must not release the transcription guard to commit a command.
context.prepareCommand=(...args)=>{assert.equal(evaluate('transcribing'),true);return prepareCommand(...args);};
context.captionTestResult={text:'valid fallback'};
await vm.runInContext('generateCaptions()',context);
assert.deepEqual(evaluate('state.captions'),[{start:0,end:12,text:'valid fallback'}]);context.prepareCommand=prepareCommand;
delete context.captionTestResult;
console.log('PASS: ASR validation preserves prior state/redo/save on invalid chunks or fallback; Unicode boundaries, both clocks, cleanup, retry and canonical JSON succeed.');

// Synthetic delayed worker/decode responses; no model, real audio or storage.
const asrWorkers=[];let workerPosted;
context.Worker=class {constructor(){asrWorkers.push(this);}postMessage(){workerPosted(this);}terminate(){this.terminated=true;this.terminateCalls=(this.terminateCalls||0)+1;}};
context.AudioContext=class {async decodeAudioData(){return {duration:1};}async close(){}};
context.asrSourceFile={name:'synthetic.wav',arrayBuffer:async()=>new ArrayBuffer(0)};
vm.runInContext('globalThis.asrScheduleSave=scheduleSave;globalThis.asrSaves=0;scheduleSave=()=>asrSaves++;',context);
function resetAsr(){vm.runInContext('state=initial();state.audioName=asrSourceFile.name;state.audioOffset=2;timelineCache=null;history=[];future=[JSON.stringify(state)];current=0;selected=0;videoFile=asrSourceFile;audioFile=asrSourceFile;recognitionWorker=null;transcribing=false;asrSaves=0;saveTimer={pending:true};panel="captions";renderPanel();',context);}
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
  source==='audio'?'audioFile={...asrSourceFile}':'videoFile={...asrSourceFile}',
  'edit(()=>{state.duration=10;state.clips=[{start:0,end:10}];})',
  ...(source==='audio'?['edit(()=>state.audioOffset=3)','edit(()=>state.clips[0].end=8)']:[]),
 ]){
  resetAsr();const task=await startAsr(source);vm.runInContext(mutation,context);
  const before=asrSnapshot(),timer=vm.runInContext('saveTimer',context);
  asrResult(task.worker);await task.pending;
  assert.deepEqual(asrSnapshot(),before,`${source}: conflict preserves current edits/history/redo/saves`);
  assert.equal(vm.runInContext('saveTimer',context),timer);assert.match(element('#toast').textContent,/변경되어/);
  assert.equal(evaluate('transcribing'),false);assert.equal(vm.runInContext('pendingTranscriptionReject',context),null);
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
vm.runInContext('videoFile=asrDelayedFile',context);element('#captionSource').value='video';
const decoding=vm.runInContext('generateCaptions()',context),workerCount=asrWorkers.length;
vm.runInContext('edit(()=>state.captions[0].text="edited during read")',context);const decodeBefore=asrSnapshot();
releaseAsrRead(new ArrayBuffer(0));await decoding;
assert.deepEqual(asrSnapshot(),decodeBefore);assert.equal(asrWorkers.length,workerCount);
// Provider-reported errors leave the job retryable without applying any result.
for(const failure of ['message','worker']){
 resetAsr();const task=await startAsr('video'),before=asrSnapshot();
 const oldMessage=task.worker.onmessage,oldError=task.worker.onerror,oldReject=vm.runInContext('pendingTranscriptionReject',context);
 if(failure==='message')task.worker.onmessage({data:{type:'error',message:'synthetic provider failure'}});else task.worker.onerror();
 await task.pending;assert.deepEqual(asrSnapshot(),before);assert.equal(evaluate('transcribing'),false);
 if(failure==='worker'){assert.equal(task.worker.terminateCalls,1);assert.equal(vm.runInContext('recognitionWorker',context),null);oldError();assert.equal(task.worker.terminateCalls,1);}
 else{assert.equal(task.worker.terminateCalls,undefined);assert.equal(vm.runInContext('recognitionWorker',context),task.worker);}
 const retry=await startAsr('video');assert.equal(retry.worker===task.worker,failure==='message');
 const status=evaluate('transcriptionStatus');oldMessage({data:{type:'progress',message:'stale progress'}});oldMessage({data:{type:'result',result:{text:'stale result'}}});oldError();oldReject(new Error('stale cancellation'));
 assert.equal(evaluate('transcriptionStatus'),status);assert.equal(evaluate('transcribing'),true);assert.equal(vm.runInContext('recognitionWorker',context),retry.worker);
 assert.deepEqual(asrSnapshot(),before);assert.equal(retry.worker.terminated,undefined);
 asrResult(retry.worker,'retried');await retry.pending;assert.equal(evaluate('state.captions[0].text'),'retried');
}
// Healthy completed workers are reused; an idle native failure retires the cache.
resetAsr();const healthy=await startAsr('video');asrResult(healthy.worker);await healthy.pending;
const warm=await startAsr('video');assert.equal(warm.worker,healthy.worker);asrResult(warm.worker,'warm result');await warm.pending;
const idleBefore=asrSnapshot(),idleFailure=warm.worker.onerror;idleFailure();idleFailure();
assert.deepEqual(asrSnapshot(),idleBefore);assert.equal(warm.worker.terminateCalls,1);assert.equal(vm.runInContext('recognitionWorker',context),null);
const afterIdle=await startAsr('video');assert.notEqual(afterIdle.worker,warm.worker);idleFailure();
assert.equal(vm.runInContext('recognitionWorker',context),afterIdle.worker);asrResult(afterIdle.worker);await afterIdle.pending;
// Startup and synchronous transport failures never leave an unusable cached worker.
const workingWorker=context.Worker;
for(const failure of ['constructor','postMessage']){
 resetAsr();const before=asrSnapshot(),count=asrWorkers.length;
 context.Worker=failure==='constructor'?class {constructor(){throw new Error('synthetic constructor failure');}}:class extends workingWorker {postMessage(){throw new Error('synthetic postMessage failure');}};
 element('#captionSource').value='video';await vm.runInContext('generateCaptions()',context);
 assert.deepEqual(asrSnapshot(),before);assert.equal(evaluate('transcribing'),false);assert.equal(vm.runInContext('recognitionWorker',context),null);
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
assert.equal(evaluate('transcriptionStatus'),retryStatus);assert.equal(vm.runInContext('recognitionWorker',context),retryAfterCancel.worker);assert.equal(cancelled.worker.terminateCalls,1);
asrResult(retryAfterCancel.worker,'new job');await retryAfterCancel.pending;assert.equal(evaluate('state.captions[0].text'),'new job');
// Cancel can arrive after the result promise resolves but before it is consumed.
resetAsr();const resolved=await startAsr('video'),resolvedBefore=asrSnapshot();
asrResult(resolved.worker);await vm.runInContext('generateCaptions()',context);await resolved.pending;
assert.deepEqual(asrSnapshot(),resolvedBefore);assert.match(element('#toast').textContent,/취소/);
vm.runInContext('scheduleSave=asrScheduleSave;',context);
console.log('PASS: synthetic ASR conflicts preserve edits/history/redo/saves; source removal, time maps, decode/worker delays, cancellation/late responses, provider errors, retry and unaffected appearance edits are covered.');
console.log('PASS: synthetic worker startup/native/postMessage failures retire only their instance; explicit retry, warm reuse, job errors, idle failure and stale message/error/reject callbacks preserve state.');
vm.runInContext('videoFile=null;audioFile=null;recognitionWorker=null',context);
delete context.AudioContext;delete context.OfflineAudioContext;delete context.Worker;delete context.captionTestFile;delete context.captionTestChunks;
vm.runInContext('state=initial();timelineCache=null;history=[];future=[];renderPanel()',context);
delete context.captionLimitFixture;
console.log('PASS: split/add/ASR count boundaries, early rejection without mutation/redo/save/focus loss, Unicode and time-base metadata, exact-boundary JSON/SRT export and undo/redo.');

// Panel controls are exercised with supplied DOM controls (not a browser layout test).
function control(type,dataset,value){return {type,dataset,value,checked:false,setCustomValidity(message){this.error=message;},reportValidity(){this.reported=true;}};}
function panelRoot(lists={},byId={}){return {innerHTML:'',querySelectorAll(selector){return lists[selector]||[];},querySelector(selector){return byId[selector]||null;}};}
const inputs=[control('number',{design:'design.title.start'},'5'),control('number',{design:'design.title.end'},'3'),control('text',{design:'speakerLabels.1'},'인터뷰이'),control('text',{design:'globalKeywords'},'순간, C++'),control('range',{design:'captionY',unit:'%'},'75')];
let panelProject=structuredClone(defaults),snapshots=0;
const panelRanges=createInputHistory(()=>snapshots++);
mountDesignPanel(panelRoot({'[data-design]':inputs}),{state:panelProject,layer:'caption',total:12,snapshot(){snapshots++;},input:panelRanges.bind,update(fn){fn(panelProject);}});
inputs[0].onchange();assert.equal(panelProject.design.title.start,5);
inputs[1].onchange();assert.equal(panelProject.design.title.end,null);assert.ok(inputs[1].error);
inputs[1].value='9';inputs[1].onchange();assert.equal(panelProject.design.title.end,9);assert.equal(inputs[1].error,'');
inputs[2].oninput();assert.equal(panelProject.speakerLabels[1],'인터뷰이');
inputs[3].oninput();assert.equal(panelProject.globalKeywords,'순간, C++');
inputs[4].oninput();assert.equal(panelProject.captionY,.75);const rangeSnapshots=snapshots;inputs[4].oninput();assert.equal(snapshots,rangeSnapshots);
const testCard=effectsModule.newCard(12,2);panelProject.overlays=[testCard];
const cardInputs=[control('number',{card:'start'},'8'),control('number',{card:'end'},'9'),control('text',{card:'text'},'수정한 카드'),control('range',{card:'size'},'42')];
const buttons=Object.fromEntries(['#addSceneCard','#toggleSceneLayers','#removeSceneCard','#duplicateSceneCard','#previewSceneCard'].map(id=>[id,{}]));
const cardRoot=panelRoot({'[data-card]':cardInputs},buttons);
mountEffectsPanel(panelRoot({}, {'#effectControls':cardRoot}),{state:panelProject,total:12,tab:'cards',selected:testCard.id,snapshot(){snapshots++;},input:panelRanges.bind,update(fn){fn(panelProject);},add(){},remove(){},duplicate(){},play(){}});
cardInputs[0].onchange();assert.equal(testCard.start,2);assert.ok(cardInputs[0].error);
cardInputs[1].onchange();cardInputs[0].onchange();assert.equal(testCard.start,8);assert.equal(testCard.end,9);
cardInputs[2].oninput();assert.equal(testCard.text,'수정한 카드');cardInputs[3].oninput();assert.equal(testCard.size,42);
const fxInputs=[control('range',{effect:'brightness'},'1.25'),control('select-one',{effect:'motion'},'out'),control('checkbox',{effect:'progress'},'')];fxInputs[2].checked=true;
mountEffectsPanel(panelRoot({}, {'#effectControls':panelRoot({'[data-effect]':fxInputs},{'#resetEffects':{}})}),{state:panelProject,total:12,tab:'motion',snapshot(){snapshots++;},input:panelRanges.bind,update(fn){fn(panelProject);},reset(){}});
fxInputs[0].oninput();fxInputs[1].onchange();fxInputs[2].onchange();
assert.equal(panelProject.effects.brightness,1.25);assert.equal(panelProject.effects.motion,'out');assert.equal(panelProject.effects.progress,true);
console.log('PASS: actual panel event handlers, invalid timing rejection and correction, speaker/global keyword edits and motion/color controls.');

// Primary controls precede composition presets; moving markup keeps existing actions intact.
const panelActions=[];
for(const layer of ['title','caption','credit','frame']){
 const layerButtons=['title','caption','credit','frame'].map(textLayer=>({dataset:{textLayer}}));
 const presetButtons=['reference','punch','clean'].map(layoutPreset=>({dataset:{layoutPreset}}));
 const links=Object.fromEntries(['#openTemplateGallery','#openCaptionEditor','#openScreenEditor'].map(id=>[id,{}]));
 const root=panelRoot({'[data-text-layer]':layerButtons,'[data-layout-preset]':presetButtons},links);
 mountDesignPanel(root,{state:panelProject,layer,total:12,select(value){panelActions.push(['layer',value]);},preset(value){panelActions.push(['preset',value]);},navigate(value){panelActions.push(['navigate',value]);}});
 assert.match(root.innerHTML,/<h1 class="panel-heading">타이틀 · 디자인<\/h1>/);
 assert.ok(root.innerHTML.indexOf('class="layer-tabs"')<root.innerHTML.indexOf('class="layer-controls"'));
 assert.ok(root.innerHTML.indexOf('class="layer-controls"')<root.innerHTML.indexOf('class="design-presets"'));
 assert.ok(!root.innerHTML.includes('SHORTS TYPOGRAPHY'));assert.ok(!root.innerHTML.includes('각각의 역할에 맞게 디자인하세요'));
 assert.match(root.innerHTML,new RegExp(`aria-selected="true" data-text-layer="${layer}"`));
 assert.equal((root.innerHTML.match(/aria-selected="true"/g)||[]).length,1);
 assert.ok(root.innerHTML.includes('출력 시 해상도에 맞춰 확대됩니다.'));
 if(layer==='title'||layer==='credit')assert.ok(root.innerHTML.includes('끝을 비워두면 영상 끝까지 표시합니다.'));
 if(layer==='caption')assert.ok(root.innerHTML.includes('쉼표로 구분합니다.'));
 layerButtons.find(button=>button.dataset.textLayer===layer).onclick();
 if(layer==='title'){presetButtons.forEach(button=>button.onclick());links['#openTemplateGallery'].onclick();}
 if(layer==='caption')links['#openCaptionEditor'].onclick();
 if(layer==='frame')links['#openScreenEditor'].onclick();
}
assert.deepEqual(panelActions,[['layer','title'],['preset','reference'],['preset','punch'],['preset','clean'],['navigate','templates'],['layer','caption'],['navigate','captions'],['layer','credit'],['layer','frame'],['navigate','settings']]);
for(const tab of ['cards','motion']){
 const tabs=['cards','motion'].map(effectTab=>({dataset:{effectTab}})),selected=[];
 const root=panelRoot({'[data-effect-tab]':tabs},{'#effectControls':tab==='cards'?cardRoot:panelRoot({},{'#resetEffects':{}})});
 mountEffectsPanel(root,{state:panelProject,total:12,tab,selected:testCard.id,input:panelRanges.bind,changeTab(value){selected.push(value);}});
 assert.match(root.innerHTML,/<h1 class="panel-heading">연출<\/h1><div class="layer-tabs" role="tablist" aria-label="연출 도구">/);
 assert.match(root.innerHTML,new RegExp(`data-effect-tab="${tab}" role="tab" aria-selected="true"`));
 assert.equal((root.innerHTML.match(/aria-selected="true"/g)||[]).length,1);assert.ok(!root.innerHTML.includes('STORY & MOTION'));
 tabs.forEach(button=>button.onclick());assert.deepEqual(selected,['cards','motion']);
}
console.log('PASS: design/effects control-first hierarchy retains selected tabs, preset/navigation actions and essential timing/input instructions.');


// Gallery hierarchy, accessible filter groups and existing actions remain connected.
const search={},grid={innerHTML:''},count={},saveButton={};
const categories=['전체','리뷰','정보','라이프','대화','참여','즐겨찾기','내 템플릿'].map(category=>({dataset:{category},classList:{toggle(){}},setAttribute(name,value){this[name]=value;}}));
const previewButton={dataset:{previewTemplate:'recipe'}},favoriteButton={dataset:{favorite:'recipe'}},removeButton={dataset:{removeTemplate:custom.id}};
const galleryActions=[];
const galleryRoot=panelRoot({'[data-category]':categories,'[data-preview-template]':[previewButton],'[data-favorite]':[favoriteButton],'[data-remove-template]':[removeButton]}, {'#templateSearch':search,'#templateGrid':grid,'#templateCount':count,'#saveMyTemplate':saveButton});
const galleryState={query:'',category:'전체'},galleryApi={ui:galleryState,custom:[],favorites:['recipe'],active:'reference',save(){galleryActions.push('save');},preview(item){galleryActions.push(['preview',item.id]);},favorite(id){galleryActions.push(['favorite',id]);},remove(id){galleryActions.push(['remove',id]);}};
mountTemplateGallery(galleryRoot,galleryApi);assert.equal(count.textContent,'10개의 구성');
assert.match(galleryRoot.innerHTML,/<div class="gallery-heading"><h1 class="panel-heading">템플릿<\/h1><button[^>]*id="saveMyTemplate"/);
assert.ok(galleryRoot.innerHTML.indexOf('id="saveMyTemplate"')<galleryRoot.innerHTML.indexOf('id="templateSearch"'));
assert.match(galleryRoot.innerHTML,/role="group" aria-label="템플릿 분류"/);
assert.match(galleryRoot.innerHTML,/role="group" aria-label="개인 템플릿"/);
assert.match(galleryRoot.innerHTML,/aria-label="템플릿 검색"/);
assert.equal((galleryRoot.innerHTML.match(/data-category=/g)||[]).length,8);
assert.ok(!galleryRoot.innerHTML.includes('TEMPLATE STUDIO'));assert.ok(!galleryRoot.innerHTML.includes('gallery-disclosure'));
assert.ok(!grid.innerHTML.includes('template-tag'));assert.ok(grid.innerHTML.includes('· 적용됨'));
assert.match(grid.innerHTML,/aria-label="한눈에 보는 레시피 미리보기"/);assert.match(grid.innerHTML,/aria-label="한눈에 보는 레시피 즐겨찾기" aria-pressed="true"/);
saveButton.onclick();previewButton.onclick();favoriteButton.onclick();removeButton.onclick();
assert.deepEqual(galleryActions,['save',['preview','recipe'],['favorite','recipe'],['remove',custom.id]]);
categories[6].onclick();assert.equal(galleryState.category,'즐겨찾기');assert.equal(count.textContent,'1개의 구성');
assert.deepEqual(categories.map(button=>button['aria-pressed']),[false,false,false,false,false,false,true,false]);
categories[1].onclick();assert.equal(galleryState.category,'리뷰');assert.equal(categories[6]['aria-pressed'],false);assert.equal(categories[1]['aria-pressed'],true);
categories[0].onclick();assert.equal(count.textContent,'10개의 구성');
search.oninput({target:{value:' 요리 '}});assert.ok(grid.innerHTML.includes('한눈에 보는 레시피'));
search.oninput({target:{value:'인터뷰'}});assert.ok(grid.innerHTML.includes('인터뷰 하이라이트'));assert.ok(!grid.innerHTML.includes('시네마틱 모먼트'));
galleryState.query='';galleryState.category='즐겨찾기';mountTemplateGallery(galleryRoot,galleryApi);assert.equal(count.textContent,'1개의 구성');assert.ok(grid.innerHTML.includes('한눈에 보는 레시피'));
galleryState.category='내 템플릿';galleryApi.custom=[{...custom,name:'<img src=x onerror=alert(1)>'}];mountTemplateGallery(galleryRoot,galleryApi);assert.ok(grid.innerHTML.includes('&lt;img'));assert.ok(!grid.innerHTML.includes('<img'));
galleryApi.error='<읽기 실패>';mountTemplateGallery(galleryRoot,galleryApi);assert.match(galleryRoot.innerHTML,/role="alert">&lt;읽기 실패&gt;<\/p>/);
search.oninput({target:{value:'no matching template'}});assert.ok(grid.innerHTML.includes('조건에 맞는 템플릿이 없습니다.'));assert.equal(count.textContent,'0개의 구성');
console.log('PASS: template gallery hierarchy, accessible filters, preview/save/favorite/delete actions, empty/error states and HTML escaping.');

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
 await vm.runInContext('state=initial();state.kind="video";state.fileName=fixtureVideo.name;videoFile=fixtureVideo;audioFile=null;persistMedia();audioFile=fixtureAudio;state.audioName=fixtureAudio.name;persistMedia();saveProject()',context);
 assert.deepEqual(Object.fromEntries(mediaFixture.records),{video:context.fixtureVideo,audio:context.fixtureAudio});
 assert.equal(JSON.parse(savedJson).fileName,'new.mp4');assert.equal(JSON.parse(savedJson).audioName,'voice.wav');
 assert.equal(jsonWrites,1);assert.ok(element('#saveStatus').innerHTML.includes('이 브라우저에 저장됨'));
 const committedJson=savedJson;
 context.fixtureVideo={name:'replacement.mp4'};
 mediaFixture.failures.push(new Error('latest media write failed'));
 await vm.runInContext('videoFile=fixtureVideo;state.fileName=fixtureVideo.name;persistMedia();saveProject()',context);
 assert.equal(savedJson,committedJson);assert.equal(jsonWrites,1,'Failed media must not advance project JSON');
 assert.equal(mediaFixture.records.get('video').name,'new.mp4');
 assert.ok(element('#saveStatus').innerHTML.includes('저장 공간을 확인하세요'));
 await vm.runInContext('persistMedia();saveProject()',context);
 assert.equal(JSON.parse(savedJson).fileName,'replacement.mp4');assert.equal(jsonWrites,2);
 assert.deepEqual(mediaFixture.records.get('video'),context.fixtureVideo);
 assert.ok(element('#saveStatus').innerHTML.includes('이 브라우저에 저장됨'));
}finally{
 Object.assign(appStore,originalStore);context.localStorage.setItem=originalSetItem;
 vm.runInContext('pendingSave=Promise.resolve();videoFile=null;audioFile=null;state=initial();timelineCache=null;',context);
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
assert.equal(releasedTracks,1,'release microphone if recorder construction fails');assert.equal(evaluate('record'),null);assert.equal(evaluate('requestingMic'),false);
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
await pendingRecorders[0].onstop();assert.equal(evaluate('record'),null);
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
 assert.equal(micRequests,acquisitions);assert.equal(recorder.stopCalls,1);assert.equal(vm.runInContext('record',context),recorder);
 events.data({data:new Blob(['recorded bytes'])});const finishing=events.stop();
 assert.equal(recorder.stream.track.stops,1);assert.equal(recordTimers.size,0);assert.equal(vm.runInContext('record',context),recorder);
 await vm.runInContext('toggleRecording()',context);assert.equal(micRequests,acquisitions,'Audio handoff remains single-flight');
 assert.equal((await context.window.moment.execute('project.update',{patch:{zoom:1.5}})).error.code,'BUSY');
 const before=evaluate('state');await vm.runInContext('loadVideo({});startExport({},720);generateCaptions();confirmReset();switchPanel("templates");',context);
 assert.deepEqual(evaluate('state'),before);assert.equal(evaluate('panel'),'audio');
 timer();assert.equal(recorder.stopCalls,1);events.error();events.data({data:new Blob(['late'])});await events.stop();
 if(outcome==='reject')failAudio(new Error('audio decode failed'));else completeAudio();await finishing;
 assert.equal(evaluate('record'),null);assert.equal(recorder.stream.track.stops,1);
 await vm.runInContext('toggleRecording()',context);const newest=sessions.at(-1),newTimer=timerId;
 const text=element('#recordButton').innerHTML;events.error();await events.stop();events.data({data:new Blob(['stale'])});timer();
 assert.equal(vm.runInContext('record',context),newest);assert.ok(recordTimers.has(newTimer));assert.equal(newest.stream.track.stops,0);assert.equal(element('#recordButton').innerHTML,text);
 const end=newest.onstop;await vm.runInContext('toggleRecording()',context);await end();assert.equal(newest.stream.track.stops,1);
}
assert.equal(audioHandoffs,2);
for(const failure of ['construct','start','stop','event']){
 recordFailure=failure;const handoffs=audioHandoffs;await vm.runInContext('toggleRecording()',context);
 if(failure==='stop')await vm.runInContext('toggleRecording()',context);
 if(failure==='event'){const recorder=sessions.at(-1),error=recorder.onerror,stop=recorder.onstop;error();error();await stop();}
 assert.equal(evaluate('record'),null);assert.equal(evaluate('requestingMic'),false);assert.equal(recordStreams.at(-1).track.stops,1);assert.equal(recordTimers.size,0);assert.equal(audioHandoffs,handoffs);
}
recordFailure='';await vm.runInContext('toggleRecording()',context);
const timedRecorder=sessions.at(-1),timedTick=recordTimers.get(timerId),timedStop=timedRecorder.onstop;
for(let i=0;i<181;i++)timedTick();assert.equal(timedRecorder.stopCalls,1);assert.equal(recordTimers.size,0);await timedStop();assert.equal(timedRecorder.stream.track.stops,1);
vm.runInContext('loadAudio=savedRecordingAudio;delete globalThis.savedRecordingAudio;',context);context.setInterval=oldInterval;context.clearInterval=oldClearInterval;
// Exercise the actual audio metadata handoff with synthetic bytes, never a native decoder.
vm.runInContext('globalThis.savedRecordingMedia={waitForMedia,persistMedia,scheduleSave};globalThis.recordingWrites=0;persistMedia=()=>recordingWrites++;scheduleSave=()=>recordingWrites++;',context);
context.Audio=class {removeAttribute(){}load(){}};
let settleMetadata,rejectMetadata;
context.recordingMetadata=()=>new Promise((resolve,reject)=>{settleMetadata=resolve;rejectMetadata=reject;});
vm.runInContext('waitForMedia=recordingMetadata;',context);
for(const outcome of ['resolve','reject']){
 vm.runInContext("state=initial();state.audioName='original.wav';audioFile={name:'original.wav'};panel='audio';renderPanel();recordingWrites=0;",context);
 await vm.runInContext('toggleRecording()',context);const recorder=sessions.at(-1);
 recorder.ondataavailable({data:new Blob(['synthetic audio'])});await vm.runInContext('toggleRecording()',context);
 const completing=recorder.onstop();assert.equal(evaluate('loadingMedia'),true);
 const before=evaluate('state');element('#removeAudio').onclick();assert.deepEqual(evaluate('state'),before);
 if(outcome==='reject')rejectMetadata(new Error('synthetic decode failure'));else settleMetadata();await completing;
 assert.equal(evaluate('record'),null);assert.equal(evaluate('loadingMedia'),false);
 assert.equal(evaluate('state.audioName'),outcome==='resolve'?'내 목소리.webm':'original.wav');
 assert.equal(evaluate('audioFile.name'),outcome==='resolve'?'내 목소리.webm':'original.wav');
 assert.equal(evaluate('recordingWrites'),outcome==='resolve'?2:0);
 assert.equal(recorder.stream.track.stops,1);
}
vm.runInContext('waitForMedia=savedRecordingMedia.waitForMedia;persistMedia=savedRecordingMedia.persistMedia;scheduleSave=savedRecordingMedia.scheduleSave;delete globalThis.savedRecordingMedia;audioFile=null;if(audioURL)URL.revokeObjectURL(audioURL);audioURL="";audio.removeAttribute("src");state=initial();',context);
// A delayed acquisition cannot attach to a project replaced by undo/import/reset.
context.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>finishPermission=resolve);
const pendingAcquisition=vm.runInContext('toggleRecording()',context),recordersBefore=sessions.length;
await vm.runInContext('loadAudio({});loadVideo({});confirmReset();',context);
assert.equal(evaluate('loadingMedia'),false);vm.runInContext('state=initial();',context);
const lateTrack={stops:0,stop(){this.stops++;}};finishPermission({getTracks:()=>[lateTrack]});await pendingAcquisition;
assert.equal(lateTrack.stops,1);assert.equal(sessions.length,recordersBefore);assert.equal(evaluate('requestingMic'),false);
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
assert.deepEqual(evaluate('[exportCanvas.width,exportCanvas.height]'),[1080,1920]);
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
 assert.equal(evaluate('playing'),true);assert.equal(evaluate('exportRecorder.state'),'recording');
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
 const active=vm.runInContext('exportRecorder',context),before=evaluate('({state,exporting,exportCancelled,playing})'),counts=[recorderStarts,stoppedExportTracks,downloads];
 element('#toast').textContent='current state';
 if(outcome==='reject')fail(new Error('old preparation'));else finish();await old;
 assert.deepEqual(evaluate('({state,exporting,exportCancelled,playing})'),before,`${stage} ${outcome} after cancel/retry`);
 assert.equal(vm.runInContext('exportRecorder',context),active);assert.deepEqual([recorderStarts,stoppedExportTracks,downloads],counts);
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
 assert.equal(evaluate('exporting'),false);assert.equal(evaluate('exportCanvas'),null);assert.match(element('#toast').textContent,/시작하지 못했습니다/);
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
assert.equal(previous.stopCalls,1);assert.equal(stoppedExportTracks,exportStops+2);assert.equal(evaluate('exportRecorder'),null);
assert.equal(previous.onstop,null);await exportStart();const replacement=delayedRecorders.at(-1);
oldCallbacks.data(dataEvent);oldCallbacks.error();oldCallbacks.stop();oldCancel();
assert.equal(vm.runInContext('exportRecorder',context),replacement);assert.equal(replacement.state,'recording');assert.equal(downloads,exportDownloads);assert.equal(stoppedExportTracks,exportStops+2);
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
 if(failure==='error')vm.runInContext('exportRecorder.onerror()',context);
 if(failure==='empty')vm.runInContext('exportRecorder.onstop()',context);
 assert.equal(evaluate('exporting'),false,failure+' releases export');assert.equal(evaluate('exportRecorder'),null);
 assert.equal(stoppedExportTracks,exportStops+2,failure+' releases tracks once');assert.equal(downloads,exportDownloads);
 if(failure==='error')assert.match(element('#toast').textContent,/영상 저장 중 오류/);
}
context.MediaRecorder=immediateRecorder;await exportStart();vm.runInContext('stopExport(true)',context);
console.log('PASS: cancelled audio/font/seek preparation never resumes; stale callbacks preserve replacement exports; final data, cancellation, errors, cleanup once and explicit retry.');
console.log('LIMIT: no actual browser layout, microphone capture, AI inference or encoded MP4/WebM playback was tested.');

vm.runInContext('state=initial();timelineCache=null;selected=0;',context);
await vm.runInContext('importSrt(new Blob(["WEBVTT\\n\\n00:01.000 --> 00:02.500\\nVTT 자막\\n\\n00:03.000 --> 00:04.000\\n둘째 문장"]))',context);
assert.deepEqual(evaluate('state.captions'),[{start:1,end:2.5,text:'VTT 자막'},{start:3,end:4,text:'둘째 문장'}]);
context.lineOriginal=evaluate('[state,history,future]');
for(const text of ['\ufeffWEBVTT\r\r00:00.000 --> 00:01.000\r첫째\r둘째 🌊','WEBVTT\n\n00:00.000 --> 00:01.000\r첫째\r\n둘째 🌊']){
 context.lineFile=new Blob([text]);await vm.runInContext('importSrt(lineFile)',context);
 assert.deepEqual(evaluate('state.captions'),[{start:0,end:1,text:'첫째\n둘째 🌊'}]);
 const exported=await context.window.moment.execute('captions.export');assert.equal(exported.ok,true);
 assert.deepEqual(captionModule.parseSubtitles(exported.data.text,12),evaluate('state.captions'));
 vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),context.lineOriginal[0]);
 vm.runInContext('[state,history,future]=structuredClone(lineOriginal);timelineCache=null;',context);
}
vm.runInContext('state.clips=[{start:0,end:3},{start:5,end:7},{start:9,end:12}];timelineCache=null;selected=1;',context);
element('#moveLeft').onclick();assert.deepEqual(evaluate('state.clips'),[{start:5,end:7},{start:0,end:3},{start:9,end:12}]);
element('#moveRight').onclick();assert.deepEqual(evaluate('state.clips'),[{start:0,end:3},{start:5,end:7},{start:9,end:12}]);
element('#deleteButton').onclick();assert.deepEqual(evaluate('state.clips'),[{start:0,end:3},{start:9,end:12}]);
const beforeBadTrim=evaluate('state.clips');vm.runInContext('trim(-1,2);trim(4,2);trim(0,99);',context);assert.deepEqual(evaluate('state.clips'),beforeBadTrim);
vm.runInContext('trim(9,11);',context);assert.deepEqual(evaluate('state.clips'),[{start:0,end:3},{start:9,end:11}]);
console.log('PASS: VTT parsing, reorder/delete buttons and invalid/valid clip trimming.');

// Regression for the reported obstruction: stock text never paints a central panel.
for(const template of templateModule.TEMPLATES){
 const p=structuredClone(defaults);templateModule.applyTemplate(p,template,true);
 for(const card of p.overlays){
  assert.equal(card.presentation,'plain');assert.equal(card.role,'headline');
  const box=effectsModule.sceneBounds(card,540,960);
  assert.ok(box.y+box.height/2<=960*.3,template.id+' headline stays above the main subject zone');
  assert.ok(box.x-box.width/2>=540*.05);assert.ok(box.x+box.width/2<=540*.89);
 }
 for(const t of [1,5,10]){
  let panels=0;const panelContext=new Proxy({},{get:(_,key)=>key==='roundRect'?()=>panels++:()=>{}});
  effectsModule.drawSceneCards(panelContext,540,960,p,t,12,{label(){}});
  assert.equal(panels,0,template.id+' never defaults to a filled information panel');
 }
}
const legacyCard={...effectsModule.newCard(12),id:'old-question',y:.42,text:'직접 작성한 질문',detail:'사용자 설명'};
for(const key of ['presentation','role','stroke','enabled','backgroundOpacity'])delete legacyCard[key];
const legacyLayout=typographyModule.migrateProject({...structuredClone(defaults),schemaVersion:3,overlays:[legacyCard]},defaults);
assert.equal(legacyLayout.schemaVersion,4);assert.equal(legacyLayout.overlays[0].presentation,'plain');assert.equal(legacyLayout.overlays[0].y,.16);assert.equal(legacyLayout.overlays[0].text,'직접 작성한 질문');assert.equal(legacyLayout.overlays[0].detail,'사용자 설명');
const first=effectsModule.newCard(12),second=effectsModule.newCard(12),layers={overlays:[first,second]};
assert.deepEqual(effectsModule.activeSceneLayers(layers,1),[second],'only one headline occupies the title lane');
second.enabled=false;assert.deepEqual(effectsModule.activeSceneLayers(layers,1),[first]);
first.enabled=false;assert.equal(effectsModule.activeSceneLayers(layers,1).length,0);
let explicitPanels=0;const explicitContext=new Proxy({},{get:(_,key)=>key==='roundRect'?()=>explicitPanels++:()=>{}});
first.enabled=true;first.presentation='panel';effectsModule.drawSceneCards(explicitContext,540,960,{...defaults,overlays:[first]},1,12,{label(){}});assert.equal(explicitPanels,1,'a panel remains available only when explicitly selected');
console.log('PASS: no default opaque boxes, headline safe bounds, saved-project correction, authored text preservation, headline replacement and optional panels.');
vm.runInContext('state=initial();timelineCache=null;applyTemplate(state,TEMPLATES.find(t=>t.id==="explainer"),true);current=1;textLayer="title";switchPanel("text");',context);
const originalTitlePosition=evaluate('[state.design.title.x,state.design.title.y]');
const originalScenePosition=evaluate('[state.overlays[0].x,state.overlays[0].y]');
element('#preview').onpointerdown({clientX:250,clientY:160,pointerId:1});
element('#preview').onpointermove({clientX:260,clientY:180,pointerId:1});
element('#preview').onpointerup();
assert.deepEqual(evaluate('[state.design.title.x,state.design.title.y]'),originalTitlePosition,'dragging a timed headline must not move the hidden base title');
assert.notDeepEqual(evaluate('[state.overlays[0].x,state.overlays[0].y]'),originalScenePosition);
assert.equal(element('#layerSelection').dataset.label,'구간별 타이틀');
console.log('PASS: dragging the visible timed headline edits the correct layer and its selection guide.');

// Preview gestures use actual clamped coordinate changes, not pointer activation, as history boundaries.
const preview=element('#preview'),pointer=(x=250,y=160)=>({clientX:x,clientY:y,pointerId:1});
vm.runInContext('globalThis.originalDragSave=scheduleSave;globalThis.dragSaves=0;scheduleSave=()=>dragSaves++;',context);
for(const mode of ['video','title','credit','caption','scene']){
 const setup=mode==='video'?"panel='settings'":mode==='scene'?"panel='effects';effectTab='cards';state.overlays=[newCard(12)];selectedCard=state.overlays[0].id":"panel='text';textLayer="+JSON.stringify(mode);
 const target=mode==='scene'?'state.overlays[0]':mode==='title'||mode==='credit'?'state.design.'+mode:'state';
 const xKey=mode==='video'?'panX':mode==='caption'?'captionX':'x',yKey=mode==='video'?'panY':mode==='caption'?'captionY':'y';
 const seed=(x=.5,y=.5)=>vm.runInContext(`state=initial();current=1;selectedCard=null;history=[];future=[];${setup};${target}.${xKey}=${x};${target}.${yKey}=${y};edit(()=>state.zoom=1.5);undo();dragSaves=0;`,context);
 const position=()=>evaluate(`[${target}.${xKey},${target}.${yKey}]`);
 for(const end of ['onpointerup','onpointercancel']){
  seed();const before=evaluate('({state,history,future})');
  preview.onpointerdown(pointer());preview[end]();
  assert.deepEqual(evaluate('({state,history,future})'),before,mode+' no-motion '+end+' preserves redo');
  assert.equal(evaluate('dragSaves'),0);
  seed();preview.onpointerdown(pointer());preview.onpointermove(pointer());preview[end]();
  assert.equal(evaluate('future.length'),1,mode+' same coordinates preserve redo');assert.equal(evaluate('dragSaves'),0);
  const xmax=mode==='video'?1:.9,ymax=mode==='video'?1:mode==='scene'?.8:mode==='caption'?.9:.93;
  seed(xmax,ymax);preview.onpointerdown(pointer());preview.onpointermove(pointer(350,260));preview[end]();
  assert.deepEqual(position(),[xmax,ymax]);assert.equal(evaluate('history.length'),0);assert.equal(evaluate('future.length'),1);assert.equal(evaluate('dragSaves'),0);
  const xmin=mode==='video'?-1:.1,ymin=mode==='video'?-1:mode==='scene'?.08:mode==='caption'?.1:.06;
  seed(xmin,ymin);preview.onpointerdown(pointer());preview.onpointermove(pointer(150,60));preview[end]();
  assert.deepEqual(position(),[xmin,ymin]);assert.equal(evaluate('history.length'),0);assert.equal(evaluate('future.length'),1);assert.equal(evaluate('dragSaves'),0);
  seed();const original=evaluate('state');preview.onpointerdown(pointer());
  preview.onpointermove(pointer(260,180));preview.onpointermove(pointer(270,200));
  assert.equal(evaluate('history.length'),1,mode+' coalesces real moves');assert.equal(evaluate('future.length'),0);
  const moved=evaluate('state');assert.notDeepEqual(moved,original);preview[end]();
  assert.deepEqual(position(),[.5+20/540,.5+40/960],mode+' retains existing coordinate conversion');
  assert.equal(evaluate('dragSaves'),1,mode+' saves one changed gesture');
  preview.onpointermove(pointer(300,300));preview[end]();assert.deepEqual(evaluate('state'),moved);assert.equal(evaluate('dragSaves'),1);
  vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),original);
  vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),moved);
  preview.onpointerdown(pointer());preview.onpointermove(pointer(280,210));preview[end]();
  assert.equal(evaluate('history.length'),2,mode+' starts a new undo group for the next gesture');
  vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),moved);
 }
}
for(const layer of ['title','credit']){
 vm.runInContext(`state=initial();panel='text';textLayer='${layer}';state.design.${layer}.enabled=false;history=[];future=['retained'];dragSaves=0;`,context);
 const before=evaluate('state');preview.onpointerdown(pointer());preview.onpointermove(pointer(300,300));preview.onpointerup();
 assert.deepEqual(evaluate('state'),before);assert.deepEqual(evaluate('future'),['retained']);assert.equal(evaluate('history.length'),0);assert.equal(evaluate('dragSaves'),0);
}
for(const moved of [false,true]){
 vm.runInContext("state=initial();panel='settings';history=[];future=[];dragSaves=0;",context);
 preview.onpointerdown(pointer());if(moved)preview.onpointermove(pointer(270,200));
 vm.runInContext(moved?'undo()':'state=initial();state.zoom=2;',context);
 const replacement=evaluate('({state,history,future,dragSaves})');
 preview.onpointermove(pointer(300,300));preview.onpointerup();
 assert.deepEqual(evaluate('({state,history,future,dragSaves})'),replacement,'A stale gesture cannot mutate a replaced/undone project');
}
for(const flag of ["exporting=true","restorePhase='restoring'"]){
 vm.runInContext(`state=initial();panel='settings';history=[];future=['retained'];dragSaves=0;${flag};`,context);
 const before=evaluate('({state,history,future})');preview.onpointerdown(pointer());preview.onpointermove(pointer(300,300));preview.onpointercancel();
 assert.deepEqual(evaluate('({state,history,future})'),before);assert.equal(evaluate('dragSaves'),0);
 vm.runInContext("exporting=false;restorePhase='ready';",context);
}
vm.runInContext('scheduleSave=originalDragSave;delete globalThis.originalDragSave;delete globalThis.dragSaves;state=initial();history=[];future=[];',context);
console.log('PASS: preview no-op/cancel/boundary gestures preserve redo, actual drags group history, all layer targets undo/redo.');

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

// A 60 Hz display must not turn a 30 fps target into ~20 fps through rounding drift.
vm.runInContext('globalThis.savedDraw=draw;globalThis.frameCount=0;draw=()=>frameCount++;state=initial();timelineCache=null;current=0;lastTick=0;lastDrawTime=-Infinity;playing=true;',context);
for(let i=1;i<=120;i++)vm.runInContext(`tick(${i*1000/60})`,context);
const cadenceFrames=evaluate('frameCount');
vm.runInContext('draw=savedDraw;pause();',context);
assert.ok(cadenceFrames>=59&&cadenceFrames<=61,`30 fps target over 2 seconds: got ${cadenceFrames}`);
console.log('PASS: frame cadence preserves elapsed time at 60 Hz.');

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
 r.run('templateProject(savedTemplates[0])'); // exercises the same preview preparation, without a canvas/browser
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
