import { inspectCaptionOverlaps } from './caption-overlaps.mjs';
import { message as msg } from '../i18n.mjs';
import { inspectCaptions } from './caption-inspection.mjs';
import { shiftCaptionTiming } from './caption-timing.mjs';
import { readTemplateDocument, createTemplateDocument } from '../template-library.mjs';
import { replaceCaptionText } from './caption-text.mjs';
import { TEMPLATES, applyTemplate, saveCustomTemplate } from '../template-catalog.mjs';
import { newCard, retimeOutputLayers, splitCaptionAtOffset } from '../effects.mjs';
import { MAX_CAPTIONS, parseSubtitles } from '../captions.mjs';
import { outputDuration, timelineDuration, validateProject, createProjectDocument, readProjectDocument, projectSubtitles, clipSchema, captionSchema, MAX_CLIPS } from './project.mjs';
import { object, string, number, choice, boolean, array, validate, assertJson, fail, CommandError, hasMinimumDuration } from './validation.mjs';

export const API_VERSION=1;
const patchSchema=object({name:string(200),ratio:choice('9:16','1:1','16:9'),fit:choice('cover','contain'),zoom:number(1,3),panX:number(-1,1),panY:number(-1,1),speed:number(.25,4),volume:number(0,1),audioVolume:number(0,1)});
const titleSchema=object({lines:array(string(200),2,2),colors:array(string(9),2,2),enabled:boolean,x:number(.05,.95),y:number(.06,.93),size:number(18,72),stroke:number(0,12),italic:boolean,start:number(0,86400),end:{type:['number','null'],minimum:0,maximum:86400}});
const captionColorSchema={...string(9),pattern:'^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'};
const creditSchema=object({text:string(100),enabled:boolean,italic:boolean,color:captionColorSchema,x:number(0,1),y:number(0,1),size:number(10,120),start:{type:'number',minimum:0},end:{type:['number','null'],minimum:0}});
const captionPatchSchema=object(Object.fromEntries(['text','start','end','speaker','keywords'].map(key=>[key,captionSchema.properties[key]])));
const captionStyleSchema=object({
  style:choice('impact','accent','highlight','minimal'),
  captionSize:number(10,120),captionX:number(0,1),captionY:number(0,1),
  captionColor:captionColorSchema,captionAccent:captionColorSchema,
  captionStroke:number(0,20),captionItalic:boolean,
  captionAnimation:choice('none','fade','slide','pop'),
});
const effectsSchema=object({
  motion:choice('none','in','out'),strength:number(0,.4),
  transition:choice('none','fadeBlack','flash'),transitionDuration:number(.05,.7),
  brightness:number(.7,1.3),contrast:number(.7,1.5),saturation:number(0,1.6),vignette:number(0,.6),
  progress:boolean,progressPosition:choice('top','bottom'),progressColor:captionColorSchema,
});
const overlayPatchSchema=object({
  text:string(2000),detail:string(2000),label:string(2000),
  color:captionColorSchema,accent:captionColorSchema,background:captionColorSchema,
  x:number(0,1),y:number(0,1),width:number(0,1),size:number(10,120),stroke:number(0,20),
  backgroundOpacity:number(0,1),presentation:choice('plain','panel'),role:choice('headline','free'),
  animation:choice('none','fade','slide','pop'),kind:choice('card','countdown'),enabled:boolean,
  start:{type:'number',minimum:0},end:{type:'number',minimum:0},
});
const command=(name,description,inputSchema,mutates=false)=>({name,description,inputSchema,mutates});
const definitions=[
  command('project.get','편집 설정을 이식 가능한 JSON으로 읽습니다. 미디어 파일은 포함하지 않습니다.',object()),
  command('project.update','이름, 화면 비율, 구도, 배속과 볼륨을 수정합니다.',object({patch:patchSchema},['patch']),true),
  command('effects.update','움직임·색감·클립 시작과 끝 효과·진행 막대의 지정한 설정만 수정합니다.',object({patch:effectsSchema},['patch']),true),
  command('project.import','검증된 편집 설정 JSON을 적용합니다. 미디어 파일은 별도로 연결해야 합니다.',object({document:{type:'object'}},['document']),true),
  command('template.export','현재 스타일·제목·크레딧·장면 카드를 재사용 가능한 템플릿 파일로 읽습니다. 미디어와 자막은 포함하지 않습니다.',object({id:{...string(200),minLength:1},name:{...string(40),minLength:1}},['id','name'])),
  command('templates.list','기본 템플릿 목록을 읽습니다.',object()),
  command('template.apply','기본 템플릿을 적용합니다. withContent=true는 제목과 구간 문구를 예시로 교체합니다.',object({templateId:string(100),withContent:boolean},['templateId']),true),
  command('template.apply.document','템플릿 파일의 스타일을 적용합니다. withContent=true는 제목·크레딧·장면 카드도 교체하며 자막은 유지합니다.',object({document:{type:'object'},withContent:boolean},['document']),true),
  command('timeline.move','클립을 지정한 최종 위치로 이동합니다. 원본 구간과 자막·출력 레이어의 시간 값은 유지합니다.',object({clipIndex:{type:'integer',minimum:0,maximum:MAX_CLIPS-1},toIndex:{type:'integer',minimum:0,maximum:MAX_CLIPS-1}},['clipIndex','toIndex']),true),
  command('timeline.duplicate','선택한 클립의 원본 구간을 바로 뒤에 복제합니다. 출력 글자 시간은 편집 길이에 비례 조정됩니다.',object({clipIndex:{type:'integer',minimum:0,maximum:MAX_CLIPS-1}},['clipIndex']),true),
  command('timeline.split','지정한 클립을 원본 영상 시간에서 둘로 나눕니다. 각 구간은 0.1초 이상이어야 합니다.',object({clipIndex:{type:'integer',minimum:0,maximum:MAX_CLIPS-1},sourceTime:number(0,86400)},['clipIndex','sourceTime']),true),
  command('timeline.replace','원본 영상 시간 기준 클립 목록을 교체합니다.',object({clips:array(clipSchema,MAX_CLIPS,1)},['clips']),true),
  command('credit.update','크레딧 문구·스타일·표시 시간의 지정한 설정만 수정합니다.',object({patch:creditSchema},['patch']),true),
  command('title.update','기본 제목의 두 줄 문구와 스타일을 수정합니다.',object({patch:titleSchema},['patch']),true),
  command('overlays.move','장면 카드의 쌓임 순서를 변경합니다. 마지막 카드가 앞쪽입니다.',object({id:{...string(2000),minLength:1},toIndex:{type:'integer',minimum:0,maximum:11}},['id','toIndex']),true),
  command('overlays.add','장면 카드를 지정한 ID로 끝에 추가합니다. 표시 시간은 배속 후 출력 초입니다.',object({id:{...string(2000),minLength:1},patch:{...overlayPatchSchema,required:['text','start','end']}},['id','patch']),true),
  command('overlays.remove','지정한 ID의 장면 카드 하나를 삭제합니다.',object({id:{...string(2000),minLength:1}},['id']),true),
  command('overlays.update','기존 장면 카드의 지정한 문구·스타일·출력 표시 시간만 수정합니다. 카드 ID와 순서는 유지합니다.',object({id:{...string(2000),minLength:1},patch:overlayPatchSchema},['id','patch']),true),
  command('captions.import','SRT/VTT 문자열로 자막 전체를 교체합니다. source 또는 배속 전 timeline 시간 기준을 명시하세요.',object({text:string(100000),basis:choice('source','timeline')},['text','basis']),true),
  command('captions.split','자막 하나를 문자 커서 위치에서 나눕니다. 시간은 문자 수 비례 추정이며 음성과 확인해야 합니다.',object({captionIndex:{type:'integer',minimum:0,maximum:9999},textOffset:{type:'integer',minimum:1,maximum:1999}},['captionIndex','textOffset']),true),
  command('captions.merge','인접한 두 자막을 합칩니다. 시간 기준·화자·강조 단어가 같고 시간이 겹치지 않아야 합니다.',object({captionIndex:{type:'integer',minimum:0,maximum:9998}},['captionIndex']),true),
  command('captions.insert','원본 순서의 지정한 위치에 자막 하나를 삽입합니다. 기존 자막의 상대 순서와 시간은 유지합니다.',object({captionIndex:{type:'integer',minimum:0,maximum:MAX_CAPTIONS},caption:captionSchema},['captionIndex','caption']),true),
  command('captions.remove','원본 순서의 지정한 자막 하나를 삭제합니다. 나머지 자막과 시간은 유지합니다.',object({captionIndex:{type:'integer',minimum:0,maximum:MAX_CAPTIONS-1}},['captionIndex']),true),
  command('captions.update','지정한 자막 하나의 본문·시간·화자·강조 단어만 수정합니다. 시간 기준과 추정 시간 경고는 유지합니다.',object({captionIndex:{type:'integer',minimum:0,maximum:9999},patch:captionPatchSchema},['captionIndex','patch']),true),
  command('captions.replace','자막을 교체합니다. source는 원본, timeline은 배속 전 편집 시간입니다.',object({captions:array(captionSchema,MAX_CAPTIONS)},['captions']),true),
  command('captions.text.replace','자막 본문에서 대소문자를 구분해 같은 문자열을 모두 바꿉니다. 시간과 메타데이터는 유지합니다.',object({find:{...string(2000),minLength:1},replacement:string(2000)},['find','replacement']),true),
  command('captions.timing.shift','선택한 시간 기준의 자막 전체를 배속 전 초 단위로 이동합니다. 범위를 벗어나면 변경하지 않습니다.',object({basis:choice('source','timeline'),delta:{type:'number'}},['basis','delta']),true),
  command('captions.style.update','자막의 공통 크기·위치·색상·표현만 수정합니다. 본문·시간과 SRT/VTT 내용은 유지합니다.',object({patch:captionStyleSchema},['patch']),true),
  command('captions.list','원본 순서의 자막을 제한된 페이지로 읽습니다. 시간 기준·문구·메타데이터는 변환하지 않습니다.',object({offset:{type:'integer',minimum:0,maximum:MAX_CAPTIONS},limit:{type:'integer',minimum:1,maximum:50}})),
  command('captions.overlaps','컷과 배속을 반영한 출력 자막의 시간 겹침을 읽습니다. 각 해당 구간마다 대표 충돌 하나를 반환하며 편집하지 않습니다.',object({limit:{type:'integer',minimum:1,maximum:100}})),
  command('captions.inspect','편집·배속 후 자막의 공백 제외 결합 문자 수를 출력 초로 나눠 검사합니다. 호출자가 지정한 기준을 넘는 구간만 반환합니다.',object({maxGraphemesPerSecond:{type:'number',exclusiveMinimum:0},limit:{type:'integer',minimum:1,maximum:100}},['maxGraphemesPerSecond'])),
  command('captions.export','편집 구간과 배속을 반영한 SRT, WebVTT 또는 시간표시 없는 TXT 대본을 반환합니다.',object({format:choice('srt','vtt','txt')})),
  command('render.plan','렌더러가 사용할 프로젝트 스냅샷과 출력 설정을 반환합니다. 영상을 생성하지 않습니다.',object({quality:choice(720,1080),format:choice('mp4','webm')})),
];
// Closed trust boundary: new commands require explicit opt-in. Import has a
// separate browser media-relink guard; reads and provider jobs never participate.
const batchCommands = [
  'project.update','effects.update','template.apply','template.apply.document',
  'timeline.move','timeline.duplicate','timeline.split','timeline.replace','credit.update','title.update',
  'overlays.move','overlays.add','overlays.remove','overlays.update',
  'captions.import','captions.split','captions.merge','captions.replace','captions.update','captions.insert','captions.remove',
  'captions.text.replace','captions.timing.shift','captions.style.update',
];
definitions.push(command('project.batch','최대 20개 편집을 순서대로 검증하고 한 번에 적용합니다. 하나라도 실패하면 적용하지 않습니다.',
  object({operations:array(object({command:choice(...batchCommands),arguments:{type:'object'}},['command','arguments']),20,1)},['operations']),true));

