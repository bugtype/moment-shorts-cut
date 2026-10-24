import {text,mark,t,message,setValidity} from './i18n.mjs';
import {esc} from './ui-format.mjs';
import {CommandError} from './core/validation.mjs';

// This dialog owns its file and clock choice; legacy hidden imports remain source-only.
export function createCaptionImportDialog(app,blocked) {
    const $=app.query;
    let generation=0;
    function open() {
        if(app.modal.open || blocked() || app.panel!=='captions')return;
        const project=app.state,contents=JSON.stringify(project),selected=app.selected,
            media=[app.sources.videoFile,app.sources.audioFile],owner=++generation;
        app.modalOpen(message('panels.importSrt'),
            `<label class="panel-label" for="subtitleImportFile">${text('panels.subtitleFile')}</label><input class="panel-input" id="subtitleImportFile" type="file" accept=".srt,.vtt,text/plain,text/vtt" required>`+
            `<label class="panel-label" for="subtitleImportClock">${text('panels.subtitleClock')}</label><select class="panel-select" id="subtitleImportClock"><option value="source" ${mark('panels.subtitleClockSource')}>${esc(t('panels.subtitleClockSource'))}</option><option value="output" ${mark('panels.subtitleClockOutput')}>${esc(t('panels.subtitleClockOutput'))}</option></select>`+
            `<p class="notice">${text('panels.subtitleReplaceWarning')}</p>`,
            `<div class="modal-foot"><button class="button" id="cancelSubtitleImport">${text('shell.cancel')}</button><button class="button primary" id="confirmSubtitleImport">${text('panels.subtitleReplace')}</button></div>`);
        const fileInput=$('#subtitleImportFile'),clock=$('#subtitleImportClock'),confirm=$('#confirmSubtitleImport');
        clock.value='source';
        let attempt=0,pending=false,composing=null;
        const owns=()=>generation===owner && app.modal.open && $('#confirmSubtitleImport')===confirm;
        const contextValid=()=>app.state===project && JSON.stringify(app.state)===contents && app.panel==='captions' && app.selected===selected &&
            app.sources.videoFile===media[0] && app.sources.audioFile===media[1];
        const invalidate=()=>{if(generation===owner){generation++;attempt++;}};
        const close=()=>{invalidate();app.modal.close();};
        app.modal.onreplace=invalidate;
        app.modal.onclose=()=>{if(!app.modal.open)invalidate();};
        $('#cancelSubtitleImport').onclick=()=>{if(owns()){close();if(app.panel==='captions')$('#importSrt')?.focus();}};
        confirm.onclick=async event=>{
            if(!owns() || pending || blocked() || composing || event?.isComposing || event?.keyCode===229)return;
            if(!contextValid()){app.toast(message('panels.subtitleImportStale'));return;}
            const file=fileInput.files?.[0],mode=clock.value;
            if(!file){setValidity(fileInput,'panels.subtitleChooseFile');fileInput.reportValidity?.();fileInput.focus();return;}
            if(!['source','output'].includes(mode)){app.toast(message('panels.subtitleClockInvalid'));return;}
            const token=++attempt;pending=true;confirm.disabled=true;
            const isCurrent=()=>owns() && token===attempt && fileInput.files?.[0]===file && clock.value===mode;
            try{
                const result=await app.importSrt(file,{owned:true,clock:mode,isCurrent,beforeCommit:()=>{
                    if(!isCurrent() || !contextValid() || blocked())throw new CommandError('CONFLICT',message('panels.subtitleImportStale'));
                }});
                if(!isCurrent() || result.stale || (!result.ok && (!contextValid() || blocked())))return;
                if(result.ok){close();app.focusCaption(0);app.toast(result.message);}
                else app.toast(result.error);
                return result;
            }finally{if(owns() && token===attempt){pending=false;confirm.disabled=false;}}
        };
        for(const input of [fileInput,clock]){
            input.onchange=()=>{if(owns()){attempt++;pending=false;confirm.disabled=false;setValidity(fileInput,'');}};
            input.oncompositionstart=()=>{if(owns())composing=input;};
            input.oncompositionend=()=>{if(owns()&&composing===input)composing=null;};
            // File/select Enter belongs to native activation, not form submission.
        }
        fileInput.focus();
    }
    return {open};
}
