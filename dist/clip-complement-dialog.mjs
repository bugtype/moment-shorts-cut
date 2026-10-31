import {complementSourceClips} from './core/timeline-complement.mjs';
import {outputDuration} from './core/project.mjs';
import {text,message,formatError} from './i18n.mjs';
import {decimalTime} from './ui-format.mjs';
import { metadataEditBlocked } from './metadata-edit-availability.mjs';

export function createClipComplementDialog(app) {
    const $=app.query;
    let generation=0;
    const blocked=()=>metadataEditBlocked(app);
    function open(trigger) {
        if(blocked()||app.modal.open||!['keepGapsButton','keepPanelGaps'].includes(trigger))return;
        const project=app.state,signature=JSON.stringify(project),panel=app.panel,selected=app.selected,
            media=[app.sources.videoFile,app.sources.audioFile];
        let clips;
        try{clips=complementSourceClips(project);}catch(error){app.toast(error.messageKey?error:formatError(error));return;}
        const owner=++generation;
        app.modalOpen(message('panels.keepGaps'),`${text('panels.keepGapsWarning')}<p>${text('panels.keepGapsSummary',{count:clips.length,duration:decimalTime(outputDuration({...project,clips}))})}</p><div id="gapPreview"></div>`,
            `<div class="modal-foot"><button class="button" id="cancelKeepGaps">${text('shell.cancel')}</button><button class="button primary" id="confirmKeepGaps">${text('panels.keepGapsConfirm')}</button></div>`);
        const confirm=$('#confirmKeepGaps');let page=0,composing=false,previewGeneration=0;
        const owns=()=>generation===owner&&app.modal.open&&$('#confirmKeepGaps')===confirm;
        const valid=()=>app.state===project&&JSON.stringify(app.state)===signature&&app.panel===panel&&app.selected===selected&&
            app.sources.videoFile===media[0]&&app.sources.audioFile===media[1];
        const invalidate=()=>{if(generation===owner)generation++;};
        const focus=()=>{if(!app.modal.open&&app.panel===panel)$('#'+trigger)?.focus();};
        const close=()=>{invalidate();app.modal.close();focus();};
        app.modal.onreplace=invalidate;app.modal.onclose=()=>{if(!app.modal.open)invalidate();};
        $('#cancelKeepGaps').onclick=()=>{if(owns())close();};
        const preview=()=>{
            const render=++previewGeneration,start=page*20,end=Math.min(clips.length,start+20);
            $('#gapPreview').innerHTML=`<ol start="${start+1}">${clips.slice(start,end).map(clip=>`<li>${text('panels.keepGapsInterval',{start:decimalTime(clip.start),end:decimalTime(clip.end)})}</li>`).join('')}</ol>`+
                (clips.length<=20?'':`<div class="panel-actions"><button class="button" id="previousGapPage" ${page===0?'disabled':''}>${text('panels.previous')}</button><span role="status">${start+1}–${end} / ${clips.length}</span><button class="button" id="nextGapPage" ${end===clips.length?'disabled':''}>${text('panels.next')}</button></div>`);
            if(clips.length<=20)return;
            for(const [id,delta] of [['previousGapPage',-1],['nextGapPage',1]]){
                const button=$('#'+id);button.onclick=event=>{
                    if(!owns()||!valid()||blocked()||composing||render!==previewGeneration||$('#'+id)!==button||event?.isComposing||event?.keyCode===229)return;
                    page=Math.max(0,Math.min(Math.ceil(clips.length/20)-1,page+delta));preview();
                    const preferred=$('#'+id);(preferred.disabled?$(delta>0?'#previousGapPage':'#nextGapPage'):preferred).focus();
                };
            }
        };
        preview();
        app.modal.oncompositionstart=()=>{if(owns())composing=true;};app.modal.oncompositionend=()=>{if(owns())composing=false;};
        confirm.onclick=event=>{
            if(!owns()||blocked()||composing||event?.isComposing||event?.keyCode===229)return;
            if(!valid()){app.toast(message('panels.clipMoveStale'));return;}
            if(!app.runEditorCommand('timeline.replace',{clips}))return;
            app.selected=0;
            const restore=owns();if(restore){invalidate();app.modal.close();}
            app.renderTimeline();app.renderInspector();
            if(panel!=='templates'||app.panel!=='templates')app.renderPanel();
            app.seekTo(0);
            if(restore)focus();
        };
        $('#cancelKeepGaps').focus();
    }
    return {open};
}
