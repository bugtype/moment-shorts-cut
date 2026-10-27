import { dialogEnterBlocked } from './dialog-enter.mjs';
import {text, message, setValidity} from './i18n.mjs';
import {decimalTime} from './ui-format.mjs';
import { metadataEditBlocked } from './metadata-edit-availability.mjs';

// Explicit two-axis commit; percentages never round-trip unchanged model coordinates.
export function createPositionDialog(app) {
    const $ = app.query;
    let generation = 0;
    const blocked = () => metadataEditBlocked(app);
    function open(kind, id) {
        if (app.modal.open || blocked()) return;
        const project = app.state, layer = kind === 'card' ? project.overlays.find(item => item.id === id)
            : kind === 'caption' ? {x:project.captionX,y:project.captionY} : project.design[kind];
        if (!layer || !['title','credit','caption','card'].includes(kind)) return;
        const panel = app.panel, textLayer = app.textLayer, selected = app.selectedCard, tab = app.effectTab;
        const signature = JSON.stringify(project), media = [app.sources.videoFile,app.sources.audioFile], owner = ++generation;
        const bounds = kind === 'title' ? {x:[5,95],y:[6,93]} : {x:[0,100],y:[0,100]};
        const displayed = {x:layer.x*100,y:layer.y*100};
        const field = axis => `<label class="panel-label" for="position-${axis}">${text(axis==='x'?'panels.positionX':'panels.positionY')}</label><input class="panel-input" id="position-${axis}" type="number" step="any" min="${bounds[axis][0]}" max="${bounds[axis][1]}" required>`;
        app.modalOpen(message('panels.position'), `<div class="time-fields"><div>${field('x')}</div><div>${field('y')}</div></div>`, `<div class="modal-foot"><button class="button" id="cancelPosition">${text('shell.cancel')}</button><button class="button primary" id="applyPosition">${text('panels.positionApply')}</button></div>`);
        const inputs = {x:$('#position-x'),y:$('#position-y')}, confirm = $('#applyPosition');
        const owns = () => generation === owner && app.modal.open && $('#applyPosition') === confirm;
        const invalidate = () => { if (generation === owner) generation++; };
        let composing = null;
        const close = () => {
            invalidate(); app.modal.close();
            if (!app.modal.open && app.panel === panel && app.textLayer === textLayer && app.selectedCard === selected && app.effectTab === tab)
                $('#panelContent')?.querySelector(kind==='card' ? '#effectControls #openCardPosition' : '#openPosition')?.focus();
        };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelPosition').onclick = () => { if (owns()) close(); };
        confirm.onclick = event => {
            if (!owns() || blocked() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (app.state !== project || JSON.stringify(app.state) !== signature || app.panel !== panel || app.textLayer !== textLayer || app.selectedCard !== selected || app.effectTab !== tab ||
                app.sources.videoFile !== media[0] || app.sources.audioFile !== media[1]) { app.toast(message('panels.positionStale')); return; }
            const patch = {};
            for (const axis of ['x','y']) {
                const value = inputs[axis].value.trim()==='' ? NaN : Number(inputs[axis].value);
                if (value === displayed[axis]) continue;
                const [min,max] = bounds[axis];
                if (!Number.isFinite(value) || value < min || value > max) {
                    setValidity(inputs[axis],'panels.positionInvalid',{min,max}); inputs[axis].reportValidity?.(); inputs[axis].focus(); return;
                }
                patch[kind==='caption' ? 'caption'+axis.toUpperCase() : axis] = value / 100;
            }
            if (!Object.keys(patch).length) { close(); return; }
            const command = {title:'title.update',credit:'credit.update',caption:'captions.style.update',card:'overlays.update'}[kind];
            if (app.runEditorCommand(command, kind==='card' ? {id,patch} : {patch}) && owns()) close();
        };
        for (const axis of ['x','y']) {
            const input = inputs[axis];input.value=decimalTime(displayed[axis]);
            input.oncompositionstart=()=>{if(owns())composing=input;};
            input.oncompositionend=()=>{if(owns()&&composing===input)composing=null;};
            input.oninput=()=>{if(owns())setValidity(input,'');};
            input.onkeydown=event=>{
                if(!owns()||composing||dialogEnterBlocked(event))return;
                event.preventDefault();confirm.onclick(event);
            };
        }
        inputs.x.focus();
    }
    return {open};
}
