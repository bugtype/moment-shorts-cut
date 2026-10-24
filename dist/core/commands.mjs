import { commandDefinition, isBatchCommand } from './command-catalog.mjs';
import { outputDimensions } from './aspect-ratio.mjs';
import { assignCaptionSpeaker } from './caption-speakers.mjs';
import { inspectCaptionOverlaps } from './caption-overlaps.mjs';
import { message as msg } from '../i18n.mjs';
import { inspectCaptions } from './caption-inspection.mjs';
import { shiftCaptionTiming } from './caption-timing.mjs';
import { readTemplateDocument, createTemplateDocument } from '../template-library.mjs';
import { replaceCaptionText } from './caption-text.mjs';
import { TEMPLATES, REFERENCE_SOURCES, applyTemplate, saveCustomTemplate } from '../template-catalog.mjs';
import { newCard, retimeOutputLayers, splitCaptionAtOffset } from '../effects.mjs';
import { MAX_CAPTIONS, parseSubtitles } from '../captions.mjs';
import { outputDuration, timelineDuration, createDemoProject, validateProject, createProjectDocument, readProjectDocument, projectSubtitles, MAX_CLIPS } from './project.mjs';
import { validate, assertJson, fail, CommandError, hasMinimumDuration } from './validation.mjs';

export { API_VERSION, commandDefinitions, commandDefinition } from './command-catalog.mjs';

const previewFields = [...new Set([...Object.keys(createDemoProject()), 'templateId'])].sort();
export function prepareCommand(project,name,args={}){
  const definition=commandDefinition(name);assertJson(args);validate(definition.inputSchema,args);
  if(name==='templates.list')return {data:TEMPLATES.map(({id,name,category,description})=>({id,name,category,description}))};
  validateProject(project);
  if(name==='project.preview'){
    const prepared=prepareCommand(project,'project.batch',args),next=prepared.project||project;
    const summary=p=>({clipCount:p.clips.length,captionCount:p.captions.length,cardCount:p.overlays.length,outputDuration:outputDuration(p)});
    return {data:{operationCount:args.operations.length,wouldCommit:!!prepared.project,
      changedFields:previewFields.filter(key=>JSON.stringify(project[key])!==JSON.stringify(next[key])),
      before:summary(project),after:summary(next)}};
  }
  if(name==='project.batch'){
    let next=project,updated=false;
    for(const [index,operation] of args.operations.entries()){
      const path=`arguments.operations[${index}]`;
      if(!isBatchCommand(operation.command))fail(msg('errors.batchCommand'),`${path}.command`);
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
  if(name==='template.inspect'){
    const next=prepareCommand(project,'template.apply',args).project;
    const template=TEMPLATES.find(item=>item.id===args.templateId),title=next.design.title,credit=next.design.credit;
    return {data:structuredClone({
      template:{id:template.id,name:template.name,category:template.category,tag:template.tag,
        description:template.description,flow:template.flow,exampleTitle:template.title,
        reference:REFERENCE_SOURCES[template.source]||null},
      withContent:args.withContent===true,outputDuration:outputDuration(next),
      title:{lines:title.lines,enabled:title.enabled,start:title.start,end:title.end},
      credit:{text:credit.text,enabled:credit.enabled,start:credit.start,end:credit.end},
      cards:next.overlays.map((card,index)=>({index,role:card.role,text:card.text,detail:card.detail,
        label:card.label,enabled:card.enabled,start:card.start,end:card.end})),
    })};
  }
  if(name==='template.export'){
    if(!args.name.trim())fail(msg('errors.exportTemplateName'),'arguments.name');
    if(!args.id.trim())fail(msg('errors.exportTemplateId'),'arguments.id');
    const template=saveCustomTemplate(args.name,project,{id:args.id});
    template.description='프로젝트에서 캡처한 스타일과 장면 카드입니다.';
    return {data:createTemplateDocument(template)};
  }
  if(name==='project.get')return {data:createProjectDocument(project)};
  if(name==='timeline.list'){
    const offset=args.offset===undefined?0:args.offset,limit=args.limit===undefined?20:args.limit;
    if(!Number.isInteger(offset)||offset<0||offset>MAX_CLIPS)fail(msg('errors.timelineListOffset'),'arguments.offset');
    if(!Number.isInteger(limit)||limit<1||limit>50)fail(msg('errors.timelineListLimit'),'arguments.limit');
    const clips=[];let position=0;
    // Match playback's prefix accumulation; do not round or retime source intervals.
    for(let clipIndex=0;clipIndex<Math.min(project.clips.length,offset+limit);clipIndex++){
      const clip=project.clips[clipIndex],timelineStart=position;
      position+=clip.end-clip.start;
      if(clipIndex>=offset)clips.push({clipIndex,sourceStart:clip.start,sourceEnd:clip.end,
        timelineStart,timelineEnd:position,outputStart:timelineStart/project.speed,outputEnd:position/project.speed});
    }
    const totalClips=project.clips.length,next=offset+clips.length;
    return {data:{totalClips,offset,limit,nextOffset:next<totalClips?next:null,speed:project.speed,clips}};
  }
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
    const count=Object.hasOwn(args,'count')?args.count:1;
    if(!Number.isInteger(count)||count<1||count>MAX_CLIPS||args.clipIndex+count>project.clips.length)
      fail(msg('errors.duplicateClipCount'),'arguments.count');
    if(project.clips.length+count>MAX_CLIPS)fail(msg('errors.clipLimit'),'project.clips');
    const clips=structuredClone(project.clips);
    const copies=structuredClone(clips.slice(args.clipIndex,args.clipIndex+count));
    clips.splice(args.clipIndex+count,0,...copies);
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
    const count=args.count===undefined?1:args.count;
    if(!Number.isInteger(count)||count<1||count>MAX_CAPTIONS||index+count>project.captions.length)
      fail(msg('errors.removeCaptionCount'),'arguments.count');
    const next=structuredClone(project);next.captions.splice(index,count);validateProject(next);
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
  if(name==='captions.speaker.assign'){
    const result=assignCaptionSpeaker(project.captions,args);
    const data={updated:result.changedCaptions>0,changedCaptions:result.changedCaptions,outputDuration:outputDuration(project)};
    if(!data.updated)return {data};
    const next=structuredClone(project);next.captions=structuredClone(result.captions);
    validateProject(next);return {project:next,data};
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
    const quality=args.quality||1080, {width,height}=outputDimensions(project.ratio,quality);
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
  else if(name==='captions.style.update')Object.assign(next,structuredClone(args.patch));
  else if(name==='captions.replace'){
    const total=timelineDuration(next);
    for(const [i,c] of args.captions.entries())if(c.end<=c.start||c.end>(c.basis==='timeline'?total:next.duration))fail(msg('errors.captionClock'),`arguments.captions[${i}]`);
    next.captions=structuredClone(args.captions);
  }
  if(name==='project.update'||name==='timeline.replace')retimeOutputLayers(next,before,outputDuration(next));
  validateProject(next);
  return {project:next,data:{updated:true,outputDuration:outputDuration(next),...(['overlays.add','overlays.remove'].includes(name)?{id:args.id}:{})}};
}
