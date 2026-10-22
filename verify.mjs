import * as projectModule from './dist/core/project.mjs';
import { prepareCommand } from './dist/core/commands.mjs';
import { CommandError } from './dist/core/validation.mjs';
import { createEditorService } from './dist/integration/editor-service.mjs';
import * as captionModule from './dist/captions.mjs';
import * as effectsModule from './dist/effects.mjs';
import * as templateModule from './dist/template-catalog.mjs';
import { mountTemplateGallery } from './dist/template-gallery.mjs';
import { mountEffectsPanel } from './dist/effects-panel.mjs';
import * as typographyModule from './dist/typography.mjs';
import { createProjectStore } from './dist/project-store.mjs';
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

const elements=new Map();
let measurementCalls=0;
const context2d=new Proxy({}, {get:(target,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):key==='measureText'?text=>{measurementCalls++;return {width:text.length*10};}:()=>{}});
function element(key=''){
 if(elements.has(key))return elements.get(key);
 const e={value:'',innerHTML:'',textContent:'',hidden:false,style:{},dataset:{},clientWidth:700,clientHeight:500,width:540,height:960,currentTime:0,duration:12,readyState:4,videoWidth:1920,videoHeight:1080,
 classList:{add(){},remove(){},toggle(){}},setAttribute(){},setPointerCapture(){},removeAttribute(){},addEventListener(){},removeEventListener(){},insertAdjacentHTML(){},getContext(){return context2d;},querySelector(selector){return selector==='.icon'?null:element(key+' '+selector);},querySelectorAll(){return [];},focus(){doc.activeElement=this;},pause(){},play(){return Promise.resolve();},getBoundingClientRect(){return {left:0,top:0,width:540,height:960};},showModal(){this.open=true;},close(){this.open=false;}};
 elements.set(key,e);return e;
}
let canvasCount=0,rafCounter=0;const pendingFrames=new Map();
const documentEvents=new Map();
const doc={querySelector:element,querySelectorAll:()=>[],addEventListener(name,handler){documentEvents.set(name,handler);},body:element('body'),fonts:{ready:Promise.resolve()},createElement:()=>element('canvas-'+(++canvasCount))};
const context=vm.createContext({document:doc,window:{addEventListener(){}},Image:class{complete=false;},localStorage:{getItem:()=>null,setItem(){}},requestAnimationFrame(callback){pendingFrames.set(++rafCounter,callback);return rafCounter;},cancelAnimationFrame(id){pendingFrames.delete(id);},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},console,URL,Blob,performance,Number,Math,Promise,structuredClone,...projectModule,prepareCommand,CommandError,createEditorService,...captionModule,...effectsModule,...templateModule,mountTemplateGallery,mountEffectsPanel,...typographyModule,createProjectStore,mountDesignPanel});
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
await vm.runInContext('importSrt({text:async()=>"1\\n00:00:01,250 --> 00:00:03,500\\n테스트 자막\\n\\n2\\n00:00:10,000 --> 00:00:14,000\\n끝 자막"})',context);
assert.deepEqual(evaluate('state.captions'),[{start:1.25,end:3.5,text:'테스트 자막'},{start:10,end:12,text:'끝 자막'}]);
vm.runInContext('state=initial();timelineCache=null;current=5;split();',context);
assert.deepEqual(evaluate('state.clips'),[{start:0,end:5},{start:5,end:12}]);
vm.runInContext('undo();',context);
assert.deepEqual(evaluate('state.clips'),[{start:0,end:12}]);
console.log('PASS: DOM IDs, all panel initializations, trim mapping, split/undo, caption clipping, speed-adjusted SRT, SRT parsing.');

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
function clickCaptionBlock(index){
 const blocks=[...element('#captionTrack').innerHTML.matchAll(/data-caption-index="(\d+)" data-caption-time="([\d.]+)"/g)];
 const block=blocks[index];assert.ok(block,'Expected a rendered caption occurrence');
 element('#captionTrack').onclick({target:{closest:()=>({dataset:{captionIndex:block[1],captionTime:block[2]}})}});
 return +block[1];
}
assert.equal(clickCaptionBlock(3),1);
assert.equal(evaluate('current'),8,'Repeated source caption seeks to its clicked edited occurrence before speed');
assert.equal(doc.activeElement,element('[data-caption-text="1"]'));
assert.match(element('#captionTrack').innerHTML,/aria-label="자막 2, 4.0초: same"/);
assert.equal(clickCaptionBlock(2),0);assert.equal(evaluate('current'),4,'Trimmed caption seeks to its visible start');
assert.equal(clickCaptionBlock(0),2);assert.equal(evaluate('current'),0,'Narration uses the edited clock');
assert.equal(doc.activeElement,element('[data-caption-text="2"]'));
assert.deepEqual(evaluate('state'),navigationState);assert.equal(evaluate('history.length'),navigationHistory);
vm.runInContext("edit(()=>state.captions.splice(0,1),true)",context);
assert.equal(clickCaptionBlock(2),0,'Deletion rebuilds references to the surviving row');
assert.equal(doc.activeElement,element('[data-caption-text="0"]'));
vm.runInContext('undo()',context);assert.equal(clickCaptionBlock(3),1,'Undo restores row mapping');
vm.runInContext("switchPanel('audio');record={state:'recording'};current=3",context);
clickCaptionBlock(3);assert.equal(evaluate('current'),3);assert.equal(evaluate('panel'),'audio');
vm.runInContext('record=null;exporting=true',context);clickCaptionBlock(3);assert.equal(evaluate('current'),3);
vm.runInContext('exporting=false',context);
let preventedCaption=false;
documentEvents.get('keydown')({target:{tagName:'BUTTON',matches:s=>s==='[data-caption-index]'},code:'Space',key:' ',preventDefault(){preventedCaption=true;}});
assert.equal(preventedCaption,false,'Space on a caption must use native button activation');
assert.equal(evaluate('playing'),false);
vm.runInContext('state=initial();timelineCache=null;current=0;changed()',context);
console.log('PASS: caption occurrence navigation, duplicate text, trim/repeat/narration/speed, deletion/undo, focus and busy guards.');


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
assert.equal(doc.activeElement,element('[data-caption-text="0"]'));
assert.equal(createIsOpen(),false);
const captionDelete={dataset:{deleteCaption:'0'}};
doc.querySelectorAll=selector=>selector==='[data-delete-caption]'?[captionDelete]:[];
vm.runInContext('renderPanel()',context);captionDelete.onclick();
doc.querySelectorAll=()=>[];
assert.equal(evaluate('state.captions.length'),0);assert.equal(createIsOpen(),true);
assert.equal(doc.activeElement,element('#addCaption'));
await vm.runInContext('importSrt({size:50,text:async()=>"1\\n00:00:00,000 --> 00:00:02,000\\nImported caption"})',context);
assert.equal(evaluate('state.captions[0].text'),'Imported caption');assert.equal(createIsOpen(),false);
assert.equal(doc.activeElement,element('[data-caption-text="0"]'));
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

