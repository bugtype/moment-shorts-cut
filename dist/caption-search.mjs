import {setText, message, formatError} from './i18n.mjs';
import {replaceCaptionText, inspectCaptionTextReplacement} from './core/caption-text.mjs';

// Authored-text review owns only its search cursor/drafts, never project state.
export function createCaptionSearch({query:$, getProject, focusCaption, edit, execute, toast, blocked, replaceRange}) {
    const fields = {find:'', replacement:''};
    let project = null, query = '', selected = null, anchor = null;
    const displayedText = text => text.replace(/\r\n?/g, '\n');
    function matchesDisplayedText(value, text) {
        return value===text || value===displayedText(text);
    }
    function selectText(index, text, start, end) {
        const input=$(`[data-caption-text="${index}"]`);
        if (!input) return;
        const first=displayedText(text.slice(0,start)).length;
        const last=start===end ? first : displayedText(text.slice(0,end)).length;
        // A nonempty match of either CRLF half selects the displayed LF; a caret stays collapsed.
        const insidePair=start!==end && text[start-1]==='\r' && text[start]==='\n';
        input.setSelectionRange(first-(insidePair ? 1 : 0),last);
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
        if (query && query.length <= 2000) {
            const captions = project.captions;
            for (let index = 0; index < captions.length; index++) {
                const caption = captions[index];
                for (let start = caption.text.indexOf(query); start >= 0;
                    start = caption.text.indexOf(query, start + query.length)) {
                    count++;
                    if (selected?.caption === caption && selected.start === start) {
                        current = count;
                        selected.index = index;
                    }
                }
            }
        }
        if (!current) selected=null;
        setText($('#captionSearchStatus'),'panels.searchStatus',{current,count});
        $('#previousCaptionMatch').disabled=!count;
        $('#nextCaptionMatch').disabled=!count;
        $('#replaceCaptionMatch').disabled=!selected || fields.find===fields.replacement;
        if ($('#replaceCaptionRange')) $('#replaceCaptionRange').disabled=!fields.find || !project.captions.length;
        const button=$('#replaceAllCaptions');
        setText(button,'panels.replaceAll'); button.disabled=!fields.find;
        if (fields.find) try {
            const result=inspectCaptionTextReplacement(getProject().captions,fields);
            setText(button,'panels.replaceMatches',{count:result.matches}); button.disabled=!result.changedCaptions;
        } catch { button.disabled=false; }
    }
    function navigate(direction) {
        if (blocked()) return;
        sync();
        const index=selected ? project.captions.indexOf(selected.caption) : anchor?.index;
        const start=selected?.start ?? anchor?.start;
        // Keep positions only: dense matches must not allocate one object each.
        let firstIndex = -1, firstStart = 0, lastIndex = -1, lastStart = 0;
        let targetIndex = -1, targetStart = 0;
        if (query && query.length <= 2000) {
            for (let captionIndex = 0; captionIndex < project.captions.length; captionIndex++) {
                const text = project.captions[captionIndex].text;
                for (let offset = text.indexOf(query); offset >= 0; offset = text.indexOf(query, offset + query.length)) {
                    if (firstIndex < 0) { firstIndex = captionIndex; firstStart = offset; }
                    lastIndex = captionIndex;
                    lastStart = offset;
                    const ahead = index === undefined || captionIndex > index ||
                        (captionIndex === index && (anchor ? offset >= start : offset > start));
                    const behind = index === undefined || captionIndex < index ||
                        (captionIndex === index && offset < start);
                    if ((direction > 0 && targetIndex < 0 && ahead) || (direction < 0 && behind)) {
                        targetIndex = captionIndex;
                        targetStart = offset;
                    }
                }
            }
        }
        if (targetIndex < 0) {
            targetIndex = direction > 0 ? firstIndex : lastIndex;
            targetStart = direction > 0 ? firstStart : lastStart;
        }
        const caption = project.captions[targetIndex];
        selected = caption ? {caption, index: targetIndex, start: targetStart, text: caption.text} : null;
        anchor = null;
        update();
        if (!selected) return;
        const match=selected;
        focusCaption(match.index);
        selectText(match.index,match.text,match.start,match.start+query.length);
    }
    function replaceMatch() {
        if (blocked()) return;
        const match=selected, current=getProject();
        if (!match || project!==current || query!==fields.find || current.captions[match.index]!==match.caption || match.caption.text!==match.text ||
            !matchesDisplayedText($(`[data-caption-text="${match.index}"]`)?.value,match.text)) {
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
        selectText(match.index,value,match.start,anchor.start);
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
        const range = $('#replaceCaptionRange');
        if (range) range.onclick=event=>{
            if ($('#replaceCaptionRange')!==range || blocked() || event?.isComposing || event?.keyCode===229) return;
            sync();
            const find=fields.find, replacement=fields.replacement;
            replaceRange?.({find,replacement,index:selected?.index,
                isCurrent:()=>fields.find===find && fields.replacement===replacement &&
                    $('#captionFind').value===find && $('#captionReplacement').value===replacement});
        };
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
