import * as captionModule from './dist/captions.mjs';
import * as effectsModule from './dist/effects.mjs';
import * as templateModule from './dist/template-catalog.mjs';
import * as typographyModule from './dist/typography.mjs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

import { createAppFixture } from './tests/fixtures/app.mjs';

const fixture = await createAppFixture();
const { context, evaluate, element, doc, context2d } = fixture;
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
const renderer=typographyModule.createTypographyRenderer(()=>doc.createElement('canvas'));
renderer.draw(context2d,540,960,defaults,1,1,defaults.captions[0]);
const measuredOnce=fixture.measurementCalls;
for(let i=0;i<100;i++)renderer.draw(context2d,540,960,defaults,1,1,defaults.captions[0]);
assert.equal(fixture.measurementCalls,measuredOnce,'Repeated frames must not remeasure identical text');
for(let i=0;i<80;i++)renderer.draw(context2d,540,960,defaults,1,1,{start:0,end:4,text:'서로 다른 자막 '+i});
assert.ok(renderer.cacheInfo().entries<=48);
assert.ok(renderer.cacheInfo().pixels<=8_000_000);
renderer.clear();assert.equal(renderer.cacheInfo().entries,0);

console.log('PASS: legacy migration, title timing, presets, bounded typography cache and idle scheduler.');
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
  vm.runInContext(`composition.draw(ctx,${width},${height},${frameProject},{source:sample,sw:540,sh:960,ready:true,sourceTime:${12*fraction},time:${12*fraction},total:12,elapsed:${12*fraction},remaining:${12*(1-fraction)},progress:${fraction}})`,context);
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
element('#preview').onpointerdown({clientX:250,clientY:160,pointerId:1,button:0});
element('#preview').onpointermove({clientX:260,clientY:180,pointerId:1});
element('#preview').onpointerup({pointerId:1});
assert.deepEqual(evaluate('[state.design.title.x,state.design.title.y]'),originalTitlePosition,'dragging a timed headline must not move the hidden base title');
assert.notDeepEqual(evaluate('[state.overlays[0].x,state.overlays[0].y]'),originalScenePosition);
assert.equal(element('#layerSelection').dataset.label,'구간별 타이틀');
console.log('PASS: dragging the visible timed headline edits the correct layer and its selection guide.');

