import {MAX_CLIPS,validateProject} from './project.mjs';
import {hasMinimumDuration,fail} from './validation.mjs';
import {message} from '../i18n.mjs';

// Complement a source-time union, not the order or multiplicity of edited clips.
export function complementSourceClips(project) {
    validateProject(project);
    const sorted=project.clips.map(({start,end})=>({start,end})).sort((a,b)=>a.start-b.start||a.end-b.end);
    const union=[];
    for(const clip of sorted){
        const last=union.at(-1);
        if(last && clip.start<=last.end)last.end=Math.max(last.end,clip.end);
        else union.push(clip);
    }
    const gaps=[];
    let cursor=0;
    const append=(start,end)=>{
        if(end<=start)return;
        if(!hasMinimumDuration(start,end))fail(message('panels.keepGapsTooShort'),'project.clips');
        if(gaps.length>=MAX_CLIPS)fail(message('panels.keepGapsLimit'),'project.clips');
        gaps.push({start,end});
    };
    for(const clip of union){append(cursor,clip.start);cursor=clip.end;}
    append(cursor,project.duration);
    if(!gaps.length)fail(message('panels.keepGapsEmpty'),'project.clips');
    return gaps;
}
