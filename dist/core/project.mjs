import { defaultEnhancements } from '../effects.mjs';
import { defaultDesign, migrateProject, DESIGN_VERSION } from '../typography.mjs';
import { editedCaptions, MAX_CAPTIONS, MAX_SUBTITLE_BYTES, captionOutputLimit } from '../captions.mjs';
import { assertJson, validate, object, string, number, choice, array, fail, CommandError } from './validation.mjs';

export function createDemoProject(){return {...defaultEnhancements(),name:'나의 첫 번째 쇼츠',kind:'demo',fileName:'느리게 걷는 하루 · 샘플',duration:12,clips:[{start:0,end:12}],ratio:'9:16',fit:'cover',zoom:1,panX:0,panY:0,volume:1,speed:1,schemaVersion:4,design:defaultDesign(),style:'impact',captionSize:36,captionY:.55,captionX:.47,captionColor:'#ffffff',captionAccent:'#b5ff00',captionStroke:3,captionItalic:true,captionAnimation:'pop',captions:[{start:0,end:4,text:'잠깐, 쉬어가도 괜찮아'},{start:4,end:8,text:'나만의 속도로 걷는 하루'},{start:8,end:12,text:'오늘의 순간을 기록해요'}],audioName:'',audioOffset:0,audioVolume:.7};}

export const MAX_CLIPS=1000;
export const FORMAT='moment-project';
export const FORMAT_VERSION=1;
export const timelineDuration=p=>p.clips.reduce((sum,c)=>sum+c.end-c.start,0);
export const outputDuration=p=>timelineDuration(p)/p.speed;
export const clipSchema=object({start:number(0,86400),end:number(0,86400)},['start','end']);
export const captionSchema=object({start:number(0,86400),end:number(0,86400),text:string(2000),basis:choice('source','timeline'),speaker:choice('','0','1'),keywords:string(500),timing:choice('estimated')},['start','end','text']);

