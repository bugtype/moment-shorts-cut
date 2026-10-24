import {setText, message, formatError} from './i18n.mjs';
import {replaceCaptionText} from './core/caption-text.mjs';

// Authored-text review owns only its search cursor/drafts, never project state.
export function createCaptionSearch({query:$, getProject, focusCaption, edit, execute, toast, blocked}) {
    const fields = {find:'', replacement:''};
    let project = null, query = '', selected = null, anchor = null;
    function* matches() {
        if (!query || query.length > 2000) return;
        const captions = getProject().captions;
        for (let index=0; index<captions.length; index++) {
            const caption=captions[index];
            for (let start=caption.text.indexOf(query); start>=0; start=caption.text.indexOf(query,start+query.length))
                yield {caption,index,start,text:caption.text};
        }
    }
    function sync() {
        if (project!==getProject() || query!==fields.find) {
            project=getProject(); query=fields.find; selected=null; anchor=null;
        }
        if (selected && (!project.captions.includes(selected.caption) || selected.caption.text!==selected.text)) selected=null;
        if (anchor && (project.captions[anchor.index]!==anchor.caption || anchor.caption.text!==anchor.text)) anchor=null;
    }
    function update() {
        sync();
        let count=0, current=0;
        for (const match of matches()) {
            count++;
            if (selected?.caption===match.caption && selected.start===match.start) { current=count; selected=match; }
        }
        if (!current) selected=null;
        setText($('#captionSearchStatus'),'panels.searchStatus',{current,count});
        $('#previousCaptionMatch').disabled=!count;
        $('#nextCaptionMatch').disabled=!count;
        $('#replaceCaptionMatch').disabled=!selected || fields.find===fields.replacement;
        const button=$('#replaceAllCaptions');
        setText(button,'panels.replaceAll'); button.disabled=!fields.find;
        if (fields.find) try {
            const result=replaceCaptionText(getProject().captions,fields);
            setText(button,'panels.replaceMatches',{count:result.matches}); button.disabled=!result.changedCaptions;
        } catch { button.disabled=false; }
    }
    function navigate(direction) {
        if (blocked()) return;
        sync();
        const index=selected ? project.captions.indexOf(selected.caption) : anchor?.index;
        const start=selected?.start ?? anchor?.start;
        let first=null,last=null,target=null;
        for (const match of matches()) {
            first ||= match; last=match;
            const ahead=index===undefined || match.index>index || (match.index===index && (anchor ? match.start>=start : match.start>start));
            const behind=index===undefined || match.index<index || (match.index===index && match.start<start);
            if (direction>0 && !target && ahead) target=match;
            if (direction<0 && behind) target=match;
        }
        selected=target || (direction>0 ? first : last); anchor=null;
        update();
        if (!selected) return;
        const match=selected;
        focusCaption(match.index);
        $(`[data-caption-text="${match.index}"]`)?.setSelectionRange(match.start,match.start+query.length);
    }
    function replaceMatch() {
        if (blocked()) return;
        const match=selected, current=getProject();
        if (!match || project!==current || query!==fields.find || current.captions[match.index]!==match.caption || match.caption.text!==match.text ||
            $(`[data-caption-text="${match.index}"]`)?.value!==match.text) {
            toast(message('panels.searchStale')); return;
        }
        if (fields.find===fields.replacement) return;
        const replacement=fields.replacement;
        let key='';
        if (!query || query.length>2000) key='errors.findLength';
        else if (replacement.length>2000) key='errors.replacementLength';
        const value=match.text.slice(0,match.start)+replacement+match.text.slice(match.start+query.length);
        if (!key && value.length>2000) key='errors.replacedTooLong';
        if (!key && !value.trim()) key='errors.replacedEmpty';
        if (key) { toast(message(key)); return; }
        if (!execute('captions.update',{captionIndex:match.index,patch:{text:value}})) return;
        project=getProject(); query=fields.find; selected=null;
        anchor={index:match.index,caption:project.captions[match.index],text:value,start:match.start+replacement.length};
        update(); focusCaption(match.index);
        $(`[data-caption-text="${match.index}"]`)?.setSelectionRange(match.start,anchor.start);
    }
    function replaceAll() {
        if (blocked()) return;
        try {
            const result=replaceCaptionText(getProject().captions,fields);
            if (!result.changedCaptions) { update(); return; }
            let applied=false;
            edit(()=>{getProject().captions=result.captions;applied=true;},true);
            if (!applied) return;
            update(); $('#captionFind').focus({preventScroll:true});
            toast(message('panels.replaced',{count:result.changedCaptions}));
        } catch(error) { toast(error.messageKey ? error : formatError(error)); }
    }
    function bind() {
        for (const [id,key] of [['captionFind','find'],['captionReplacement','replacement']]) {
            const input=$('#'+id); input.value=fields[key];
            input.oninput=()=>{fields[key]=input.value;update();};
        }
        for (const [id,direction] of [['previousCaptionMatch',-1],['nextCaptionMatch',1]])
            $('#'+id).onclick=event=>{if (!event?.isComposing && event?.keyCode!==229) navigate(direction);};
        $('#replaceAllCaptions').onclick=event=>{
            if (!event?.isComposing && event?.keyCode!==229) replaceAll();
        };
        $('#replaceCaptionMatch').onclick=event=>{
            if (!event?.isComposing && event?.keyCode!==229) replaceMatch();
        };
        update();
    }
    return {bind,update};
}
