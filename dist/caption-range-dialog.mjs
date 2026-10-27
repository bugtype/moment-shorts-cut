import { dialogEnterBlocked } from './dialog-enter.mjs';
import {text, message, setValidity} from './i18n.mjs';
import { readCaptionRangeInputs } from './caption-range-inputs.mjs';

// Authored row indices, not projected occurrences or a persisted selection.
export function createCaptionRangeDialog(app, blocked) {
    const $ = app.query;
    let generation = 0;
    function open(index = 0) {
        if (app.modal.open || blocked() || app.panel !== 'captions' || !app.state.captions.length) return;
        const project = app.state, contents = JSON.stringify(project), owner = ++generation;
        const media = [app.sources.videoFile, app.sources.audioFile];
        const field = (id, key) => `<label class="panel-label" for="${id}">${text(key)}</label><input class="panel-input" id="${id}" type="number" min="1" max="${project.captions.length}" step="1" required>`;
        app.modalOpen(message('panels.removeCaptionRange'), `<div class="time-fields"><div>${field('captionRangeFirst','panels.firstCaption')}</div><div>${field('captionRangeLast','panels.lastCaption')}</div></div>`, `<div class="modal-foot"><button class="button" id="cancelCaptionRange">${text('shell.cancel')}</button><button class="button primary" id="confirmCaptionRange">${text('panels.removeCaptionRangeConfirm')}</button></div>`);
        const first = $('#captionRangeFirst'), last = $('#captionRangeLast'), confirm = $('#confirmCaptionRange');
        const owns = () => owner === generation && app.modal.open && $('#confirmCaptionRange') === confirm;
        let composing = null;
        first.value = last.value = String(Math.max(0, Math.min(index, project.captions.length - 1)) + 1);
        const invalidate = () => { if (owner === generation) generation++; };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelCaptionRange').onclick = () => {
            if (!owns()) return;
            invalidate(); app.modal.close();
            if (app.panel === 'captions') $('#removeCaptionRange')?.focus();
        };
        confirm.onclick = event => {
            if (!owns() || blocked() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (app.panel !== 'captions' || app.state !== project || JSON.stringify(app.state) !== contents ||
                app.sources.videoFile !== media[0] || app.sources.audioFile !== media[1]) {
                app.toast(message('panels.captionRangeStale')); return;
            }
            const range = readCaptionRangeInputs(first, last, project);
            if (!range) return;
            const { start, end } = range;
            if (!app.runEditorCommand('captions.remove', {captionIndex: start - 1, count: end - start + 1})) return;
            if (!owns()) return;
            invalidate(); app.modal.close();
            if (app.state.captions.length) app.focusCaption(Math.min(start - 1, app.state.captions.length - 1));
            else $('#addCaption')?.focus();
        };
        for (const input of [first,last]) {
            input.oncompositionstart = () => { if (owns()) composing = input; };
            input.oncompositionend = () => { if (owns() && composing === input) composing = null; };
            input.oninput = () => { if (owns()) setValidity(first, ''); };
            input.onkeydown = event => {
                if (!owns() || composing || dialogEnterBlocked(event)) return;
                event.preventDefault(); confirm.onclick(event);
            };
        }
        first.focus();
    }
    return {open};
}