function compatible(value,example,path){
  if(example===null){if(value!==null&&!Number.isFinite(value))fail('종료 시간은 숫자 또는 null이어야 합니다.',path);return;}
  if(Array.isArray(example)){
    if(!Array.isArray(value)||value.length>10000)fail('배열을 확인하세요.',path);
    if(example.length)value.forEach((item,i)=>compatible(item,example[0],`${path}[${i}]`));
  }else if(typeof example==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))fail('객체가 필요합니다.',path);
    for(const key of Object.keys(example))compatible(value[key],example[key],`${path}.${key}`);
  }else if(typeof value!==typeof example||(typeof example==='number'&&!Number.isFinite(value)))fail('프로젝트 필드 형식이 올바르지 않습니다.',path);
}
export function validateProject(project){
  assertJson(project);
  if(project.schemaVersion!==DESIGN_VERSION)throw new CommandError('UNSUPPORTED_VERSION','지원하지 않는 프로젝트 버전입니다.');
  compatible(project,createDemoProject(),'project');
  const p=project;
  validate(object({duration:number(.001,86400),speed:number(.25,4),ratio:choice('9:16','1:1','16:9'),fit:choice('cover','contain'),kind:choice('demo','video'),clips:array(clipSchema,MAX_CLIPS,1)},['duration','speed','ratio','fit','kind','clips']),{duration:p.duration,speed:p.speed,ratio:p.ratio,fit:p.fit,kind:p.kind,clips:p.clips},'project');
  for(const [i,c] of p.clips.entries())if(c.end<=c.start||c.end>p.duration)fail('클립 구간이 원본 영상 범위를 벗어났습니다.',`project.clips[${i}]`);
  const bounded={zoom:[1,3],panX:[-1,1],panY:[-1,1],volume:[0,1],audioVolume:[0,1],audioOffset:[0,86400],captionSize:[10,120],captionX:[0,1],captionY:[0,1],captionStroke:[0,20]};
  for(const [key,[min,max]] of Object.entries(bounded))validate(number(min,max),p[key],`project.${key}`);
  validate(choice('framed','full'),p.design.layout,'project.design.layout');
  validate(choice('impact','accent','highlight','minimal'),p.style,'project.style');
  validate(choice('none','fade','slide','pop'),p.captionAnimation,'project.captionAnimation');
  validate(choice('none','in','out'),p.effects.motion,'project.effects.motion');
  validate(choice('none','fadeBlack','flash'),p.effects.transition,'project.effects.transition');
  validate(choice('top','bottom'),p.effects.progressPosition,'project.effects.progressPosition');
  for(const [key,[min,max]] of Object.entries({strength:[0,.4],transitionDuration:[.05,.7],brightness:[.7,1.3],contrast:[.7,1.5],saturation:[0,1.6],vignette:[0,.6]}))validate(number(min,max),p.effects[key],`project.effects.${key}`);
  validate(number(.15,.4),p.design.top,'project.design.top');validate(number(.4,.91),p.design.bottom,'project.design.bottom');
  validate(number(0,20),p.design.title.stroke,'project.design.title.stroke');
  validate(array(captionSchema,MAX_CAPTIONS),p.captions,'project.captions');
  for(const [i,c] of p.captions.entries())if(c.end<=c.start)fail('자막 끝은 시작보다 늦어야 합니다.',`project.captions[${i}]`);
  for(const [key,l] of Object.entries({title:p.design.title,credit:p.design.credit})){
    for(const axis of ['x','y'])validate(number(0,1),l[axis],`project.design.${key}.${axis}`);
    validate(number(10,120),l.size,`project.design.${key}.size`);
    if(l.start<0||(l.end!==null&&l.end<=l.start))fail('글자 표시 시간을 확인하세요.',`project.design.${key}`);
  }
  validate(array(string(200),2,2),p.design.title.lines,'project.design.title.lines');
  validate(array(string(20),2,2),p.design.title.colors,'project.design.title.colors');
  validate(array(string(80),2,2),p.speakerLabels,'project.speakerLabels');
  validate(array(string(20),2,2),p.speakerColors,'project.speakerColors');
  if(p.overlays.length>12)fail('구간별 문구는 12개까지 가능합니다.','project.overlays');
  const ids=new Set();
  for(const [i,c] of p.overlays.entries()){
    const path=`project.overlays[${i}]`;
    for(const k of ['id','text','detail','label','color','accent','background'])validate(string(2000),c[k],`${path}.${k}`);
    if(!c.id||ids.has(c.id))fail('문구 ID는 비어 있거나 중복될 수 없습니다.',path);ids.add(c.id);
    for(const k of ['x','y','width','backgroundOpacity'])validate(number(0,1),c[k],`${path}.${k}`);
    validate(number(10,120),c.size,`${path}.size`);validate(number(0,20),c.stroke,`${path}.stroke`);
    validate(choice('plain','panel'),c.presentation,`${path}.presentation`);validate(choice('headline','free'),c.role,`${path}.role`);
    validate(choice('none','fade','slide','pop'),c.animation,`${path}.animation`);validate(choice('card','countdown'),c.kind,`${path}.kind`);
    if(typeof c.enabled!=='boolean'||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start)fail('문구 표시 값과 시간을 확인하세요.',path);
  }
  for(const color of [p.captionColor,p.captionAccent,p.design.background,...p.design.title.colors,p.design.credit.color,p.effects.progressColor,...p.speakerColors,...p.overlays.flatMap(c=>[c.color,c.accent,c.background])])if(!/^#[\da-f]{6}([\da-f]{2})?$/i.test(color))fail('색상은 #RRGGBB 또는 #RRGGBBAA 형식이어야 합니다.','project.colors');
  return p;
}
export function createProjectDocument(project){validateProject(project);return {format:FORMAT,formatVersion:FORMAT_VERSION,project:structuredClone(project)};}
export function readProjectDocument(document){
  assertJson(document);
  if(document?.format!==FORMAT||document.formatVersion!==FORMAT_VERSION)throw new CommandError('UNSUPPORTED_VERSION','지원하는 moment-project 파일이 아닙니다.');
  if(!document.project||!Number.isInteger(document.project.schemaVersion)||document.project.schemaVersion<1||document.project.schemaVersion>DESIGN_VERSION)throw new CommandError('UNSUPPORTED_VERSION','지원하지 않는 프로젝트 버전입니다.');
  // Only legacy versions need defaults. Repairing a malformed current document
  // would silently replace the user's authored settings during import.
  const project=structuredClone(document.project);
  return validateProject(project.schemaVersion===DESIGN_VERSION?project:migrateProject(project,createDemoProject()));
}
export function srtTimestamp(t){const ms=Math.round(t*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;}
export function projectSrt(p,{bom=false}={}){
  const chunks=[],encoder=new TextEncoder();let bytes=bom?3:0;
  for(const [i,c] of editedCaptions(p.captions,p.clips,p.speed).entries()){
    const start=srtTimestamp(c.start),end=srtTimestamp(c.end);
    if(start===end)fail(`SRT 출력 ${i+1}번째 자막의 시작과 끝이 밀리초 단위에서 같습니다. 자막 구간이나 배속을 조정한 뒤 다시 저장하세요.`);
    const lines=c.text.replace(/\r\n?/g,'\n');
    if(/^[ \t]*$/m.test(lines))fail(`SRT 출력 ${i+1}번째 자막에 빈 줄이 있습니다. 빈 줄을 제거한 뒤 다시 저장하세요.`);
    const text=lines.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\u00a0/g,'&nbsp;');
    const chunk=`${i+1}\n${start} --> ${end}\n${text}\n`;
    bytes+=encoder.encode(chunk).byteLength+(i?1:0);
    if(bytes>MAX_SUBTITLE_BYTES)captionOutputLimit('SRT 파일은 UTF-8 2 MiB까지 저장할 수 있습니다. 반복 클립이나 자막을 줄여 주세요.');
    chunks.push(chunk);
  }
  return chunks.length?(bom?'\ufeff':'')+chunks.join('\n'):'';
}