// Panel controls are exercised with supplied DOM controls (not a browser layout test).
function control(type,dataset,value){return {type,dataset,value,checked:false,setCustomValidity(message){this.error=message;},reportValidity(){this.reported=true;}};}
function panelRoot(lists={},byId={}){return {innerHTML:'',querySelectorAll(selector){return lists[selector]||[];},querySelector(selector){return byId[selector]||null;}};}
const inputs=[control('number',{design:'design.title.start'},'5'),control('number',{design:'design.title.end'},'3'),control('text',{design:'speakerLabels.1'},'인터뷰이'),control('text',{design:'globalKeywords'},'순간, C++')];
let panelProject=structuredClone(defaults),snapshots=0;
mountDesignPanel(panelRoot({'[data-design]':inputs}),{state:panelProject,layer:'caption',total:12,snapshot(){snapshots++;},update(fn){fn(panelProject);}});
inputs[0].onchange();assert.equal(panelProject.design.title.start,5);
inputs[1].onchange();assert.equal(panelProject.design.title.end,null);assert.ok(inputs[1].error);
inputs[1].value='9';inputs[1].onchange();assert.equal(panelProject.design.title.end,9);assert.equal(inputs[1].error,'');
inputs[2].onfocus();inputs[2].oninput();assert.equal(panelProject.speakerLabels[1],'인터뷰이');
inputs[3].oninput();assert.equal(panelProject.globalKeywords,'순간, C++');
const testCard=effectsModule.newCard(12,2);panelProject.overlays=[testCard];
const cardInputs=[control('number',{card:'start'},'8'),control('number',{card:'end'},'9'),control('text',{card:'text'},'수정한 카드')];
const buttons=Object.fromEntries(['#addSceneCard','#toggleSceneLayers','#removeSceneCard','#duplicateSceneCard','#previewSceneCard'].map(id=>[id,{}]));
const cardRoot=panelRoot({'[data-card]':cardInputs},buttons);
mountEffectsPanel(panelRoot({}, {'#effectControls':cardRoot}),{state:panelProject,total:12,tab:'cards',selected:testCard.id,snapshot(){snapshots++;},update(fn){fn(panelProject);},add(){},remove(){},duplicate(){},play(){}});
cardInputs[0].onchange();assert.equal(testCard.start,2);assert.ok(cardInputs[0].error);
cardInputs[1].onchange();cardInputs[0].onchange();assert.equal(testCard.start,8);assert.equal(testCard.end,9);
cardInputs[2].oninput();assert.equal(testCard.text,'수정한 카드');
const fxInputs=[control('range',{effect:'brightness'},'1.25'),control('select-one',{effect:'motion'},'out'),control('checkbox',{effect:'progress'},'')];fxInputs[2].checked=true;
mountEffectsPanel(panelRoot({}, {'#effectControls':panelRoot({'[data-effect]':fxInputs},{'#resetEffects':{}})}),{state:panelProject,total:12,tab:'motion',snapshot(){snapshots++;},update(fn){fn(panelProject);},reset(){}});
fxInputs[0].onfocus();fxInputs[0].oninput();fxInputs[1].onchange();fxInputs[2].onchange();
assert.equal(panelProject.effects.brightness,1.25);assert.equal(panelProject.effects.motion,'out');assert.equal(panelProject.effects.progress,true);
console.log('PASS: actual panel event handlers, invalid timing rejection and correction, speaker/global keyword edits and motion/color controls.');

