import { TEMPLATES, applyTemplate } from '../template-catalog.mjs';
import { retimeOutputLayers } from '../effects.mjs';
import { MAX_CAPTIONS } from '../captions.mjs';
import { outputDuration, timelineDuration, validateProject, createProjectDocument, readProjectDocument, projectSubtitles, clipSchema, captionSchema, MAX_CLIPS } from './project.mjs';
import { object, string, number, choice, boolean, array, validate, assertJson, fail, CommandError } from './validation.mjs';

export const API_VERSION=1;
const patchSchema=object({name:string(200),ratio:choice('9:16','1:1','16:9'),fit:choice('cover','contain'),zoom:number(1,3),panX:number(-1,1),panY:number(-1,1),speed:number(.25,4),volume:number(0,1),audioVolume:number(0,1)});
const titleSchema=object({lines:array(string(200),2,2),colors:array(string(9),2,2),enabled:boolean,x:number(.05,.95),y:number(.06,.93),size:number(18,72),stroke:number(0,12),italic:boolean,start:number(0,86400),end:{type:['number','null'],minimum:0,maximum:86400}});
const command=(name,description,inputSchema,mutates=false)=>({name,description,inputSchema,mutates});
const definitions=[
  command('project.get','편집 설정을 이식 가능한 JSON으로 읽습니다. 미디어 파일은 포함하지 않습니다.',object()),
  command('project.update','이름, 화면 비율, 구도, 배속과 볼륨을 수정합니다.',object({patch:patchSchema},['patch']),true),
  command('project.import','검증된 편집 설정 JSON을 적용합니다. 미디어 파일은 별도로 연결해야 합니다.',object({document:{type:'object'}},['document']),true),
  command('templates.list','기본 템플릿 목록을 읽습니다.',object()),
  command('template.apply','기본 템플릿을 적용합니다. withContent=true는 제목과 구간 문구를 예시로 교체합니다.',object({templateId:string(100),withContent:boolean},['templateId']),true),
  command('timeline.replace','원본 영상 시간 기준 클립 목록을 교체합니다.',object({clips:array(clipSchema,MAX_CLIPS,1)},['clips']),true),
  command('title.update','기본 제목의 두 줄 문구와 스타일을 수정합니다.',object({patch:titleSchema},['patch']),true),
  command('captions.replace','자막을 교체합니다. source는 원본, timeline은 배속 전 편집 시간입니다.',object({captions:array(captionSchema,MAX_CAPTIONS)},['captions']),true),
  command('captions.export','편집 구간과 배속을 반영한 SRT 또는 WebVTT 문자열을 반환합니다.',object({format:choice('srt','vtt')})),
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
  }else if(name==='timeline.replace')next.clips=structuredClone(args.clips);
  else if(name==='title.update')Object.assign(next.design.title,args.patch);
  else if(name==='captions.replace'){
    const total=timelineDuration(next);
    for(const [i,c] of args.captions.entries())if(c.end<=c.start||c.end>(c.basis==='timeline'?total:next.duration))fail('자막 구간이 시간 기준의 범위를 벗어났습니다.',`arguments.captions[${i}]`);
    next.captions=structuredClone(args.captions);
  }
  if(name==='project.update'||name==='timeline.replace')retimeOutputLayers(next,before,outputDuration(next));
  validateProject(next);
  return {project:next,data:{updated:true,outputDuration:outputDuration(next)}};
}