// Preview gestures use actual clamped coordinate changes, not pointer activation, as history boundaries.
const preview=element('#preview'),pointer=(x=250,y=160)=>({clientX:x,clientY:y,pointerId:1,button:0});
vm.runInContext('globalThis.originalDragSave=scheduleSave;globalThis.dragSaves=0;scheduleSave=()=>dragSaves++;',context);
for(const mode of ['video','title','credit','caption','scene']){
 const setup=mode==='video'?"panel='settings'":mode==='scene'?"panel='effects';effectTab='cards';state.overlays=[newCard(12)];selectedCard=state.overlays[0].id":"panel='text';textLayer="+JSON.stringify(mode);
 const target=mode==='scene'?'state.overlays[0]':mode==='title'||mode==='credit'?'state.design.'+mode:'state';
 const xKey=mode==='video'?'panX':mode==='caption'?'captionX':'x',yKey=mode==='video'?'panY':mode==='caption'?'captionY':'y';
 const seed=(x=.5,y=.5)=>vm.runInContext(`state=initial();current=1;selectedCard=null;history=[];future=[];${setup};${target}.${xKey}=${x};${target}.${yKey}=${y};edit(()=>state.zoom=1.5);undo();dragSaves=0;`,context);
 const position=()=>evaluate(`[${target}.${xKey},${target}.${yKey}]`);
 for(const end of ['onpointerup','onpointercancel']){
  seed();const before=evaluate('({state,history,future})');
  preview.onpointerdown(pointer());preview[end](pointer());
  assert.deepEqual(evaluate('({state,history,future})'),before,mode+' no-motion '+end+' preserves redo');
  assert.equal(evaluate('dragSaves'),0);
  seed();preview.onpointerdown(pointer());preview.onpointermove(pointer());preview[end](pointer());
  assert.equal(evaluate('future.length'),1,mode+' same coordinates preserve redo');assert.equal(evaluate('dragSaves'),0);
  const xmax=mode==='video'?1:.9,ymax=mode==='video'?1:mode==='scene'?.8:mode==='caption'?.9:.93;
  seed(xmax,ymax);preview.onpointerdown(pointer());preview.onpointermove(pointer(350,260));preview[end](pointer());
  assert.deepEqual(position(),[xmax,ymax]);assert.equal(evaluate('history.length'),0);assert.equal(evaluate('future.length'),1);assert.equal(evaluate('dragSaves'),0);
  const xmin=mode==='video'?-1:.1,ymin=mode==='video'?-1:mode==='scene'?.08:mode==='caption'?.1:.06;
  seed(xmin,ymin);preview.onpointerdown(pointer());preview.onpointermove(pointer(150,60));preview[end](pointer());
  assert.deepEqual(position(),[xmin,ymin]);assert.equal(evaluate('history.length'),0);assert.equal(evaluate('future.length'),1);assert.equal(evaluate('dragSaves'),0);
  seed();const original=evaluate('state');preview.onpointerdown(pointer());
  preview.onpointermove(pointer(260,180));preview.onpointermove(pointer(270,200));
  assert.equal(evaluate('history.length'),1,mode+' coalesces real moves');assert.equal(evaluate('future.length'),0);
  const moved=evaluate('state');assert.notDeepEqual(moved,original);preview[end](pointer());
  const region=mode==='video'?typographyModule.videoFrame(original.design,540,960):{w:540,h:960};
  assert.deepEqual(position(),[.5+20/region.w,.5+40/region.h],mode+' uses its rendered coordinate region');
  assert.equal(evaluate('dragSaves'),1,mode+' saves one changed gesture');
  preview.onpointermove(pointer(300,300));preview[end](pointer());assert.deepEqual(evaluate('state'),moved);assert.equal(evaluate('dragSaves'),1);
  vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),original);
  vm.runInContext('undo(true)',context);assert.deepEqual(evaluate('state'),moved);
  preview.onpointerdown(pointer());preview.onpointermove(pointer(280,210));preview[end](pointer());
  assert.equal(evaluate('history.length'),2,mode+' starts a new undo group for the next gesture');
  vm.runInContext('undo()',context);assert.deepEqual(evaluate('state'),moved);
 }
}
for(const layer of ['title','credit']){
 vm.runInContext(`state=initial();panel='text';textLayer='${layer}';state.design.${layer}.enabled=false;history=[];future=['retained'];dragSaves=0;`,context);
 const before=evaluate('state');preview.onpointerdown(pointer());preview.onpointermove(pointer(300,300));preview.onpointerup(pointer());
 assert.deepEqual(evaluate('state'),before);assert.deepEqual(evaluate('future'),['retained']);assert.equal(evaluate('history.length'),0);assert.equal(evaluate('dragSaves'),0);
}
for(const moved of [false,true]){
 vm.runInContext("state=initial();panel='settings';history=[];future=[];dragSaves=0;",context);
 preview.onpointerdown(pointer());if(moved)preview.onpointermove(pointer(270,200));
 vm.runInContext(moved?'undo()':'state=initial();state.zoom=2;',context);
 const replacement=evaluate('({state,history,future,dragSaves})');
 preview.onpointermove(pointer(300,300));preview.onpointerup(pointer());
 assert.deepEqual(evaluate('({state,history,future,dragSaves})'),replacement,'A stale gesture cannot mutate a replaced/undone project');
}
for(const flag of ["exporting=true","persistence.restorePhase='restoring'"]){
 vm.runInContext(`state=initial();panel='settings';history=[];future=['retained'];dragSaves=0;${flag};`,context);
 const before=evaluate('({state,history,future})');preview.onpointerdown(pointer());preview.onpointermove(pointer(300,300));preview.onpointercancel(pointer());
 assert.deepEqual(evaluate('({state,history,future})'),before);assert.equal(evaluate('dragSaves'),0);
 vm.runInContext("exporting=false;persistence.restorePhase='ready';",context);
}
vm.runInContext('scheduleSave=originalDragSave;delete globalThis.originalDragSave;delete globalThis.dragSaves;state=initial();history=[];future=[];',context);
console.log('PASS: preview no-op/cancel/boundary gestures preserve redo, actual drags group history, all layer targets undo/redo.');
