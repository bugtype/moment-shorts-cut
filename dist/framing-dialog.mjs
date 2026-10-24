import {text,message,setValidity} from './i18n.mjs';
import {decimalTime} from './ui-format.mjs';

// Global source framing: offsets are fractions of the rendered video region.
export function createFramingDialog(app) {
    const $=app.query;
    let generation=0;
    const blocked=()=>!app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        app.audioRecording.requesting || app.audioRecording.current ||
        (app.persistence.restorePhase!=='ready' && !(app.persistence.restorePhase==='failed' && app.persistence.recoveryValid));
    function open(trigger) {
        if(app.modal.open || blocked() || !['openFraming','openPanelFraming'].includes(trigger))return;
        const project=app.state,signature=JSON.stringify(project),panel=app.panel,selected=app.selected,
            media=[app.sources.videoFile,app.sources.audioFile],owner=++generation;
        const fields=[['panX','panels.framingX',-100,100],['panY','panels.framingY',-100,100],['zoom','panels.framingZoom',100,300]];
        const displayed=Object.fromEntries(fields.map(([key])=>[key,project[key]*100]));
        const body=fields.map(([key,label,min,max])=>`<label class="panel-label" for="framing-${key}">${text(label)}</label><input class="panel-input" id="framing-${key}" type="number" step="any" min="${min}" max="${max}" required>`).join('');
        app.modalOpen(message('panels.framing'),body,`<div class="modal-foot"><button class="button" id="cancelFraming">${text('shell.cancel')}</button><button class="button primary" id="applyFraming">${text('panels.positionApply')}</button></div>`);
        const confirm=$('#applyFraming'),inputs=Object.fromEntries(fields.map(([key])=>[key,$('#framing-'+key)]));
        const owns=()=>generation===owner && app.modal.open && $('#applyFraming')===confirm;
        const invalidate=()=>{if(generation===owner)generation++;};
        const close=()=>{
            invalidate();app.modal.close();
            if(!app.modal.open && app.panel===panel && app.selected===selected)$('#'+trigger)?.focus();
        };
        let composing=null;
        app.modal.onreplace=invalidate;
        app.modal.onclose=()=>{if(!app.modal.open)invalidate();};
        $('#cancelFraming').onclick=()=>{if(owns())close();};
        confirm.onclick=event=>{
            if(!owns() || blocked() || composing || event?.isComposing || event?.keyCode===229)return;
            if(app.state!==project || JSON.stringify(app.state)!==signature || app.panel!==panel || app.selected!==selected ||
                app.sources.videoFile!==media[0] || app.sources.audioFile!==media[1]){
                app.toast(message('panels.framingStale'));return;
            }
            const patch={};
            for(const [key,,min,max] of fields){
                const value=inputs[key].value.trim()===''?NaN:Number(inputs[key].value);
                if(value===displayed[key])continue;
                if(!Number.isFinite(value)||value<min||value>max){
                    setValidity(inputs[key],'panels.positionInvalid',{min,max});inputs[key].reportValidity?.();inputs[key].focus();return;
                }
                patch[key]=value/100;
            }
            if(!Object.keys(patch).length){close();return;}
            if(app.runEditorCommand('project.update',{patch})&&owns())close();
        };
        for(const [key] of fields){
            const input=inputs[key];input.value=decimalTime(displayed[key]);
            input.oncompositionstart=()=>{if(owns())composing=input;};
            input.oncompositionend=()=>{if(owns()&&composing===input)composing=null;};
            input.oninput=()=>{if(owns())setValidity(input,'');};
            input.onkeydown=event=>{
                if(!owns()||composing||event.defaultPrevented||event.key!=='Enter'||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
                event.preventDefault();confirm.onclick(event);
            };
        }
        inputs.panX.focus();
    }
    return {open};
}