export function commandDefinitions(){return structuredClone(definitions);}
export function commandDefinition(name){const value=definitions.find(c=>c.name===name);if(!value)throw new CommandError('UNKNOWN_COMMAND',msg('errors.unknownCommand'));return structuredClone(value);}
export function prepareCommand(project,name,args={}){
  const definition=commandDefinition(name);assertJson(args);validate(definition.inputSchema,args);
  if(name==='templates.list')return {data:TEMPLATES.map(({id,name,category,description})=>({id,name,category,description}))};
  validateProject(project);
  if(name==='project.batch'){
    let next=project,updated=false;
    for(const [index,operation] of args.operations.entries()){
      const path=`arguments.operations[${index}]`;
      if(!batchCommands.includes(operation.command))fail(msg('errors.batchCommand'),`${path}.command`);
      try{
        const prepared=prepareCommand(next,operation.command,operation.arguments);
        if(prepared.project){next=prepared.project;updated=true;}
      }catch(error){
        if(error instanceof CommandError){
          const nested=error.path || 'arguments';
          throw new CommandError(error.code,error.messageKey ? error : error.message,`${path}.${nested}`);
        }
        throw error;
      }
    }
    return {...(updated?{project:next}:{}),data:{updated,operationCount:args.operations.length,outputDuration:outputDuration(next)}};
  }
  if(name==='template.export'){
    if(!args.name.trim())fail(msg('errors.exportTemplateName'),'arguments.name');
    if(!args.id.trim())fail(msg('errors.exportTemplateId'),'arguments.id');
    const template=saveCustomTemplate(args.name,project,{id:args.id});
    template.description='프로젝트에서 캡처한 스타일과 장면 카드입니다.';
    return {data:createTemplateDocument(template)};
  }
  if(name==='project.get')return {data:createProjectDocument(project)};
  if(name==='captions.list'){
    const offset=args.offset===undefined?0:args.offset,limit=args.limit===undefined?20:args.limit;
    if(!Number.isInteger(offset)||offset<0||offset>MAX_CAPTIONS)fail(msg('errors.captionListOffset'),'arguments.offset');
    if(!Number.isInteger(limit)||limit<1||limit>50)fail(msg('errors.captionListLimit'),'arguments.limit');
    const captions=structuredClone(project.captions.slice(offset,offset+limit)).map((caption,index)=>({captionIndex:offset+index,caption}));
    const totalCaptions=project.captions.length,next=offset+captions.length;
    return {data:{totalCaptions,offset,limit,nextOffset:next<totalCaptions?next:null,captions}};
  }
  if(name==='captions.overlaps')return {data:inspectCaptionOverlaps(project,args)};
  if(name==='captions.inspect')return {data:inspectCaptions(project,args)};
  if(name==='captions.export')return {data:{format:args.format||'srt',text:projectSubtitles(project,args)}};
  if(name==='captions.import'){
    let captions;
    try{
      captions=parseSubtitles(args.text,args.basis==='source'?project.duration:timelineDuration(project));
    }catch(error){fail((error.messageKey ? error : error.message)||msg('errors.subtitleText'),'arguments.text');}
    captions=captions.map(caption=>({...caption,basis:args.basis}));
    const prepared=prepareCommand(project,'captions.replace',{captions});
    return {...prepared,data:{...prepared.data,importedCaptions:captions.length}};
  }
  if(name==='timeline.move'){
    for(const key of ['clipIndex','toIndex'])
      if(!Number.isInteger(args[key])||args[key]<0||args[key]>=project.clips.length)
        fail(msg('errors.moveClipIndex'),`arguments.${key}`);
    if(args.clipIndex===args.toIndex)return {data:{updated:false,outputDuration:outputDuration(project)}};
    const next=structuredClone(project),[clip]=next.clips.splice(args.clipIndex,1);
    next.clips.splice(args.toIndex,0,clip);
    // Reordering preserves numeric layer times, even if summation order changes a last bit.
    validateProject(next);
    return {project:next,data:{updated:true,outputDuration:outputDuration(next)}};
  }
  if(name==='timeline.duplicate'){
    if(!Number.isInteger(args.clipIndex)||args.clipIndex<0||args.clipIndex>=project.clips.length)
      fail(msg('errors.duplicateClipIndex'),'arguments.clipIndex');
    if(project.clips.length>=MAX_CLIPS)fail(msg('errors.clipLimit'),'project.clips');
    const clips=structuredClone(project.clips);
    clips.splice(args.clipIndex+1,0,{...clips[args.clipIndex]});
    return prepareCommand(project,'timeline.replace',{clips});
  }
  if(name==='overlays.move'){
    if(!args.id.length)fail(msg('errors.moveCardId'),'arguments.id');
    const from=project.overlays.findIndex(card=>card.id===args.id);
    if(from<0)throw new CommandError('NOT_FOUND',msg('errors.cardMissing'));
    if(!Number.isInteger(args.toIndex)||args.toIndex<0||args.toIndex>=project.overlays.length)
      fail(msg('errors.cardOrder'),'arguments.toIndex');
    const data={updated:from!==args.toIndex,id:args.id,toIndex:args.toIndex,outputDuration:outputDuration(project)};
    if(!data.updated)return {data};
    const next=structuredClone(project),[card]=next.overlays.splice(from,1);
    next.overlays.splice(args.toIndex,0,card);validateProject(next);return {project:next,data};
  }
  if(name==='captions.insert'){
    const index=args.captionIndex,caption=args.caption;
    if(!Number.isInteger(index)||index<0||index>project.captions.length)
      fail(msg('errors.insertCaptionIndex'),'arguments.captionIndex');
    if(project.captions.length>=MAX_CAPTIONS)fail(msg('errors.captionLimit'),'project.captions');
    const total=caption.basis==='timeline'?timelineDuration(project):project.duration;
    if(caption.end<=caption.start||caption.end>total)
      fail(msg('errors.insertCaptionClock'),'arguments.caption');
    const next=structuredClone(project);next.captions.splice(index,0,structuredClone(caption));validateProject(next);
    return {project:next,data:{updated:true,captionIndex:index,totalCaptions:next.captions.length,outputDuration:outputDuration(next)}};
  }
  if(name==='captions.remove'){
    const index=args.captionIndex;
    if(!Number.isInteger(index)||index<0||index>=project.captions.length)
      fail(msg('errors.removeCaptionIndex'),'arguments.captionIndex');
    const next=structuredClone(project);next.captions.splice(index,1);validateProject(next);
    return {project:next,data:{updated:true,captionIndex:index,totalCaptions:next.captions.length,outputDuration:outputDuration(next)}};
  }
  if(name==='captions.update'){
    const index=args.captionIndex;
    if(!Number.isInteger(index)||index<0||index>=project.captions.length)
      fail(msg('errors.updateCaptionIndex'),'arguments.captionIndex');
    const next=structuredClone(project),caption=next.captions[index];
    Object.assign(caption,args.patch);
    if(Object.hasOwn(args.patch,'start')||Object.hasOwn(args.patch,'end')){
      const total=caption.basis==='timeline'?timelineDuration(next):next.duration;
      if(caption.start<0||caption.end<=caption.start||caption.end>total)
        fail(msg('errors.existingCaptionClock'),'arguments.patch');
    }
    validateProject(next);
    return {project:next,data:{updated:true,outputDuration:outputDuration(next),captionIndex:index}};
  }
  if(name==='captions.split'){
    const index=args.captionIndex;
    if(!Number.isInteger(index)||index<0||index>=project.captions.length)
      fail(msg('errors.splitCaptionIndex'),'arguments.captionIndex');
    if(project.captions.length>=MAX_CAPTIONS)fail(msg('errors.captionLimit'),'project.captions');
    let parts;
    try{parts=splitCaptionAtOffset(project.captions[index],args.textOffset);}
    catch(error){fail(error.messageKey ? error : error.message,'arguments.textOffset');}
    const next=structuredClone(project);next.captions.splice(index,1,...parts);validateProject(next);
    return {project:next,data:{updated:true,outputDuration:outputDuration(next),createdCaptionIndex:index+1}};
  }
  if(name==='captions.merge'){
    const index=args.captionIndex;
    if(!Number.isInteger(index)||index<0||index>=project.captions.length-1)
      fail(msg('errors.nextCaption'),'arguments.captionIndex');
    const first=project.captions[index],second=project.captions[index+1];
    if((first.basis||'source')!==(second.basis||'source') ||
      (first.speaker||'')!==(second.speaker||'') || (first.keywords||'')!==(second.keywords||''))
      fail(msg('errors.mergeMetadata'),'arguments.captionIndex');
    if(second.start<first.end)fail(msg('errors.mergeOrder'),'arguments.captionIndex');
    const text=first.text+' '+second.text;
    if(text.length>2000)fail(msg('errors.mergeLength'),'arguments.captionIndex');
    const merged={...first,text,end:second.end};
    if(first.timing==='estimated'||second.timing==='estimated')merged.timing='estimated';
    const next=structuredClone(project);next.captions.splice(index,2,merged);
    validateProject(next);
    return {project:next,data:{updated:true,outputDuration:outputDuration(next),mergedCaptionIndex:index}};
  }
  if(name==='captions.timing.shift'){
    const result=shiftCaptionTiming(project.captions,args,args.basis==='source'?project.duration:timelineDuration(project));
    const data={updated:result.shiftedCaptions>0,shiftedCaptions:result.shiftedCaptions,outputDuration:outputDuration(project)};
    if(!data.updated)return {data};
    const next=structuredClone(project);next.captions=structuredClone(result.captions);
    validateProject(next);return {project:next,data};
  }
  if(name==='captions.text.replace'){
    const result=replaceCaptionText(project.captions,args);
    const data={updated:result.changedCaptions>0,matches:result.matches,changedCaptions:result.changedCaptions};
    if(!data.updated)return {data};
    const next=structuredClone(project);next.captions=structuredClone(result.captions);
    validateProject(next);return {project:next,data};
  }
  if(name==='render.plan'){
    const quality=args.quality||1080, [rw,rh]=project.ratio.split(':').map(Number),width=project.ratio==='16:9'?Math.round(quality*rw/rh):quality,height=project.ratio==='16:9'?quality:Math.round(quality*rh/rw);
    return {data:{planVersion:1,project:createProjectDocument(project),output:{width,height,fps:30,format:args.format||'mp4',duration:outputDuration(project)},media:{video:project.kind==='video'?{name:project.fileName,required:true}:null,audio:project.audioName?{name:project.audioName,required:true}:null},rendered:false}};
  }
  if(name==='project.import')return {project:readProjectDocument(args.document),data:{imported:true}};
  const next=structuredClone(project),before=outputDuration(next);
  if(name==='project.update'){
    if(Object.hasOwn(args.patch,'name')&&!args.patch.name.trim())fail(msg('errors.projectName'),'arguments.patch.name');
    Object.assign(next,args.patch);
    if(Object.hasOwn(args.patch,'ratio')&&args.patch.ratio!==project.ratio){next.zoom=1;next.panX=0;next.panY=0;}
  }else if(name==='template.apply'){
    const template=TEMPLATES.find(t=>t.id===args.templateId);if(!template)throw new CommandError('NOT_FOUND',msg('errors.templateMissing'));
    applyTemplate(next,template,args.withContent===true);
  }else if(name==='template.apply.document'){
    applyTemplate(next,readTemplateDocument(args.document),args.withContent===true);
  }else if(name==='timeline.replace')next.clips=structuredClone(args.clips);
  else if(name==='timeline.split'){
    if(!Number.isInteger(args.clipIndex)||args.clipIndex<0||args.clipIndex>=next.clips.length)
      fail(msg('errors.splitClipIndex'),'arguments.clipIndex');
    if(next.clips.length>=MAX_CLIPS)
      fail(msg('errors.splitClipLimit'),'project.clips');
    const clip=next.clips[args.clipIndex];
    if(!hasMinimumDuration(clip.start,args.sourceTime)||!hasMinimumDuration(args.sourceTime,clip.end))
      fail(msg('errors.splitClipRange'),'arguments.sourceTime');
    next.clips.splice(args.clipIndex,1,{start:clip.start,end:args.sourceTime},{start:args.sourceTime,end:clip.end});
  }
  else if(name==='effects.update')Object.assign(next.effects,args.patch);
  else if(name==='overlays.add'){
    if(!args.id.trim())fail(msg('errors.newCardId'),'arguments.id');
    if(next.overlays.some(card=>card.id===args.id))fail(msg('errors.duplicateCardId'),'arguments.id');
    if(next.overlays.length>=12)fail(msg('errors.cardLimit'),'project.overlays');
    if(args.patch.end<=args.patch.start||args.patch.end>before)
      fail(msg('errors.cardTime'),'arguments.patch');
    next.overlays.push({...newCard(before),...args.patch,id:args.id});
  }
  else if(name==='overlays.remove'){
    if(!args.id.length)fail(msg('errors.removeCardId'),'arguments.id');
    const index=next.overlays.findIndex(card=>card.id===args.id);
    if(index<0)throw new CommandError('NOT_FOUND',msg('errors.cardMissing'));
    next.overlays.splice(index,1);
  }
  else if(name==='overlays.update'){
    if(!args.id.length)fail(msg('errors.updateCardId'),'arguments.id');
    const card=next.overlays.find(item=>item.id===args.id);
    if(!card)throw new CommandError('NOT_FOUND',msg('errors.cardMissing'));
    Object.assign(card,args.patch);
    if(Object.hasOwn(args.patch,'start')||Object.hasOwn(args.patch,'end')){
      if(card.start<0||card.end<=card.start||card.end>outputDuration(next))
        fail(msg('errors.cardTime'),'arguments.patch');
    }
  }
  else if(name==='credit.update'){
    Object.assign(next.design.credit,args.patch);
    if(Object.hasOwn(args.patch,'start')||Object.hasOwn(args.patch,'end')){
      const {start,end}=next.design.credit,total=outputDuration(next);
      if(start>=total||(end!==null&&(end<=start||end>total)))
        fail(msg('errors.creditTime'),'arguments.patch');
    }
  }
  else if(name==='title.update')Object.assign(next.design.title,args.patch);
  else if(name==='captions.style.update')Object.assign(next,args.patch);
  else if(name==='captions.replace'){
    const total=timelineDuration(next);
    for(const [i,c] of args.captions.entries())if(c.end<=c.start||c.end>(c.basis==='timeline'?total:next.duration))fail(msg('errors.captionClock'),`arguments.captions[${i}]`);
    next.captions=structuredClone(args.captions);
  }
  if(name==='project.update'||name==='timeline.replace')retimeOutputLayers(next,before,outputDuration(next));
  validateProject(next);
  return {project:next,data:{updated:true,outputDuration:outputDuration(next),...(['overlays.add','overlays.remove'].includes(name)?{id:args.id}:{})}};
}
