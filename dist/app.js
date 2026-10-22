import { createDemoProject, createProjectDocument, srtTimestamp, projectSrt, readProjectDocument } from './core/project.mjs';
import { prepareCommand } from './core/commands.mjs';
import { CommandError } from './core/validation.mjs';
import { createEditorService } from './integration/editor-service.mjs';
import { captionClock, findCaption, editedCaptions, mapAudioCaptions, parseSubtitles, MAX_SUBTITLE_BYTES } from './captions.mjs';
import { defaultEnhancements, clipEffects, newCard, drawSceneCards, splitCaptionText, retimeOutputLayers, activeSceneLayers, sceneBounds } from './effects.mjs';
import { TEMPLATES, REFERENCE_SOURCES, applyTemplate, visualPreset, saveCustomTemplate } from './template-catalog.mjs';
import { mountTemplateGallery } from './template-gallery.mjs';
import { mountEffectsPanel } from './effects-panel.mjs';
import { defaultDesign, migrateProject, applyDesignPreset, videoFrame, createTypographyRenderer } from './typography.mjs';
import { createProjectStore } from './project-store.mjs';
import { mountDesignPanel } from './design-panel.mjs';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const paths = {
 grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',media:'M3 5h18v14H3zM8 5v14M3 10h5M3 15h5M12 9l5 3-5 3z', video:'M3 6h13v12H3zM16 10l5-3v10l-5-3', captions:'M3 5h18v14H3zM6 10h4M6 14h4M14 10h4M14 14h4', audio:'M9 18V5l11-2v13M9 8l11-2M9 18c0 4-6 4-6 1s6-4 6-1M20 16c0 4-6 4-6 1s6-4 6-1', text:'M4 5h16M12 5v15M8 20h8', sliders:'M4 7h6M14 7h6M4 17h10M18 17h2M10 4v6M14 14v6', plus:'M12 5v14M5 12h14', upload:'M12 16V3M7 8l5-5 5 5M4 15v5h16v-5', export:'M12 15V3M8 7l4-4 4 4M4 13v7h16v-7', save:'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8', help:'M9 8a3 3 0 1 1 5 3c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', shield:'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6', portrait:'M6 2h12v20H6z', chevron:'M7 10l5 5 5-5', safe:'M8 3H3v5M16 3h5v5M3 16v5h5M16 21h5v-5M7 7h10v10H7z', play:'M8 5l11 7-11 7z', pause:'M8 5v14M16 5v14', skip:'M6 5v14M18 5L8 12l10 7z', volume:'M3 9h4l5-5v16l-5-5H3zM16 8q5 4 0 8M19 5q7 7 0 14', mute:'M3 9h4l5-5v16l-5-5H3zM16 9l6 6M22 9l-6 6', undo:'M9 4L4 9l5 5M4 9h10a6 6 0 0 1 0 12', redo:'M15 4l5 5-5 5M20 9H10a6 6 0 0 0 0 12', scissors:'M14 14l7 7M14 10l7-7M6 9l9 6M6 15l9-6M8 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0', trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', left:'M15 5l-7 7 7 7', right:'M9 5l7 7-7 7', sparkle:'M12 3l3 6 6 3-6 3-3 6-3-6-6-3 6-3zM20 2v4M18 4h4', mic:'M8 5a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8', close:'M6 6l12 12M18 6L6 18', check:'M5 12l4 4L19 6', download:'M12 3v13M7 11l5 5 5-5M4 17v4h16v-4', reset:'M4 10a8 8 0 1 1 2 8M4 4v6h6', folder:'M3 5h7l2 3h9v12H3z'
};
function icon(name){return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.plus}"/></svg>`;}
function icons(root=document){$$('[data-icon]',root).forEach(el=>{if(!el.querySelector('.icon'))el.insertAdjacentHTML('afterbegin',icon(el.dataset.icon));});}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function fmt(t){t=Math.max(0,Number(t)||0);return `${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;}
function initial(){return createDemoProject();}
let state=initial(), current=0, selected=0, playing=false, panel='templates', textLayer='title', videoFile=null, audioFile=null, sourceURL='', audioURL='', thumbnail='', history=[], future=[], exporting=false, muted=false, record=null, recognitionWorker=null, pendingTranscriptionReject=null, transcriptionCancelled=false, transcribing=false, saveTimer, recordTimer, pendingSave=Promise.resolve();
const video=$('#sourceVideo'), audio=$('#sourceAudio'), canvas=$('#preview'), ctx=canvas.getContext('2d'), sample=new Image(), modal=$('#modal');
let audioCtx, videoNode, audioNode, videoGain, audioGain, destination, exportRecorder, exportStream, exportCanvas, exportContext, exportChunks=[], exportCancelled=false, lastTick=0;
let sampleRaster=null,lastSaveStatus='',effectTab='cards',selectedCard=null,templatePreviewFrame=0,cardPlaybackEnd=null,requestingMic=false;
const galleryUI={query:'',category:'전체'};
let savedTemplates=[],favoriteTemplates=[];
try{savedTemplates=JSON.parse(localStorage.getItem('moment-templates-v1')||'[]');favoriteTemplates=JSON.parse(localStorage.getItem('moment-favorites-v1')||'[]');if(!Array.isArray(savedTemplates))savedTemplates=[];if(!Array.isArray(favoriteTemplates))favoriteTemplates=[];}catch{}
const typography=createTypographyRenderer(()=>document.createElement('canvas'));
const projectStore=createProjectStore();
let timelineCache=null,frameHandle=0,paintHandle=0,lastUiTime=0,lastTimeLabel='',lastDrawTime=-Infinity,playRequest=0,loadingMedia=false;
sample.onload=()=>{sampleRaster=document.createElement('canvas');sampleRaster.width=540;sampleRaster.height=960;sampleRaster.getContext('2d').drawImage(sample,0,0,540,960);requestDraw();if(panel==='templates')renderPanel();}; sample.src='./sample.svg';
function timelineIndex(){
 if(timelineCache?.clips===state.clips)return timelineCache;
 let total=0;
 const entries=state.clips.map((clip,index)=>{const entry={clip,index,offset:total};total+=clip.end-clip.start;return entry;});
 return timelineCache={clips:state.clips,entries,total};
}
const duration=()=>timelineIndex().total;
function locate(t){
 const {entries}=timelineIndex();let low=0,high=entries.length-1;
 while(low<high){const middle=(low+high)>>1,e=entries[middle];if(t<e.offset+e.clip.end-e.clip.start)high=middle;else low=middle+1;}
 const e=entries[low];return {index:e.index,source:e.clip.start+clamp(t-e.offset,0,e.clip.end-e.clip.start),offset:e.offset};
}
function snapshot(){history.push(JSON.stringify(state));if(history.length>40)history.shift();future=[];}
function changed(){timelineCache=null;renderTimeline();renderInspector();updateLayerGuide();requestDraw();scheduleSave();}
function edit(fn,refresh=false){if(exporting)return;const previousDuration=duration()/state.speed;snapshot();fn();timelineCache=null;retimeOutputLayers(state,previousDuration,duration()/state.speed);current=clamp(current,0,duration());changed();if(refresh)renderPanel();}
let editorReady=false,resolveEditorReady;
const editorReadyPromise=new Promise(resolve=>{resolveEditorReady=resolve;});
function commitCommandProject(next,{command}={}){
 if(!editorReady||exporting||loadingMedia||transcribing||requestingMic||record?.state==='recording')throw new CommandError('BUSY','진행 중인 로드·녹음·인식·내보내기를 먼저 완료하세요.');
 if(command==='project.import'&&(next.kind!==state.kind||(next.kind==='video'&&(next.fileName!==state.fileName||Math.abs(next.duration-state.duration)>.05))||next.audioName!==state.audioName))throw new CommandError('MEDIA_RELINK_REQUIRED','설정에 사용된 원본 영상과 오디오를 먼저 같은 이름으로 연결하세요.');
 pause();snapshot();state=next;timelineCache=null;selected=clamp(selected,0,state.clips.length-1);current=clamp(current,0,duration());changed();renderPanel();resizePreview();seekTo(current);
}
function runEditorCommand(name,args){
 try{const result=prepareCommand(state,name,args);if(result.project)commitCommandProject(result.project,{command:name});return true;}
 catch(error){toast(error.message||'변경을 적용하지 못했습니다.');return false;}
}
const editorService=createEditorService({
 getProject(){if(!editorReady)throw new CommandError('BUSY','편집기를 불러오는 중입니다.');return structuredClone(state);},
 commitProject:commitCommandProject,
});
async function importProjectSettings(file){
 try{
  if(file.size>10*1024*1024)throw new Error('편집 설정 JSON은 10 MB 이하만 불러올 수 있습니다.');
  const result=await editorService.execute('project.import',{document:JSON.parse(await file.text())});
  if(!result.ok)throw new Error(result.error.message);modal.close();toast('편집 설정을 적용했습니다. 실행 취소할 수 있습니다.');return result;
 }catch(error){toast(error.message||'설정 파일을 확인하세요.');return {ok:false,error:{code:'IMPORT_FAILED',message:error.message}};}
 finally{$('#projectInput').value='';}
}
function downloadProjectSettings(){download(new Blob([JSON.stringify(createProjectDocument(state),null,2)],{type:'application/json'}),`${state.name||'moment'}.moment.json`);}
function showHelp(){
 modalOpen('짧게 담고, 오래 기억되게.',`<ol class="guide-steps"><li>영상을 올리고 화면 비율과 구도를 맞추세요.</li><li>템플릿, 타이틀, 대사 자막을 편집하세요.</li><li>필요한 음성을 연결하고 완성된 영상을 내보내세요.</li></ol><p class="modal-copy"><span class="keyboard-key">Space</span> 재생 / 정지 &nbsp; <span class="keyboard-key">Ctrl Z</span> 실행 취소</p><div class="notice">편집 설정 파일에는 제목·자막·클립 구간이 담깁니다. 영상·오디오 파일은 포함하지 않습니다. 다른 브라우저에서 불러올 때는 같은 원본 파일을 먼저 연결하세요.</div>`, '<div class="modal-foot"><button class="button" id="importProjectSettingsButton">편집 설정 불러오기</button><button class="button primary" id="downloadProjectSettingsButton">편집 설정 저장</button></div>');
 $('#importProjectSettingsButton').onclick=()=>$('#projectInput').click();$('#downloadProjectSettingsButton').onclick=downloadProjectSettings;
}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),5000);}
function saveStatus(text,ok=true){const key=text+ok;if(lastSaveStatus===key)return;lastSaveStatus=key;$('#saveStatus').innerHTML=`<i style="background:${ok?'#93a88d':'#dd9c70'}"></i> ${esc(text)}`;}
const dbGet=key=>projectStore.get(key);
function scheduleSave(){saveStatus('저장 중…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveProject(),500);}
async function saveProject(show=false){try{clearTimeout(saveTimer);if(show&&(videoFile||audioFile))persistMedia();let saving;do{saving=pendingSave;await saving;}while(saving!==pendingSave);localStorage.setItem('moment-state-v1',JSON.stringify(state));saveStatus('이 브라우저에 저장됨');if(show)toast('프로젝트를 이 브라우저에 저장했습니다.');}catch(e){saveStatus('저장 공간을 확인하세요',false);if(show)toast('저장 공간이 부족하거나 브라우저 저장이 차단되었습니다.');}}
function persistMedia(){pendingSave=projectStore.setMedia(videoFile,audioFile);pendingSave.catch(()=>saveStatus('미디어 저장 실패',false));}
function setRatio(value){runEditorCommand('project.update',{patch:{ratio:value}});}
function resizePreview(){const [w,h]=state.ratio.split(':').map(Number);canvas.width=w/h>=1?960:540;canvas.height=Math.round(canvas.width*h/w);const wrap=$('#canvasWrap'), stage=$('#stage');wrap.style.aspectRatio=`${w}/${h}`;const maxH=stage.clientHeight-53,maxW=stage.clientWidth-50;wrap.style.height=`${Math.max(100,Math.min(maxH,maxW*h/w,570))}px`;wrap.style.width='auto';draw();}
function renderInspector(){const c=state.clips[selected]||state.clips[0];$('#projectName').value=state.name;$('#ratioLabel').textContent=state.ratio;$('#previewSize').textContent=state.ratio==='9:16'?'1080 × 1920':state.ratio==='1:1'?'1080 × 1080':'1920 × 1080';$$('[data-ratio]').forEach(b=>b.classList.toggle('active',b.dataset.ratio===state.ratio));$$('[data-fit]').forEach(b=>b.classList.toggle('active',b.dataset.fit===state.fit));$$('[data-style]').forEach(b=>b.classList.toggle('active',b.dataset.style===state.style));$('#zoom').value=state.zoom;$('#zoomValue').textContent=`${Math.round(state.zoom*100)}%`;$('#volume').value=state.volume;$('#volumeValue').textContent=`${Math.round(state.volume*100)}%`;$('#speed').value=state.speed;$('#trimStart').value=c.start.toFixed(1);$('#trimEnd').value=c.end.toFixed(1);$('#clipIndex').textContent=`클립 ${selected+1}`;$('#undoButton').disabled=!history.length;$('#redoButton').disabled=!future.length;$('#deleteButton').disabled=state.clips.length<=1;$('#moveLeft').disabled=selected<=0;$('#moveRight').disabled=selected>=state.clips.length-1;$('#sampleBadge').hidden=state.kind!=='demo';if(videoGain){videoGain.gain.value=muted?0:state.volume;audioGain.gain.value=muted?0:state.audioVolume;}video.playbackRate=state.speed;audio.playbackRate=state.speed;}
function renderTimeline(){renderLayerTrack();const len=duration();$('#seek').max=len;$('#videoTrack').innerHTML=state.clips.map((c,i)=>`<button class="clip ${i===selected?'active':''}" data-clip="${i}" style="flex:${c.end-c.start};${thumbnail?`background-image:url('${thumbnail}');background-size:auto 100%;`:''}" title="클립 ${i+1}: ${fmt(c.start)}–${fmt(c.end)}"><span>${i===0?esc(state.fileName):'클립 '+(i+1)}</span></button>`).join('');const blocks=editedCaptions(state.captions,state.clips).map(cap=>`<button class="caption-block" style="left:${cap.start/len*100}%;width:${(cap.end-cap.start)/len*100}%">${esc(cap.text)}</button>`).join('');$('#captionTrack').innerHTML=blocks;$('#ruler').innerHTML=Array.from({length:6},(_,i)=>`<span>${fmt(len*i/5/state.speed)}</span>`).join('');$('#audioTrack').classList.toggle('has-audio',!!audioFile);$('#audioTrack').textContent=audioFile?`♫ ${state.audioName} · ${(state.audioOffset/state.speed).toFixed(1)}초부터`:'+ 오디오를 추가해 보세요';updateTime();}
function updateTime(force=true){
 const now=performance.now();if(!force&&now-lastUiTime<100)return;lastUiTime=now;
 const len=duration(),label=`${fmt(current/state.speed)} <span>/ ${fmt(len/state.speed)}</span>`;
 if(label!==lastTimeLabel){$('#timeDisplay').innerHTML=label;lastTimeLabel=label;}
 $('#seek').value=current;$('#playhead').style.transform=`translateX(${len?current/len*$('#tracksArea').clientWidth:0}px)`;
 if(exporting){const progress=Math.round(current/len*100),bar=$('#exportProgress'),label=$('#exportPercent');if(bar)bar.style.width=progress+'%';if(label)label.textContent=progress+'%';}
}
function renderLayerTrack(){
 const total=duration()/state.speed,d=state.design;
 let html=[['title',d.title,'타이틀'],['credit',d.credit,'크레딧']].filter(([,l])=>l.enabled).map(([key,l,label])=>{
  const start=clamp(l.start,0,total),end=clamp(l.end??total,start,total);
  return `<button class="title-track-block ${key}" data-track-layer="${key}" style="left:${start/total*100}%;width:${(end-start)/total*100}%">${label} · ${esc(key==='title'?l.lines.filter(Boolean).join(' / '):l.text)}</button>`;
 }).join('');
 html+=(state.overlays||[]).filter(card=>card.start<total).map(card=>`<button class="title-track-block scene" data-track-card="${esc(card.id)}" style="left:${clamp(card.start/total*100,0,100)}%;width:${clamp((Math.min(total,card.end)-card.start)/total*100,0,100)}%">${esc(card.label)} · ${esc(card.text)}</button>`).join('');
 $('#titleTrack').innerHTML=html||'<span class="empty-layer-track">+ 타이틀 · 장면 카드를 추가하세요</span>';
}
function selectedSceneLayer(){
 const active=activeSceneLayers(state,current/state.speed);
 if(panel==='effects'&&effectTab==='cards')return active.find(card=>card.id===(selectedCard||state.overlays[0]?.id));
 if(panel==='text'&&textLayer==='title')return active.find(card=>(card.role||'headline')==='headline');
 return null;
}
function updateLayerGuide(){
 const guide=$('#layerSelection');if(!guide)return;
 const scene=selectedSceneLayer(),isText=panel==='text'&&textLayer!=='frame';
 const l=textLayer==='caption'?{x:state.captionX,y:state.captionY,enabled:true}:state.design[textLayer];
 guide.hidden=!scene&&(!isText||!l?.enabled);
 if(scene){const box=sceneBounds(scene,canvas.width,canvas.height);guide.style.left=`${box.x/canvas.width*100}%`;guide.style.top=`${box.y/canvas.height*100}%`;guide.style.width=`${box.width/canvas.width*100}%`;guide.style.height=`${box.height/canvas.height*100}%`;guide.dataset.label='구간별 타이틀';}
 else if(!guide.hidden){guide.style.width='84%';guide.style.left=`${l.x*100}%`;guide.style.top=`${l.y*100}%`;guide.dataset.label={title:'타이틀',caption:'대사',credit:'크레딧'}[textLayer];guide.style.height=textLayer==='title'?'16%':textLayer==='credit'?'7%':'12%';}
 $('#moveHint').textContent=scene||isText?'선택한 글자를 드래그해 이동':'영상을 드래그해 구도 조절';
}
function previewDesign(change){change(state);renderLayerTrack();updateLayerGuide();requestDraw();scheduleSave();$('#undoButton').disabled=!history.length;$('#redoButton').disabled=!future.length;}
function renderDesignPanel(target){
 mountDesignPanel(target,{state,layer:textLayer,time:current/state.speed,total:duration()/state.speed,snapshot,update:previewDesign,navigate:switchPanel,
  timedTitle(id){selectedCard=id;effectTab='cards';switchPanel('effects');},
  select(layer){textLayer=layer;renderPanel();updateLayerGuide();},
  preset(preset){if(!runEditorCommand('template.apply',{templateId:preset}))return;toast('타이틀·대사·여백 구성을 적용했습니다. 문구는 그대로 유지합니다.');},
  captionStyle(style){edit(()=>{state.style=style;state.captionItalic=style!=='minimal';state.captionStroke=style==='minimal'?2:3;},true);}
 });
}
function persistTemplateLibrary(){
 try{localStorage.setItem('moment-templates-v1',JSON.stringify(savedTemplates));localStorage.setItem('moment-favorites-v1',JSON.stringify(favoriteTemplates));return true;}
 catch{toast('브라우저 저장 공간이 부족합니다.');return false;}
}
const templateDemos=new WeakMap();
function templateProject(template){if(templateDemos.has(template))return templateDemos.get(template);const p=initial();applyTemplate(p,template,true);p.globalKeywords=p.globalKeywords||'순간, 속도';if(template.id==='interview')p.captions.forEach((cap,i)=>cap.speaker=String(i%2));templateDemos.set(template,p);return p;}
function renderTemplateCanvas(target,template,fraction=.4){
 const p=templateProject(template),t=clamp(fraction,0,.999)*12;
 paintComposition(target.getContext('2d'),target.width,target.height,p,{source:sampleRaster||sample,sw:540,sh:960,ready:sample.complete,sourceTime:t,time:t,total:12,elapsed:t,remaining:12-t,progress:t/12});
}
function renderGallery(target){
 mountTemplateGallery(target,{ui:galleryUI,active:state.templateId,custom:savedTemplates,favorites:favoriteTemplates,thumbnail:renderTemplateCanvas,preview:openTemplatePreview,save:saveTemplateDialog,
  favorite(id){const previous=[...favoriteTemplates],i=favoriteTemplates.indexOf(id);if(i<0)favoriteTemplates.push(id);else favoriteTemplates.splice(i,1);if(!persistTemplateLibrary())favoriteTemplates.splice(0,favoriteTemplates.length,...previous);},
  remove(id){modalOpen('내 템플릿을 삭제할까요?','<p class="modal-copy">현재 편집 중인 영상은 그대로 유지됩니다.</p>','<div class="modal-foot"><button class="button" id="cancelRemoveTemplate">취소</button><button class="button primary" id="confirmRemoveTemplate">템플릿 삭제</button></div>');$('#cancelRemoveTemplate').onclick=()=>modal.close();$('#confirmRemoveTemplate').onclick=()=>{const previous=savedTemplates;savedTemplates=savedTemplates.filter(t=>t.id!==id);if(!persistTemplateLibrary()){savedTemplates=previous;return;}modal.close();renderPanel();};}
 });
}
function saveTemplateDialog(){
 if(savedTemplates.length>=20){toast('내 템플릿은 20개까지 저장할 수 있습니다.');return;}
 modalOpen('나만의 구성으로 저장',`<p class="modal-copy">타이틀 스타일·자막 스타일·효과·구간별 문구를 저장합니다. 영상과 오디오는 포함하지 않습니다.</p><label class="panel-label" for="customTemplateName">템플릿 이름</label><input class="panel-input" id="customTemplateName" maxlength="40" value="${esc(state.name)} 스타일">`,'<div class="modal-foot"><button class="button primary" id="saveCustomTemplate">이 브라우저에 저장</button></div>');
 $('#saveCustomTemplate').onclick=()=>{const name=$('#customTemplateName').value.trim();if(!name){$('#customTemplateName').focus();return;}const item=saveCustomTemplate(name,state);savedTemplates.push(item);if(!persistTemplateLibrary()){savedTemplates.pop();return;}modal.close();galleryUI.category='내 템플릿';switchPanel('templates');toast('내 템플릿을 저장했습니다.');};
}
function openTemplatePreview(template){
 pause();const reference=REFERENCE_SOURCES[template.source];
 modalOpen(esc(template.name),`<div class="template-preview-layout"><div class="template-demo-stage"><canvas id="templateDemo" width="432" height="768"></canvas><button class="button" id="toggleTemplateDemo">▶ 예시 재생</button><small>샘플 그래픽 · 12초 미리보기</small></div><div class="template-details"><span class="template-category">${esc(template.category)}</span><p class="modal-copy">${esc(template.description)}</p><div class="template-flow">${template.flow.map((line,i)=>`<div><b>${i+1}</b><span>${esc(line)}</span></div>`).join('')}</div><div class="notice"><strong>스타일만 적용</strong><br>기존 타이틀 문구·자막·카드를 유지합니다.<br><br><strong>예시 구성까지 적용</strong><br>예시 타이틀·크레딧·구간별 문구로 교체합니다. 대사 자막과 영상은 유지됩니다. 실행 취소할 수 있습니다.</div>${reference?`<a class="reference-link" href="${reference.url}" target="_blank" rel="noopener noreferrer">참고한 공식 자료 ↗</a>`:''}</div></div>`, '<div class="modal-foot"><button class="button" id="applyTemplateStructure">예시 구성까지 적용</button><button class="button primary" id="applyTemplateStyle">스타일만 적용</button></div>');
 modal.classList.add('template-modal');renderTemplateCanvas($('#templateDemo'),template,.4);
 let started=0,running=false,lastPreview=-Infinity;
 const stop=()=>{running=false;if(templatePreviewFrame)cancelAnimationFrame(templatePreviewFrame);templatePreviewFrame=0;};
 const animate=now=>{if(!modal.open||!running){stop();return;}if(now-lastPreview>=1000/30){renderTemplateCanvas($('#templateDemo'),template,((now-started)%12000)/12000);lastPreview=now;}templatePreviewFrame=requestAnimationFrame(animate);};
 $('#toggleTemplateDemo').onclick=()=>{if(running){stop();$('#toggleTemplateDemo').textContent='▶ 예시 재생';}else{running=true;started=performance.now();$('#toggleTemplateDemo').textContent='Ⅱ 일시정지';templatePreviewFrame=requestAnimationFrame(animate);}};
 modal.onclose=stop;
 const apply=withContent=>{stop();if(template.custom)edit(()=>applyTemplate(state,template,withContent));else if(!runEditorCommand('template.apply',{templateId:template.id,withContent}))return;modal.close();selectedCard=state.overlays[0]?.id;renderPanel();seekTo(0);toast(withContent?'예시 타이틀과 구간별 문구를 적용했습니다. 문구를 내 영상에 맞게 수정하세요.':'스타일을 적용했습니다. 기존 문구와 자막은 유지했습니다.');};
 $('#applyTemplateStyle').onclick=()=>apply(false);$('#applyTemplateStructure').onclick=()=>apply(true);
}
function renderEffects(target){
 mountEffectsPanel(target,{state,total:duration()/state.speed,tab:effectTab,selected:selectedCard,snapshot,update:previewDesign,
  changeTab(tab){effectTab=tab;renderPanel();},
  toggleAll(){const visible=state.overlays.some(c=>c.enabled!==false);edit(()=>state.overlays.forEach(c=>c.enabled=!visible),true);},
  reset(){edit(()=>state.effects=defaultEnhancements().effects,true);},
  add(){if(state.overlays.length>=12)return;edit(()=>{const card=newCard(duration()/state.speed,current/state.speed);selectedCard=card.id;state.overlays.push(card);},true);},
  select(id){selectedCard=id;const card=state.overlays.find(c=>c.id===id);pause();if(card)seekTo(Math.min(card.end-.001,card.start+.2)*state.speed);renderPanel();},
  remove(id){edit(()=>{state.overlays=state.overlays.filter(c=>c.id!==id);selectedCard=state.overlays[0]?.id;},true);},
  duplicate(id){if(state.overlays.length>=12){toast('카드는 12개까지 추가할 수 있습니다.');return;}edit(()=>{const card=structuredClone(state.overlays.find(c=>c.id===id));card.id=newCard(duration()/state.speed).id;selectedCard=card.id;state.overlays.push(card);},true);},
  play(start){const card=state.overlays.find(c=>c.id===selectedCard)||state.overlays[0];pause();seekTo(start*state.speed);cardPlaybackEnd=card?.end??null;play();}
 });
}
function renderPanel(){const target=$('#panelContent');if(panel==='templates'){renderGallery(target);}else if(panel==='effects'){renderEffects(target);}else if(panel==='media'){target.innerHTML=`<h1 class="panel-heading">미디어 라이브러리</h1><p class="panel-intro">좋은 이야기는 하나의 영상에서 시작해요.</p><div class="dropzone" id="dropzone"><span class="upload-circle">${icon('upload')}</span><strong>영상을 여기에 놓아주세요</strong><p>또는 기기에서 파일을 선택하세요</p><button class="button dark" id="chooseVideo">영상 업로드</button></div><p class="formats">MP4, MOV, WebM · 최대 500 MB<br>브라우저에서 재생 가능한 코덱 지원</p><div class="section-label">프로젝트 미디어 <span class="asset-count">1</span><span class="muted">${icon('folder')}</span></div><button class="asset-card full" style="width:100%;text-align:left" id="assetSelect"><div class="asset-thumb"><img src="${thumbnail||'./sample.svg'}" alt="${state.kind==='demo'?'바닷가 산책 샘플 일러스트':'업로드한 영상 썸네일'}"><span class="duration">${fmt(state.duration)}</span></div><div class="asset-info">${icon('video')}<div><strong>${esc(state.fileName)}</strong><small>${state.kind==='demo'?'모션 그래픽 · 샘플 자막 포함':'내 기기 · 원본 영상'}</small></div></button><button class="sample-link" id="loadDemo">${icon('reset')} 샘플 프로젝트로 둘러보기</button><div class="workflow-note"><h4>쇼츠 완성까지, 간단하게</h4><div class="workflow-step"><b>1</b> 영상을 올리고 세로로 맞추기</div><div class="workflow-step"><b>2</b> 자막과 나만의 목소리 더하기</div><div class="workflow-step"><b>3</b> 가장 좋은 순간만 내보내기</div></div>`;
 $('#chooseVideo').onclick=()=>$('#videoInput').click();$('#assetSelect').onclick=()=>{seekTo(0);toast('프로젝트의 첫 장면으로 이동했습니다.');};$('#loadDemo').onclick=()=>confirmReset(true);const drop=$('#dropzone');['dragenter','dragover'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('dragover');}));['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('dragover');if(e==='drop'&&ev.dataTransfer.files[0])loadVideo(ev.dataTransfer.files[0]);}));
 }else if(panel==='captions'){target.innerHTML=`<h1 class="panel-heading">말하는 순간, 자막으로</h1><p class="panel-intro">음성을 인식해 자막을 만들고<br>문장과 타이밍을 자유롭게 고치세요.</p><label class="panel-label" for="captionSource">인식할 오디오</label><select class="panel-select" id="captionSource"><option value="video">원본 영상의 음성</option><option value="audio" ${audioFile?'':'disabled'}>추가한 오디오 / 녹음</option></select><label class="panel-label" for="language">음성 언어</label><select class="panel-select" id="language"><option value="korean">한국어</option><option value="english">English</option><option value="japanese">日本語</option><option value="chinese">中文</option></select><button class="button dark full" id="generateCaptions" ${''}>${transcribing?'<span class="spinner"></span> 인식 중 · 취소':icon('sparkle')+' 자동 자막 생성'}</button><div class="notice" id="asrStatus">첫 실행 시 음성 인식 모델을 다운로드합니다. 인터넷 연결이 필요하며, 음성 인식은 기기에서 처리됩니다. 최대 3분의 원본을 지원합니다.</div><div class="panel-actions"><button class="button" id="addCaption">+ 직접 추가</button><button class="button" id="importSrt">SRT 불러오기</button></div><div class="caption-split-tool"><select id="captionChunkSize" aria-label="자막 분할 길이"><option value="12">짧게 · 12자</option><option value="18" selected>보통 · 18자</option><option value="24">길게 · 24자</option></select><button class="button compact" id="splitLongCaptions">긴 자막 나누기</button></div><p class="tiny-note">분할 시간은 글자 수로 추정합니다. 음성을 듣고 조절해 주세요.</p><button class="text-button" id="captionDesignShortcut">강조어 · 화자 색상 설정 →</button><div class="section-label" style="margin-top:23px">자막 ${state.captions.length}개 <button class="text-button" id="downloadSrt">SRT 저장</button></div><p class="tiny-note">원본 음성은 원본 시간, 추가 오디오는 편집 타임라인 시간 기준입니다. 모두 배속 적용 전 초 단위입니다.</p><div id="captionRows">${state.captions.map((c,i)=>`<div class="caption-row"><small class="caption-clock">${c.basis==='timeline'?'추가 오디오 · 편집 타임라인':'원본 영상 시간'}</small><div class="caption-row-head"><input type="number" min="0" step="0.1" value="${c.start.toFixed(1)}" data-caption-start="${i}" aria-label="자막 ${i+1} 시작 초"><span class="muted">–</span><input type="number" min="0" step="0.1" value="${c.end.toFixed(1)}" data-caption-end="${i}" aria-label="자막 ${i+1} 끝 초"><button class="icon-button" data-delete-caption="${i}" aria-label="자막 ${i+1} 삭제">${icon('trash')}</button></div><textarea data-caption-text="${i}" aria-label="자막 ${i+1} 내용">${esc(c.text)}</textarea><div class="caption-extra"><input data-caption-keywords="${i}" value="${esc(c.keywords||'')}" maxlength="150" placeholder="강조 단어, 쉼표로 구분" aria-label="자막 ${i+1} 강조 단어"><select data-caption-speaker="${i}" aria-label="자막 ${i+1} 화자"><option value="">화자 없음</option>${state.speakerLabels.map((name,n)=>`<option value="${n}" ${String(c.speaker)===String(n)?'selected':''}>${esc(name)}</option>`).join('')}</select></div>${c.timing==='estimated'?'<small class="estimated-timing">시간 추정 · 음성과 확인 필요</small>':''}</div>`).join('')||'<p class="empty-text">자동으로 만들거나<br>첫 자막을 직접 추가해 보세요.</p>'}</div>`;
 $('#captionDesignShortcut').onclick=()=>{textLayer='caption';switchPanel('text');};$('#splitLongCaptions').onclick=()=>{const limit=Number($('#captionChunkSize').value);edit(()=>state.captions=state.captions.flatMap(c=>splitCaptionText(c,limit)),true);toast('긴 자막을 나눴습니다. 시간은 글자 수 기준으로 배분했으니 음성과 확인해 주세요.');};$$('[data-caption-keywords]').forEach(el=>el.onchange=()=>edit(()=>state.captions[+el.dataset.captionKeywords].keywords=el.value));$$('[data-caption-speaker]').forEach(el=>el.onchange=()=>edit(()=>state.captions[+el.dataset.captionSpeaker].speaker=el.value));$('#generateCaptions').onclick=generateCaptions;$('#addCaption').onclick=()=>edit(()=>{const t=Math.min(locate(current).source,Math.max(0,state.duration-.1));state.captions.push({start:t,end:Math.min(state.duration,t+3),text:'새로운 자막을 입력하세요'});},true);$('#importSrt').onclick=()=>$('#srtInput').click();$('#downloadSrt').onclick=downloadSrt;$$('[data-delete-caption]').forEach(b=>b.onclick=()=>edit(()=>state.captions.splice(+b.dataset.deleteCaption,1),true));$$('[data-caption-text]').forEach(el=>el.onchange=()=>edit(()=>state.captions[+el.dataset.captionText].text=el.value));for(const side of ['start','end'])$$(`[data-caption-${side}]`).forEach(el=>el.onchange=()=>{const i=+el.dataset[side==='start'?'captionStart':'captionEnd'],c=state.captions[i],value=+el.value;if(!Number.isFinite(value)||value<0||value>(c.basis==='timeline'?duration():state.duration)||(side==='start'?value>=c.end:value<=c.start)){toast('시작은 끝보다 작고, 영상 길이 안에 있어야 합니다.');renderPanel();return;}edit(()=>c[side]=value);});
 }else if(panel==='audio'){target.innerHTML=`<h1 class="panel-heading">목소리로 더하는 분위기</h1><p class="panel-intro">음성이나 배경음악을 연결하고<br>영상과 함께 자연스럽게 재생하세요.</p><button class="button dark full" id="chooseAudio">${icon('upload')} 오디오 업로드</button><button class="button full" style="margin-top:10px" id="recordButton">${icon('mic')} 마이크로 직접 녹음</button><div class="notice">녹음에는 마이크 권한이 필요합니다. 녹음 및 업로드한 소리는 원본 음성과 함께 내보내기에 포함됩니다.</div>${audioFile?`<div class="audio-file">${icon('audio')} ${esc(state.audioName)}<button class="text-button" id="removeAudio">연결 해제</button></div><label class="panel-label" for="audioOffset">시작 위치 (출력 영상 기준 초)</label><input class="panel-input" id="audioOffset" type="number" min="0" max="${duration()/state.speed}" step="0.1" value="${state.audioOffset/state.speed}"><label class="slider-label">오디오 볼륨 <output id="audioVolumeOutput">${Math.round(state.audioVolume*100)}%</output></label><input id="audioVolume" type="range" min="0" max="1" step="0.01" value="${state.audioVolume}" style="width:100%" aria-label="추가 오디오 볼륨">`:'<p class="empty-text">아직 연결된 오디오가 없어요.<br>나만의 목소리를 더해 보세요.</p>'}<div class="workflow-note"><h4>소리를 더 깔끔하게</h4><p class="panel-intro">원본 볼륨을 줄이고 녹음 볼륨을 조절하면 내레이션이 더 잘 들려요.</p></div>`;$('#chooseAudio').onclick=()=>$('#audioInput').click();$('#recordButton').onclick=toggleRecording;if(audioFile){$('#removeAudio').onclick=()=>{pause();audioFile=null;state.audioName='';audio.removeAttribute('src');if(audioURL)URL.revokeObjectURL(audioURL);persistMedia();changed();renderPanel();};$('#audioOffset').onchange=e=>edit(()=>{const next=clamp((+e.target.value||0)*state.speed,0,duration()),delta=next-state.audioOffset;state.audioOffset=next;state.captions=state.captions.map(cap=>cap.basis==='timeline'?{...cap,start:Math.max(0,cap.start+delta),end:Math.max(.001,cap.end+delta)}:cap);},true);$('#audioVolume').onpointerdown=snapshot;$('#audioVolume').oninput=e=>{state.audioVolume=+e.target.value;$('#audioVolumeOutput').textContent=Math.round(state.audioVolume*100)+'%';renderInspector();scheduleSave();};}
 }else if(panel==='text'){renderDesignPanel(target);
 }else{target.innerHTML=`<h1 class="panel-heading">내 영상에 맞는 화면</h1><p class="panel-intro">비율과 구도를 조정해<br>중요한 장면을 화면에 담으세요.</p><div class="settings-mirror"><div class="section-label">화면 비율</div><div class="ratio-grid">${['9:16','1:1','16:9'].map(r=>`<button class="ratio-option ${state.ratio===r?'active':''}" data-ratio="${r}"><strong>${r}</strong><small>${r==='9:16'?'쇼츠':r==='1:1'?'피드':'가로'}</small></button>`).join('')}</div><div class="field-label">화면 채우기</div><div class="segmented"><button data-fit="cover" class="${state.fit==='cover'?'active':''}">채우기</button><button data-fit="contain" class="${state.fit==='contain'?'active':''}">전체 보기</button></div><label class="panel-label" for="mobileZoom">확대</label><input id="mobileZoom" type="range" min="1" max="3" step=".01" value="${state.zoom}" style="width:100%"><p class="tiny-note">미리보기를 드래그해 위치를 조절하세요.</p><label class="panel-label" for="captionSize">자막 크기</label><input id="captionSize" type="range" min="18" max="52" value="${state.captionSize}" style="width:100%"><label class="panel-label" for="captionY">자막 세로 위치</label><input id="captionY" type="range" min=".15" max=".9" step=".01" value="${state.captionY}" style="width:100%"><div class="section-label" style="margin-top:25px">선택 클립 자르기</div><div class="time-fields"><label>시작 (초)<input id="panelTrimStart" type="number" min="0" step=".1" value="${state.clips[selected].start}"></label><label>끝 (초)<input id="panelTrimEnd" type="number" min="0" step=".1" value="${state.clips[selected].end}"></label></div><button class="button full" id="panelTrimApply">구간 적용</button><label class="panel-label" for="panelVolume">원본 볼륨</label><input id="panelVolume" type="range" min="0" max="1" step=".01" value="${state.volume}" style="width:100%"><button class="button full" style="margin-top:25px" id="resetPosition">${icon('reset')} 화면 위치 초기화</button></div>`;for(const [id,key] of [['mobileZoom','zoom'],['captionSize','captionSize'],['captionY','captionY'],['panelVolume','volume']]){const el=$('#'+id);el.onpointerdown=snapshot;el.oninput=()=>{state[key]=+el.value;renderInspector();draw();scheduleSave();};}$('#resetPosition').onclick=()=>edit(()=>{state.zoom=1;state.panX=0;state.panY=0;},true);$('#panelTrimApply').onclick=()=>trim(+$('#panelTrimStart').value,+$('#panelTrimEnd').value);}
 icons(target);updateLayerGuide();
}
function switchPanel(next){if(record&&record.state==='recording'&&next!=='audio'){toast('녹음을 먼저 완료해 주세요.');return;}panel=next;$$('[data-panel]').forEach(b=>{b.classList.toggle('active',b.dataset.panel===panel);b.setAttribute('aria-pressed',b.dataset.panel===panel);});renderPanel();}
function paintComposition(c,w,h,p,media){
 const frame=videoFrame(p.design,w,h),fx=clipEffects(p.effects,media.elapsed,media.remaining,media.progress);
 c.fillStyle=p.design.background;c.fillRect(0,0,w,h);
 if(media.ready&&media.sw&&media.sh){
  const scale=(p.fit==='cover'?Math.max(frame.w/media.sw,frame.h/media.sh):Math.min(frame.w/media.sw,frame.h/media.sh))*p.zoom*fx.zoom;
  const dw=media.sw*scale,dh=media.sh*scale,x=frame.x+(frame.w-dw)/2+p.panX*frame.w,y=frame.y+(frame.h-dh)/2+p.panY*frame.h;
  c.save();c.beginPath();c.rect(frame.x,frame.y,frame.w,frame.h);c.clip();
  c.filter=`brightness(${p.effects.brightness}) contrast(${p.effects.contrast}) saturate(${p.effects.saturation})`;
  c.drawImage(media.source,x,y,dw,dh);c.restore();
  if(p.effects.vignette>0){const gradient=c.createRadialGradient(w*.5,h*.5,w*.15,w*.5,h*.5,h*.7);gradient.addColorStop(0,'#00000000');gradient.addColorStop(1,`rgba(0,0,0,${p.effects.vignette})`);c.fillStyle=gradient;c.fillRect(0,0,w,h);}
 }
 const cap=findCaption(p.captions,media.sourceTime,media.time*p.speed);
 typography.draw(c,w,h,p,cap?captionClock(cap,media.sourceTime,media.time*p.speed):media.sourceTime,media.time,cap);
 drawSceneCards(c,w,h,p,media.time,media.total,typography);
 if(fx.opacity>0){c.save();c.globalAlpha=fx.opacity*(p.effects.transition==='flash'?.75:1);c.fillStyle=p.effects.transition==='flash'?'#ffffff':'#000000';c.fillRect(0,0,w,h);c.restore();}
}
function paint(c,w,h){
 const pos=locate(current),clip=state.clips[pos.index];
 paintComposition(c,w,h,state,{source:state.kind==='demo'?(sampleRaster||sample):video,sw:state.kind==='demo'?540:video.videoWidth,sh:state.kind==='demo'?960:video.videoHeight,ready:state.kind==='demo'?sample.complete:video.readyState>=2,sourceTime:pos.source,time:current/state.speed,total:duration()/state.speed,elapsed:(pos.source-clip.start)/state.speed,remaining:(clip.end-pos.source)/state.speed,progress:(pos.source-clip.start)/(clip.end-clip.start)});
}
function draw(){
 if(exporting&&exportContext){paint(exportContext,exportCanvas.width,exportCanvas.height);ctx.drawImage(exportCanvas,0,0,canvas.width,canvas.height);}
 else paint(ctx,canvas.width,canvas.height);
}
function requestDraw(){if(playing||paintHandle)return;paintHandle=requestAnimationFrame(()=>{paintHandle=0;draw();});}
async function ensureAudio(){if(!audioCtx){audioCtx=new AudioContext();destination=audioCtx.createMediaStreamDestination();videoNode=audioCtx.createMediaElementSource(video);audioNode=audioCtx.createMediaElementSource(audio);videoGain=audioCtx.createGain();audioGain=audioCtx.createGain();videoNode.connect(videoGain);audioNode.connect(audioGain);videoGain.connect(audioCtx.destination);audioGain.connect(audioCtx.destination);videoGain.connect(destination);audioGain.connect(destination);}await audioCtx.resume();renderInspector();}
function syncAudio(force=false){if(!audioFile)return;const t=current-state.audioOffset;if(t>=0&&t<audio.duration){if(force||Math.abs(audio.currentTime-t)>.25)audio.currentTime=t;if(playing&&audio.paused)audio.play().catch(()=>{});}else audio.pause();}
function seekTo(t){current=clamp(t,0,duration());const pos=locate(current);if(state.kind==='video'&&Number.isFinite(video.duration))video.currentTime=Math.min(video.duration-.001,pos.source);syncAudio(true);updateTime();updateLayerGuide();draw();if(panel==='text')renderPanel();}
async function play(){
 if(playing)return;const request=++playRequest;
 if(current>=duration()-.03)seekTo(0);
 try{
  await ensureAudio();if(request!==playRequest)return;
  if(state.kind==='video'){
   const pos=locate(current);if(Math.abs(video.currentTime-pos.source)>.08)await seekVideo(pos.source);
   if(request!==playRequest)return;video.playbackRate=state.speed;await video.play();
  }
  if(request!==playRequest){video.pause();return;}
  playing=true;lastTick=performance.now();lastDrawTime=-Infinity;syncAudio(true);
  $('#playButton').innerHTML=icon('pause');$('#playButton').setAttribute('aria-label','일시정지');
  if(frameHandle)cancelAnimationFrame(frameHandle);frameHandle=requestAnimationFrame(tick);
 }catch(e){toast('재생할 수 없습니다. 영상 형식과 오디오 장치를 확인하세요.');if(exporting)stopExport(true);}
}
function pause(){
 ++playRequest;playing=false;cardPlaybackEnd=null;if(frameHandle)cancelAnimationFrame(frameHandle);frameHandle=0;
 video.pause();audio.pause();$('#playButton').innerHTML=icon('play');$('#playButton').setAttribute('aria-label','재생');
}
function tick(now){
 frameHandle=0;if(!playing)return;
 const old=locate(current);
 if(state.kind==='video'){
  if(!video.seeking){
   const clip=state.clips[old.index];
   current=clamp(old.offset+video.currentTime-clip.start,old.offset,old.offset+clip.end-clip.start);
   if(video.currentTime>=clip.end-.015||video.ended){
    if(old.index+1<state.clips.length){current=old.offset+clip.end-clip.start;video.currentTime=state.clips[old.index+1].start;video.play().catch(()=>{});}
    else current=duration();
   }
  }
 }else current=Math.min(duration(),current+(now-lastTick)/1000*state.speed);
 lastTick=now;
 if(state.kind==='video'&&video.seeking)audio.pause();else syncAudio();
 updateTime(false);
 const frameInterval=1000/30,elapsed=now-lastDrawTime;
 if((state.kind==='demo'||!video.seeking)&&(elapsed>=frameInterval-.1||current>=duration())){
  draw();
  // Keep the cadence's remainder instead of losing it on every display refresh.
  lastDrawTime=Number.isFinite(lastDrawTime)?lastDrawTime+Math.floor((elapsed+.1)/frameInterval)*frameInterval:now;
 }
 if(cardPlaybackEnd!=null&&current/state.speed>=cardPlaybackEnd){pause();updateTime();return;}
 if(current>=duration()-.001){pause();updateTime();if(exporting)stopExport(false);}
 else frameHandle=requestAnimationFrame(tick);
}
function seekVideo(time){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{video.removeEventListener('seeked',done);reject(new Error('영상 탐색 시간 초과'));},10000);function done(){clearTimeout(timeout);video.removeEventListener('seeked',done);resolve();}if(Math.abs(video.currentTime-time)<.001&&video.readyState>=2&&!video.seeking){clearTimeout(timeout);resolve();return;}video.addEventListener('seeked',done,{once:true});video.currentTime=clamp(time,0,Math.max(0,video.duration-.001));});}
function waitForMedia(element,event,message){
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);element.removeEventListener(event,loaded);element.removeEventListener('error',failed);};
  const loaded=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error(message));};
  const timer=setTimeout(()=>{cleanup();reject(new Error('파일을 읽는 데 시간이 초과되었습니다. 더 작은 파일로 다시 시도하세요.'));},20000);
  element.addEventListener(event,loaded,{once:true});element.addEventListener('error',failed,{once:true});
 });
}
async function setVideoFile(file){
 if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=URL.createObjectURL(file);
 const loaded=waitForMedia(video,'loadeddata','브라우저에서 지원하지 않는 영상입니다. H.264 MP4 또는 WebM을 사용해 주세요.');
 video.src=sourceURL;await loaded;
 if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('영상 길이를 읽을 수 없습니다.');
 const thumb=document.createElement('canvas');thumb.width=320;thumb.height=180;thumb.getContext('2d').drawImage(video,0,0,320,180);thumbnail=thumb.toDataURL('image/jpeg',.7);
}
function visualSettings(){return visualPreset(state);}
async function loadVideo(file){if(loadingMedia||exporting||transcribing||record?.state==='recording'){toast('진행 중인 작업을 먼저 완료해 주세요.');return;}if(!file.type.startsWith('video/')&&!/\.(mp4|mov|webm|m4v)$/i.test(file.name)){toast('동영상 파일을 선택해 주세요.');return;}if(file.size>500*1024*1024){toast('500 MB 이하의 동영상을 선택해 주세요.');return;}loadingMedia=true;pause();const old=videoFile,previousOutput=duration()/state.speed;toast('영상을 불러오는 중입니다…');try{await setVideoFile(file);videoFile=file;state={...initial(),...visualSettings(),kind:'video',name:file.name.replace(/\.[^.]+$/,''),fileName:file.name,duration:video.duration,clips:[{start:0,end:video.duration}],captions:[]};retimeOutputLayers(state,previousOutput,state.duration);current=0;selected=0;audioFile=null;audio.pause();audio.removeAttribute('src');if(audioURL)URL.revokeObjectURL(audioURL);audioURL='';history=[];future=[];persistMedia();changed();renderPanel();resizePreview();toast('영상을 불러왔습니다. 9:16 세로 화면이 적용되었습니다.');}catch(e){videoFile=old;if(old)await setVideoFile(old).catch(()=>{});else{if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL='';video.removeAttribute('src');}toast(e.message);}finally{loadingMedia=false;}$('#videoInput').value='';}
async function loadAudio(file){if(loadingMedia||exporting||transcribing||record?.state==='recording')return;if(file.size>100*1024*1024){toast('100 MB 이하의 오디오를 선택해 주세요.');return;}loadingMedia=true;const nextURL=URL.createObjectURL(file);const probe=new Audio();try{const loaded=waitForMedia(probe,'loadedmetadata','지원하지 않는 오디오 형식입니다.');probe.src=nextURL;await loaded;pause();if(audioURL)URL.revokeObjectURL(audioURL);audioURL=nextURL;audio.src=audioURL;audioFile=file;state.audioName=file.name;state.audioOffset=0;persistMedia();changed();renderPanel();toast('오디오를 연결했습니다. 재생해서 소리를 확인하세요.');}catch(e){URL.revokeObjectURL(nextURL);toast(e.message);}finally{loadingMedia=false;probe.removeAttribute('src');probe.load();}$('#audioInput').value='';}
async function toggleRecording(){
 if(record?.state==='recording'){record.stop();clearInterval(recordTimer);return;}
 if(loadingMedia||exporting||transcribing||requestingMic)return;
 requestingMic=true;let stream;
 try{
  pause();stream=await navigator.mediaDevices.getUserMedia({audio:true});
  if(panel!=='audio'||loadingMedia||exporting||transcribing){stream.getTracks().forEach(t=>t.stop());return;}
  const recorder=new MediaRecorder(stream);record=recorder;const chunks=[];let seconds=0,failed=false;
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onerror=()=>{failed=true;clearInterval(recordTimer);stream.getTracks().forEach(t=>t.stop());if(recorder.state!=='inactive')recorder.stop();record=null;if(panel==='audio')renderPanel();toast('녹음 중 오류가 발생했습니다. 마이크와 브라우저 설정을 확인하세요.');};
  recorder.onstop=async()=>{
   clearInterval(recordTimer);stream.getTracks().forEach(t=>t.stop());record=null;
   if(failed)return;
   if(!chunks.length){if(panel==='audio')renderPanel();toast('녹음된 소리가 없습니다. 다시 녹음해 주세요.');return;}
   const mime=recorder.mimeType;
   await loadAudio(new File(chunks,`내 목소리.${mime.includes('mp4')?'m4a':'webm'}`,{type:mime}));
   if(panel==='audio')renderPanel();
  };
  recorder.start();const button=$('#recordButton');button.classList.add('recording');button.innerHTML=icon('mic')+' 녹음 완료 · 00:00';
  recordTimer=setInterval(()=>{seconds++;const b=$('#recordButton');if(b)b.innerHTML=icon('mic')+` 녹음 완료 · ${fmt(seconds)}`;if(seconds>=180)recorder.stop();},1000);
 }catch(e){stream?.getTracks().forEach(t=>t.stop());record=null;toast('마이크를 사용할 수 없습니다. 브라우저에서 마이크 권한을 허용해 주세요.');}
 finally{requestingMic=false;}
}
function trim(start,end){if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>state.duration||end-start<.1){toast('시작·끝을 확인하세요. 클립은 0.1초 이상이어야 합니다.');return;}const clips=structuredClone(state.clips);clips[selected]={start,end};if(!runEditorCommand('timeline.replace',{clips}))return;seekTo(state.clips.slice(0,selected).reduce((s,c)=>s+c.end-c.start,0));if(panel==='settings')renderPanel();}
function split(){const pos=locate(current),c=state.clips[pos.index];if(pos.source-c.start<.1||c.end-pos.source<.1){toast('클립의 시작과 끝에서 0.1초 이상 떨어진 위치를 선택하세요.');return;}pause();edit(()=>{state.clips.splice(pos.index,1,{start:c.start,end:pos.source},{start:pos.source,end:c.end});selected=pos.index+1;});toast('재생 위치에서 클립을 분할했습니다.');}
function undo(redo=false){const from=redo?future:history,to=redo?history:future;if(!from.length)return;pause();to.push(JSON.stringify(state));state=JSON.parse(from.pop());timelineCache=null;state.audioName=audioFile?.name||'';selected=clamp(selected,0,state.clips.length-1);current=Math.min(current,duration());changed();resizePreview();renderPanel();seekTo(current);}
function modalOpen(title,body,footer=''){modal.onclose?.();modal.onclose=null;modal.className='';modal.innerHTML=`<div class="modal-head"><h2>${title}</h2><button class="icon-button" id="closeModal" aria-label="닫기">${icon('close')}</button></div>${body}${footer}`;$('#closeModal').onclick=()=>modal.close();modal.showModal();}
function confirmReset(){if(transcribing||record?.state==='recording'){toast('진행 중인 작업을 먼저 완료해 주세요.');return;}modalOpen('새로운 순간을 시작할까요?','<p class="modal-copy">이 브라우저에 저장된 현재 프로젝트가 샘플 프로젝트로 교체됩니다. 필요한 영상은 먼저 내보내 주세요.</p>','<div class="modal-foot"><button class="button" id="cancelReset">취소</button><button class="button primary" id="confirmReset">새 작업 시작</button></div>');$('#cancelReset').onclick=()=>modal.close();$('#confirmReset').onclick=()=>{pause();state=initial();timelineCache=null;videoFile=null;audioFile=null;thumbnail='';video.removeAttribute('src');audio.removeAttribute('src');if(sourceURL)URL.revokeObjectURL(sourceURL);if(audioURL)URL.revokeObjectURL(audioURL);sourceURL='';audioURL='';current=0;selected=0;history=[];future=[];persistMedia();changed();renderPanel();resizePreview();modal.close();};}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function srtTime(t){return srtTimestamp(t);}
function outputCaptions(){return editedCaptions(state.captions,state.clips,state.speed);}
function downloadSrt(){const out=outputCaptions();if(!out.length){toast('저장할 자막이 없습니다.');return;}const srt=projectSrt(state);download(new Blob(['\ufeff'+srt],{type:'text/plain;charset=utf-8'}),state.name+'.srt');}
async function importSrt(file){
 try{
  if(file.size>MAX_SUBTITLE_BYTES)throw new Error('자막 파일은 2 MB 이하만 지원합니다.');
  const original=state;
  const text=await file.text();
  if(state!==original)throw new Error('프로젝트가 변경되었습니다. 자막 파일을 다시 선택하세요.');
  const captions=parseSubtitles(text,state.duration);
  const result=await editorService.execute('captions.replace',{captions});
  if(!result.ok)throw new Error(result.error.message);
  toast(`${captions.length}개의 자막을 불러왔습니다.`);
 }catch(error){toast(error.message||'자막 파일을 읽지 못했습니다.');}
 finally{$('#srtInput').value='';}
}
async function generateCaptions(){if(transcribing){transcriptionCancelled=true;recognitionWorker?.terminate();recognitionWorker=null;if(pendingTranscriptionReject)pendingTranscriptionReject(new Error('자동 자막 생성을 취소했습니다.'));return;}const source=$('#captionSource').value,language=$('#language').value,file=source==='audio'?audioFile:videoFile;if(!file){toast(source==='video'?'샘플에는 음성이 없습니다. 음성이 있는 영상을 업로드하세요.':'인식할 오디오를 먼저 추가하세요.');return;}if(state.duration>180){toast('자동 자막은 원본 길이 3분 이하를 지원합니다. 짧은 원본을 업로드하세요.');return;}pause();transcriptionCancelled=false;transcribing=true;const button=$('#generateCaptions');button.disabled=false;button.innerHTML='<span class="spinner"></span> 준비 중 · 취소';const status=message=>{const el=$('#asrStatus');if(el)el.textContent=message;};try{status('오디오를 읽고 있습니다…');const decodeCtx=new AudioContext();let buffer;try{buffer=await decodeCtx.decodeAudioData(await file.arrayBuffer());}finally{await decodeCtx.close();}const length=Math.min(buffer.duration,180),offline=new OfflineAudioContext(1,Math.ceil(length*16000),16000),src=offline.createBufferSource();src.buffer=buffer;src.connect(offline.destination);src.start();const pcm=(await offline.startRendering()).getChannelData(0);if(transcriptionCancelled)throw new Error('자동 자막 생성을 취소했습니다.');let peak=0;for(let i=0;i<pcm.length;i+=50)peak=Math.max(peak,Math.abs(pcm[i]));if(peak<.002)throw new Error('음성을 찾지 못했습니다. 소리가 있는 영상이나 오디오를 선택하세요.');status('음성 인식 모델을 준비합니다. 첫 실행은 다운로드에 시간이 걸릴 수 있습니다.');if(!recognitionWorker)recognitionWorker=new Worker('./transcribe-worker.js',{type:'module'});const result=await new Promise((resolve,reject)=>{pendingTranscriptionReject=reject;recognitionWorker.onmessage=e=>{if(e.data.type==='progress')status(e.data.message);if(e.data.type==='result')resolve(e.data.result);if(e.data.type==='error')reject(new Error(e.data.message));};recognitionWorker.onerror=()=>reject(new Error('음성 인식 모듈에 연결하지 못했습니다. 인터넷 연결을 확인하거나 SRT를 불러오세요.'));recognitionWorker.postMessage({audio:pcm,language},[pcm.buffer]);});const caps=(result.chunks||[]).map(c=>({start:c.timestamp[0]||0,end:c.timestamp[1]??length,text:c.text.trim()})).filter(c=>c.text&&c.end>c.start);if(!caps.length&&result.text?.trim())caps.push({start:0,end:length,text:result.text.trim()});if(source==='audio')caps.splice(0,caps.length,...mapAudioCaptions(caps,state.audioOffset,duration()));if(!caps.length)throw new Error('인식된 음성이 없습니다. 음질과 언어 설정을 확인하세요.');edit(()=>state.captions=caps);toast(`${caps.length}개의 자막을 생성했습니다. 인식 결과를 확인해 주세요.`);}catch(e){toast(e.message||'자막 생성에 실패했습니다. SRT 불러오기나 직접 입력을 사용할 수 있습니다.');}finally{pendingTranscriptionReject=null;transcribing=false;if(panel==='captions')renderPanel();}}
function supportedTypes(){if(typeof MediaRecorder==='undefined')return [];return [{mime:'video/mp4;codecs=avc1.424028,mp4a.40.2',label:'MP4 · H.264',ext:'mp4'},{mime:'video/webm;codecs=vp9,opus',label:'WebM · VP9',ext:'webm'},{mime:'video/webm;codecs=vp8,opus',label:'WebM · VP8',ext:'webm'},{mime:'video/mp4',label:'MP4',ext:'mp4'}].filter(t=>MediaRecorder.isTypeSupported(t.mime));}
function exportDialog(){if(exporting)return;if(requestingMic||loadingMedia||record?.state==='recording'||transcribing){toast('파일 로드, 녹음 또는 자막 인식을 먼저 완료해 주세요.');return;}pause();const types=supportedTypes();if(!types.length||!canvas.captureStream){toast('이 브라우저는 영상 내보내기를 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어주세요.');return;}modalOpen('쇼츠를 완성할 시간',`<p class="modal-copy">타이틀, 자막, 구간별 문구, 움직임과 오디오를 하나의 영상으로 저장합니다.</p><div class="modal-field"><label for="exportFormat">파일 형식</label><select id="exportFormat">${types.map((t,i)=>`<option value="${i}">${t.label}</option>`).join('')}</select></div><div class="modal-field"><label for="exportQuality">해상도</label><select id="exportQuality"><option value="720">720p · 빠른 저장</option><option value="1080" selected>1080p · 고화질</option></select></div><div class="modal-field"><span>영상 길이</span><strong>${fmt(duration()/state.speed)}</strong></div><div class="notice">영상 길이만큼 실시간으로 저장합니다. 이 탭을 켜두세요. 지원 형식은 브라우저에 따라 다릅니다.</div>`,'<div class="modal-foot"><button class="button" id="cancelExportDialog">취소</button><button class="button primary" id="startExport">영상 내보내기</button></div>');$('#cancelExportDialog').onclick=()=>modal.close();$('#startExport').onclick=()=>startExport(types[+$('#exportFormat').value],+$('#exportQuality').value);}
async function startExport(type,quality){if(exporting)return;try{exporting=true;exportCancelled=false;document.body.classList.add('exporting');await ensureAudio();await document.fonts.ready;const [rw,rh]=state.ratio.split(':').map(Number);exportCanvas=document.createElement('canvas');exportCanvas.width=rw>rh?Math.round(quality*rw/rh):quality;exportCanvas.height=rh>rw?Math.round(quality*rh/rw):quality;exportContext=exportCanvas.getContext('2d');seekTo(0);if(state.kind==='video')await seekVideo(state.clips[0].start);draw();exportStream=exportCanvas.captureStream(30);destination.stream.getAudioTracks().forEach(track=>exportStream.addTrack(track.clone()));exportChunks=[];exportRecorder=new MediaRecorder(exportStream,{mimeType:type.mime,videoBitsPerSecond:quality===1080?8000000:4500000,audioBitsPerSecond:128000});exportRecorder.ondataavailable=e=>{if(e.data.size)exportChunks.push(e.data);};exportRecorder.onerror=()=>{toast('영상 저장 중 오류가 발생했습니다. 더 낮은 해상도로 다시 시도하세요.');stopExport(true);};exportRecorder.onstop=()=>{const blob=new Blob(exportChunks,{type:exportRecorder.mimeType});cleanupExport();if(exportCancelled){toast('내보내기를 취소했습니다.');return;}if(!blob.size){toast('출력 파일이 비어 있습니다. 다시 시도해 주세요.');return;}download(blob,`${state.name||'moment-shorts'}.${type.ext}`);modal.innerHTML=`<div class="modal-head"><h2>당신의 쇼츠가 완성됐어요.</h2></div><p class="modal-copy">${esc(state.name)}<br>${quality}p · ${type.ext.toUpperCase()} · ${fmt(duration()/state.speed)}</p><div class="notice">다운로드한 파일을 재생해 영상과 자막을 확인한 뒤 YouTube에 업로드하세요.</div><div class="modal-foot"><button class="button primary" id="exportDone">편집으로 돌아가기</button></div>`;$('#exportDone').onclick=()=>modal.close();};modal.innerHTML='<div class="modal-head"><h2>순간을 담는 중…</h2><strong id="exportPercent">0%</strong></div><p class="modal-copy">이 탭을 열어두면 완성된 영상이 다운로드됩니다.</p><div class="progress"><i id="exportProgress"></i></div><button class="button full" id="cancelRunningExport">내보내기 취소</button>';$('#cancelRunningExport').onclick=()=>stopExport(true);muted=false;renderInspector();exportRecorder.start(250);await play();}catch(e){stopExport(true);toast('내보내기를 시작하지 못했습니다. 브라우저와 영상 형식을 확인하세요.');}}
function stopExport(cancelled){exportCancelled=cancelled;pause();if(exportRecorder&&exportRecorder.state!=='inactive')exportRecorder.stop();else cleanupExport();if(cancelled)modal.close();}
function cleanupExport(){exporting=false;document.body.classList.remove('exporting');exportStream?.getTracks().forEach(t=>t.stop());exportStream=null;exportContext=null;exportCanvas=null;exportChunks=[];}
function bind(){icons();$$('[data-panel]').forEach(b=>b.onclick=()=>switchPanel(b.dataset.panel));document.addEventListener('click',e=>{const ratio=e.target.closest('[data-ratio]'),fit=e.target.closest('[data-fit]'),style=e.target.closest('[data-style]');if(ratio)setRatio(ratio.dataset.ratio);if(fit)edit(()=>state.fit=fit.dataset.fit);if(style)edit(()=>{state.style=style.dataset.style;state.captionItalic=state.style==='impact';state.captionStroke=state.style==='minimal'?2:3;},panel==='text');});$('#videoInput').onchange=e=>e.target.files[0]&&loadVideo(e.target.files[0]);$('#audioInput').onchange=e=>e.target.files[0]&&loadAudio(e.target.files[0]);$('#srtInput').onchange=e=>e.target.files[0]&&importSrt(e.target.files[0]);$('#projectInput').onchange=e=>e.target.files[0]&&importProjectSettings(e.target.files[0]);$('#projectName').onchange=e=>edit(()=>state.name=e.target.value.trim()||'제목 없는 쇼츠');$('#saveButton').onclick=()=>saveProject(true);$('#playButton').onclick=()=>playing?pause():play();$('#startButton').onclick=()=>{pause();seekTo(0);};$('#seek').oninput=e=>{pause();seekTo(+e.target.value);};$('#muteButton').onclick=()=>{muted=!muted;$('#muteButton').innerHTML=icon(muted?'mute':'volume');$('#muteButton').setAttribute('aria-label',muted?'미리보기 음소거 해제':'미리보기 음소거');if(audioCtx)renderInspector();};$('#speed').onchange=e=>runEditorCommand('project.update',{patch:{speed:+e.target.value}});$('#zoom').onpointerdown=snapshot;$('#zoom').oninput=e=>{state.zoom=+e.target.value;draw();renderInspector();scheduleSave();};$('#volume').onpointerdown=snapshot;$('#volume').oninput=e=>{state.volume=+e.target.value;renderInspector();scheduleSave();};$('#trimButton').onclick=()=>trim(+$('#trimStart').value,+$('#trimEnd').value);$('#splitButton').onclick=split;$('#deleteButton').onclick=()=>{if(state.clips.length<=1)return;pause();edit(()=>{state.clips.splice(selected,1);selected=Math.min(selected,state.clips.length-1);});seekTo(0);};for(const [id,delta] of [['moveLeft',-1],['moveRight',1]])$('#'+id).onclick=()=>{const dest=selected+delta;if(dest<0||dest>=state.clips.length)return;pause();edit(()=>{const c=state.clips.splice(selected,1)[0];state.clips.splice(dest,0,c);selected=dest;});seekTo(0);};$('#undoButton').onclick=()=>undo();$('#redoButton').onclick=()=>undo(true);$('#videoTrack').onclick=e=>{const clip=e.target.closest('[data-clip]');if(!clip)return;pause();selected=+clip.dataset.clip;const c=state.clips[selected],r=clip.getBoundingClientRect(),offset=state.clips.slice(0,selected).reduce((s,c)=>s+c.end-c.start,0);seekTo(offset+clamp((e.clientX-r.left)/r.width,0,.999)*(c.end-c.start));renderInspector();renderTimeline();if(panel==='settings')renderPanel();};$('#ruler').onclick=e=>{pause();const r=e.currentTarget.getBoundingClientRect();seekTo((e.clientX-r.left)/r.width*duration());};$('#captionTrack').onclick=()=>switchPanel('captions');$('#audioTrack').onclick=()=>switchPanel('audio');$('#ratioShortcut').onclick=()=>switchPanel('settings');$('#autoCaptionShortcut').onclick=()=>switchPanel('templates');$('#titleTrack').onclick=e=>{const id=e.target.closest('[data-track-card]')?.dataset.trackCard;if(id){selectedCard=id;effectTab='cards';const card=state.overlays.find(c=>c.id===id);pause();if(card)seekTo(Math.min(card.end-.001,card.start+.2)*state.speed);switchPanel('effects');}else{textLayer=e.target.closest('[data-track-layer]')?.dataset.trackLayer||'title';switchPanel('text');}};$('#safeButton').onclick=()=>{const b=$('#safeButton');$('#safeGuide').hidden=!$('#safeGuide').hidden;b.setAttribute('aria-pressed',!$('#safeGuide').hidden);};$('#resetButton').onclick=confirmReset;$('#exportButton').onclick=exportDialog;$('#helpButton').onclick=showHelp;modal.addEventListener('cancel',e=>{if(exporting)e.preventDefault();});let drag=null;
 canvas.onpointerdown=e=>{
  if(exporting)return;pause();snapshot();
  const scene=selectedSceneLayer(),mode=scene?'scene':panel==='text'&&textLayer!=='frame'?textLayer:'video';
  const l=scene||(mode==='caption'?{x:state.captionX,y:state.captionY}:state.design[mode]);
  if(mode!=='video'&&l?.enabled===false)return;
  drag={x:e.clientX,y:e.clientY,px:mode==='video'?state.panX:l.x,py:mode==='video'?state.panY:l.y,mode,sceneId:scene?.id};canvas.setPointerCapture(e.pointerId);
 };
 canvas.onpointermove=e=>{
  if(!drag)return;const r=canvas.getBoundingClientRect(),x=drag.px+(e.clientX-drag.x)/r.width,y=drag.py+(e.clientY-drag.y)/r.height;
  if(drag.mode==='video'){state.panX=clamp(x,-1,1);state.panY=clamp(y,-1,1);}
  else if(drag.mode==='scene'){const card=state.overlays.find(c=>c.id===drag.sceneId);if(card){card.x=clamp(x,.1,.9);card.y=clamp(y,.08,.8);}}
  else if(drag.mode==='caption'){state.captionX=clamp(x,.1,.9);state.captionY=clamp(y,.1,.9);}
  else{state.design[drag.mode].x=clamp(x,.1,.9);state.design[drag.mode].y=clamp(y,.06,.93);}
  updateLayerGuide();requestDraw();
 };
 const endDrag=()=>{if(!drag)return;drag=null;changed();if(panel==='text'||panel==='effects')renderPanel();};canvas.onpointerup=endDrag;canvas.onpointercancel=endDrag;
 document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||modal.open||exporting)return;if(e.code==='Space'){e.preventDefault();playing?pause():play();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);}if(e.key==='ArrowLeft'){pause();seekTo(current-1);}if(e.key==='ArrowRight'){pause();seekTo(current+1);}});window.addEventListener('resize',resizePreview);document.addEventListener('visibilitychange',()=>{if(document.hidden){if(exporting){stopExport(true);toast('탭이 숨겨져 내보내기를 중단했습니다. 이 탭을 연 상태로 다시 시도하세요.');}else pause();}});window.addEventListener('beforeunload',e=>{if(exporting||record?.state==='recording'){e.preventDefault();e.returnValue='';}});video.addEventListener('seeked',requestDraw);}
async function init(){bind();try{const saved=JSON.parse(localStorage.getItem('moment-state-v1')||'null');if(saved?.clips?.length){state=readProjectDocument({format:"moment-project",formatVersion:1,project:{...saved,schemaVersion:saved.schemaVersion??1}});[videoFile,audioFile]=await Promise.all([dbGet('video'),dbGet('audio')]);if(state.kind==='video'&&videoFile)await setVideoFile(videoFile);else if(state.kind==='video'){state=initial();toast('저장된 영상 파일을 찾을 수 없어 샘플을 열었습니다.');}if(audioFile){audioURL=URL.createObjectURL(audioFile);audio.src=audioURL;}else state.audioName='';}}catch(e){state=initial();saveStatus('저장된 프로젝트를 불러오지 못함',false);}renderPanel();renderInspector();renderTimeline();resizePreview();switchPanel(panel);document.fonts.ready.then(()=>{typography.clear();requestDraw();if(panel==='templates')renderPanel();});editorReady=true;resolveEditorReady();}
window.moment=Object.freeze({apiVersion:1,ready:editorReadyPromise,execute:editorService.execute,describe:editorService.describe,capabilities:editorService.capabilities,downloadProject:downloadProjectSettings,importProject:importProjectSettings});
init();
