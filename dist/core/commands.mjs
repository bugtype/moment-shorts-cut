import { shiftCaptionTiming } from './caption-timing.mjs';
import { readTemplateDocument } from '../template-library.mjs';
import { replaceCaptionText } from './caption-text.mjs';
import { TEMPLATES, applyTemplate } from '../template-catalog.mjs';
import { newCard, retimeOutputLayers } from '../effects.mjs';
import { MAX_CAPTIONS, parseSubtitles } from '../captions.mjs';
import { outputDuration, timelineDuration, validateProject, createProjectDocument, readProjectDocument, projectSubtitles, clipSchema, captionSchema, MAX_CLIPS } from './project.mjs';
import { object, string, number, choice, boolean, array, validate, assertJson, fail, CommandError, hasMinimumDuration } from './validation.mjs';

export const API_VERSION=1;
const patchSchema=object({name:string(200),ratio:choice('9:16','1:1','16:9'),fit:choice('cover','contain'),zoom:number(1,3),panX:number(-1,1),panY:number(-1,1),speed:number(.25,4),volume:number(0,1),audioVolume:number(0,1)});
const titleSchema=object({lines:array(string(200),2,2),colors:array(string(9),2,2),enabled:boolean,x:number(.05,.95),y:number(.06,.93),size:number(18,72),stroke:number(0,12),italic:boolean,start:number(0,86400),end:{type:['number','null'],minimum:0,maximum:86400}});
const captionColorSchema={...string(9),pattern:'^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'};
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
  command('templates.list','기본 템플릿 목록을 읽습니다.',object()),
  command('template.apply','기본 템플릿을 적용합니다. withContent=true는 제목과 구간 문구를 예시로 교체합니다.',object({templateId:string(100),withContent:boolean},['templateId']),true),
  command('template.apply.document','템플릿 파일의 스타일을 적용합니다. withContent=true는 제목·크레딧·장면 카드도 교체하며 자막은 유지합니다.',object({document:{type:'object'},withContent:boolean},['document']),true),
  command('timeline.split','지정한 클립을 원본 영상 시간에서 둘로 나눕니다. 각 구간은 0.1초 이상이어야 합니다.',object({clipIndex:{type:'integer',minimum:0,maximum:MAX_CLIPS-1},sourceTime:number(0,86400)},['clipIndex','sourceTime']),true),
  command('timeline.replace','원본 영상 시간 기준 클립 목록을 교체합니다.',object({clips:array(clipSchema,MAX_CLIPS,1)},['clips']),true),
  command('title.update','기본 제목의 두 줄 문구와 스타일을 수정합니다.',object({patch:titleSchema},['patch']),true),
  command('overlays.move','장면 카드의 쌓임 순서를 변경합니다. 마지막 카드가 앞쪽입니다.',object({id:{...string(2000),minLength:1},toIndex:{type:'integer',minimum:0,maximum:11}},['id','toIndex']),true),
  command('overlays.add','장면 카드를 지정한 ID로 끝에 추가합니다. 표시 시간은 배속 후 출력 초입니다.',object({id:{...string(2000),minLength:1},patch:{...overlayPatchSchema,required:['text','start','end']}},['id','patch']),true),
  command('overlays.remove','지정한 ID의 장면 카드 하나를 삭제합니다.',object({id:{...string(2000),minLength:1}},['id']),true),
  command('overlays.update','기존 장면 카드의 지정한 문구·스타일·출력 표시 시간만 수정합니다. 카드 ID와 순서는 유지합니다.',object({id:{...string(2000),minLength:1},patch:overlayPatchSchema},['id','patch']),true),
  command('captions.import','SRT/VTT 문자열로 자막 전체를 교체합니다. source 또는 배속 전 timeline 시간 기준을 명시하세요.',object({text:string(100000),basis:choice('source','timeline')},['text','basis']),true),
  command('captions.replace','자막을 교체합니다. source는 원본, timeline은 배속 전 편집 시간입니다.',object({captions:array(captionSchema,MAX_CAPTIONS)},['captions']),true),
  command('captions.text.replace','자막 본문에서 대소문자를 구분해 같은 문자열을 모두 바꿉니다. 시간과 메타데이터는 유지합니다.',object({find:{...string(2000),minLength:1},replacement:string(2000)},['find','replacement']),true),
  command('captions.timing.shift','선택한 시간 기준의 자막 전체를 배속 전 초 단위로 이동합니다. 범위를 벗어나면 변경하지 않습니다.',object({basis:choice('source','timeline'),delta:{type:'number'}},['basis','delta']),true),
  command('captions.style.update','자막의 공통 크기·위치·색상·표현만 수정합니다. 본문·시간과 SRT/VTT 내용은 유지합니다.',object({patch:captionStyleSchema},['patch']),true),
  command('captions.export','편집 구간과 배속을 반영한 SRT, WebVTT 또는 시간표시 없는 TXT 대본을 반환합니다.',object({format:choice('srt','vtt','txt')})),
  command('render.plan','렌더러가 사용할 프로젝트 스냅샷과 출력 설정을 반환합니다. 영상을 생성하지 않습니다.',object({quality:choice(720,1080),format:choice('mp4','webm')})),
];
export function commandDefinitions(){return structuredClone(definitions);}
export function commandDefinition(name){const value=definitions.find(c=>c.name===name);if(!value)throw new CommandError('UNKNOWN_COMMAND','지원하지 않는 명령입니다.');return structuredClone(value);}
export function prepareCommand(project,name,args={}){
  const definition=commandDefinition(name);assertJson(args);validate(definition.inputSchema,args);
  if(name==='templates.list')return {data:TEMPLATES.map(({id,name,category,description})=>({id,name,category,description}))};
  validateProject(project);
  if(name==='project.get')return {data:createProjectDocument(project)};
  if(name==='captions.export')return {data:{format:args.format||'srt',text:projectSubtitles(project,args)}};
  if(name==='captions.import'){
    let captions;
    try{
      captions=parseSubtitles(args.text,args.basis==='source'?project.duration:timelineDuration(project));
    }catch(error){fail(error.message||'자막 문자열을 확인하세요.','arguments.text');}
    captions=captions.map(caption=>({...caption,basis:args.basis}));
    const prepared=prepareCommand(project,'captions.replace',{captions});
    return {...prepared,data:{...prepared.data,importedCaptions:captions.length}};
  }
  if(name==='overlays.move'){
    if(!args.id.length)fail('이동할 장면 카드 ID를 입력하세요.','arguments.id');
    const from=project.overlays.findIndex(card=>card.id===args.id);
    if(from<0)throw new CommandError('NOT_FOUND','장면 카드를 찾을 수 없습니다.');
    if(!Number.isInteger(args.toIndex)||args.toIndex<0||args.toIndex>=project.overlays.length)
      fail('장면 카드의 이동 위치를 확인하세요.','arguments.toIndex');
    const data={updated:from!==args.toIndex,id:args.id,toIndex:args.toIndex,outputDuration:outputDuration(project)};
    if(!data.updated)return {data};
    const next=structuredClone(project),[card]=next.overlays.splice(from,1);
    next.overlays.splice(args.toIndex,0,card);validateProject(next);return {project:next,data};
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
    if(Object.hasOwn(args.patch,'name')&&!args.patch.name.trim())fail('프로젝트 이름을 입력하세요.','arguments.patch.name');
    Object.assign(next,args.patch);
    if(Object.hasOwn(args.patch,'ratio')&&args.patch.ratio!==project.ratio){next.zoom=1;next.panX=0;next.panY=0;}
  }else if(name==='template.apply'){
    const template=TEMPLATES.find(t=>t.id===args.templateId);if(!template)throw new CommandError('NOT_FOUND','기본 템플릿을 찾을 수 없습니다.');
    applyTemplate(next,template,args.withContent===true);
  }else if(name==='template.apply.document'){
    applyTemplate(next,readTemplateDocument(args.document),args.withContent===true);
  }else if(name==='timeline.replace')next.clips=structuredClone(args.clips);
  else if(name==='timeline.split'){
    if(!Number.isInteger(args.clipIndex)||args.clipIndex<0||args.clipIndex>=next.clips.length)
      fail('나눌 클립의 인덱스를 확인하세요.','arguments.clipIndex');
    if(next.clips.length>=MAX_CLIPS)
      fail('클립은 1,000개 이하만 지원합니다. 클립을 삭제한 뒤 다시 분할하세요.','project.clips');
    const clip=next.clips[args.clipIndex];
    if(!hasMinimumDuration(clip.start,args.sourceTime)||!hasMinimumDuration(args.sourceTime,clip.end))
      fail('클립의 시작과 끝에서 0.1초 이상 떨어진 위치를 선택하세요.','arguments.sourceTime');
    next.clips.splice(args.clipIndex,1,{start:clip.start,end:args.sourceTime},{start:args.sourceTime,end:clip.end});
  }
  else if(name==='effects.update')Object.assign(next.effects,args.patch);
  else if(name==='overlays.add'){
    if(!args.id.trim())fail('새 장면 카드 ID를 입력하세요.','arguments.id');
    if(next.overlays.some(card=>card.id===args.id))fail('이미 사용 중인 장면 카드 ID입니다.','arguments.id');
    if(next.overlays.length>=12)fail('구간별 문구는 12개까지 가능합니다.','project.overlays');
    if(args.patch.end<=args.patch.start||args.patch.end>before)
      fail('장면 카드의 표시 시간은 출력 영상의 0초부터 끝 사이에서 시작보다 끝이 늦어야 합니다.','arguments.patch');
    next.overlays.push({...newCard(before),...args.patch,id:args.id});
  }
  else if(name==='overlays.remove'){
    if(!args.id.length)fail('삭제할 장면 카드 ID를 입력하세요.','arguments.id');
    const index=next.overlays.findIndex(card=>card.id===args.id);
    if(index<0)throw new CommandError('NOT_FOUND','장면 카드를 찾을 수 없습니다.');
    next.overlays.splice(index,1);
  }
  else if(name==='overlays.update'){
    if(!args.id.length)fail('수정할 장면 카드 ID를 입력하세요.','arguments.id');
    const card=next.overlays.find(item=>item.id===args.id);
    if(!card)throw new CommandError('NOT_FOUND','장면 카드를 찾을 수 없습니다.');
    Object.assign(card,args.patch);
    if(Object.hasOwn(args.patch,'start')||Object.hasOwn(args.patch,'end')){
      if(card.start<0||card.end<=card.start||card.end>outputDuration(next))
        fail('장면 카드의 표시 시간은 출력 영상의 0초부터 끝 사이에서 시작보다 끝이 늦어야 합니다.','arguments.patch');
    }
  }
  else if(name==='title.update')Object.assign(next.design.title,args.patch);
  else if(name==='captions.style.update')Object.assign(next,args.patch);
  else if(name==='captions.replace'){
    const total=timelineDuration(next);
    for(const [i,c] of args.captions.entries())if(c.end<=c.start||c.end>(c.basis==='timeline'?total:next.duration))fail('자막 구간이 시간 기준의 범위를 벗어났습니다.',`arguments.captions[${i}]`);
    next.captions=structuredClone(args.captions);
  }
  if(name==='project.update'||name==='timeline.replace')retimeOutputLayers(next,before,outputDuration(next));
  validateProject(next);
  return {project:next,data:{updated:true,outputDuration:outputDuration(next),...(['overlays.add','overlays.remove'].includes(name)?{id:args.id}:{})}};
}
