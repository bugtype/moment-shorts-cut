import { dialogEnterBlocked } from './dialog-enter.mjs';
import {text, message, setValidity} from './i18n.mjs';
import { readCaptionRangeInputs } from './caption-range-inputs.mjs';

// Read-only authored-row export; byte generation/download stay in the file workflow.
export function createCaptionExportDialog(app, blocked) {
    const $ = app.query;
    let generation = 0;
    function open(format, index = 0) {
        if (app.modal.open || blocked() || app.panel !== 'captions' || !app.state.captions.length ||
            !['srt','vtt','txt','review-txt'].includes(format)) return;
        const project = app.state, contents = JSON.stringify(project), owner = ++generation;
        const media = [app.sources.videoFile, app.sources.audioFile];
        const field = (id, key) => `<label class="panel-label" for="${id}">${text(key)}</label><input class="panel-input" id="${id}" type="number" min="1" max="${project.captions.length}" step="1" required>`;
        app.modalOpen(message('panels.captionExportRangeTitle'), `<div class="time-fields"><div>${field('captionExportFirst','panels.captionExportFirst')}</div><div>${field('captionExportLast','panels.captionExportLast')}</div></div><p class="tiny-note">${text('panels.captionExportRangeNote')}</p>`, `<div class="modal-foot"><button class="button" id="cancelCaptionExport">${text('shell.cancel')}</button><button class="button primary" id="confirmCaptionExport">${text('panels.save')}</button></div>`);
        const first = $('#captionExportFirst'), last = $('#captionExportLast'), confirm = $('#confirmCaptionExport');
        const owns = () => owner === generation && app.modal.open && $('#confirmCaptionExport') === confirm;
        const invalidate = () => { if (owner === generation) generation++; };
        const close = () => {
            invalidate(); app.modal.close();
            if (app.panel === 'captions') $('#downloadCaptions')?.focus();
        };
        let composing = null;
        first.value = last.value = String(Math.max(0, Math.min(index, project.captions.length - 1)) + 1);
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelCaptionExport').onclick = () => { if (owns()) close(); };
        confirm.onclick = event => {
            if (!owns() || blocked() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (app.panel !== 'captions' || app.state !== project || JSON.stringify(app.state) !== contents ||
                app.sources.videoFile !== media[0] || app.sources.audioFile !== media[1]) {
                app.toast(message('panels.captionRangeStale')); return;
            }
            const range = readCaptionRangeInputs(first, last, project);
            if (!range) return;
            const { start, end } = range;
            if (app.downloadSubtitles(format, {captionIndex:start - 1, count:end - start + 1}) === true && owns()) close();
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