// Gallery search, favorite filtering, custom filtering and HTML escaping.
const search={},grid={innerHTML:''},count={},saveButton={};
const galleryRoot=panelRoot({}, {'#templateSearch':search,'#templateGrid':grid,'#templateCount':count,'#saveMyTemplate':saveButton});
const galleryState={query:'',category:'전체'},galleryApi={ui:galleryState,custom:[],favorites:['recipe'],active:'reference',save(){}};
mountTemplateGallery(galleryRoot,galleryApi);assert.equal(count.textContent,'10개의 구성');
search.oninput({target:{value:' 요리 '}});assert.ok(grid.innerHTML.includes('한눈에 보는 레시피'));
search.oninput({target:{value:'인터뷰'}});assert.ok(grid.innerHTML.includes('인터뷰 하이라이트'));assert.ok(!grid.innerHTML.includes('시네마틱 모먼트'));
galleryState.query='';galleryState.category='즐겨찾기';mountTemplateGallery(galleryRoot,galleryApi);assert.equal(count.textContent,'1개의 구성');assert.ok(grid.innerHTML.includes('한눈에 보는 레시피'));
galleryState.category='내 템플릿';galleryApi.custom=[{...custom,name:'<img src=x onerror=alert(1)>'}];mountTemplateGallery(galleryRoot,galleryApi);assert.ok(grid.innerHTML.includes('&lt;img'));assert.ok(!grid.innerHTML.includes('<img'));
console.log('PASS: template search, category/favorite/custom filters and user-entered HTML escaping.');

// Storage retry after a denied connection must not discard subsequent retries.
let retryAttempts=0;
const retryStore=createProjectStore({open(){const request={};retryAttempts++;queueMicrotask(()=>{if(retryAttempts===1){request.error=new Error('denied');request.onerror();}else{request.result=db;request.onsuccess();}});return request;}});
await assert.rejects(retryStore.setMedia(v,a),/denied/);await retryStore.setMedia(v,a);assert.equal(retryAttempts,2);
let syncAttempts=0;
const syncStore=createProjectStore({open(){syncAttempts++;if(syncAttempts===1)throw new Error('temporary');const request={};queueMicrotask(()=>{request.result=db;request.onsuccess();});return request;}});
await assert.rejects(syncStore.setMedia(v,a),/temporary/);await syncStore.setMedia(v,a);assert.equal(syncAttempts,2);
console.log('PASS: asynchronous and synchronous storage failures can be retried.');

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
console.log('LIMIT: no actual browser layout, microphone capture, AI inference or encoded MP4/WebM playback was tested.');

vm.runInContext('state=initial();timelineCache=null;selected=0;',context);
await vm.runInContext('importSrt({text:async()=>"WEBVTT\\n\\n00:01.000 --> 00:02.500\\nVTT 자막\\n\\n00:03.000 --> 00:04.000\\n둘째 문장"})',context);
assert.deepEqual(evaluate('state.captions'),[{start:1,end:2.5,text:'VTT 자막'},{start:3,end:4,text:'둘째 문장'}]);
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

// Subtitle import failures must preserve the project and reset the file picker.
vm.runInContext('state=initial();timelineCache=null;',context);
const subtitleOriginal=evaluate('state');
let readOversized=false;
context.largeSubtitle={size:captionModule.MAX_SUBTITLE_BYTES+1,text:async()=>{readOversized=true;return '';}};
await vm.runInContext('importSrt(largeSubtitle)',context);
assert.equal(readOversized,false,'oversized subtitles are rejected before reading');
assert.deepEqual(evaluate('state'),subtitleOriginal);
context.failedSubtitle={text:async()=>{throw new Error('read failed');}};
await vm.runInContext('importSrt(failedSubtitle)',context);
assert.deepEqual(evaluate('state'),subtitleOriginal);
vm.runInContext('exporting=true;',context);
await vm.runInContext('importSrt({text:async()=>"00:01.000 --> 00:02.000\\nMust not replace during export"})',context);
assert.deepEqual(evaluate('state'),subtitleOriginal);
vm.runInContext('exporting=false;',context);
await vm.runInContext('importSrt({text:async()=>"00:01.000 --> 00:02.000\\nSafe replacement"})',context);
assert.equal(evaluate('state.captions[0].text'),'Safe replacement');
vm.runInContext('undo();',context);
assert.deepEqual(evaluate('state'),subtitleOriginal);
assert.equal(element('#srtInput').value,'');
console.log('PASS: bounded subtitle imports, read failure recovery, export guard and undo.');

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
assert.match(element('#saveStatus').innerHTML,/불러오지 못함/);
context.localStorage.getItem=originalGetItem;
console.log('PASS: corrupt browser storage is rejected before rendering.');
