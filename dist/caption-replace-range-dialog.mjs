import { dialogEnterBlocked } from './dialog-enter.mjs';
import { inspectCaptionTextReplacement } from './core/caption-text.mjs';
import { text, message, setText, setValidity, formatError } from './i18n.mjs';

// One explicit authored interval; search navigation keeps its all-caption scope.
export function createCaptionReplaceRangeDialog(app, blocked) {
    const $ = app.query;
    let generation = 0;
    function open({ find, replacement, index = 0, isCurrent }) {
        if (app.modal.open || blocked() || app.panel !== 'captions' || !app.state.captions.length) return;
        const project = app.state, signature = JSON.stringify(project);
        const media = [app.sources.videoFile, app.sources.audioFile];
        const owner = ++generation;
        const field = (id, key) => `<label class="panel-label" for="${id}">${text(key)}</label>` +
            `<input class="panel-input" id="${id}" type="number" min="1" max="${project.captions.length}" step="1" required>`;
        app.modalOpen(message('replaceRange.title'),
            `<label class="panel-label" for="rangeFind">${text('panels.find')}</label><textarea class="panel-input" id="rangeFind" rows="2" readonly></textarea>` +
            `<label class="panel-label" for="rangeReplacement">${text('panels.replacement')}</label><textarea class="panel-input" id="rangeReplacement" rows="2" readonly></textarea>` +
            `<div class="time-fields"><div>${field('replaceRangeFirst', 'panels.firstCaption')}</div><div>${field('replaceRangeLast', 'panels.lastCaption')}</div></div>` +
            `<output id="replaceRangeSummary" aria-live="polite"></output>`,
            `<div class="modal-foot"><button class="button" id="cancelReplaceRange">${text('shell.cancel')}</button><button class="button primary" id="confirmReplaceRange">${text('replaceRange.apply')}</button></div>`);
        const first = $('#replaceRangeFirst'), last = $('#replaceRangeLast'), confirm = $('#confirmReplaceRange');
        $('#rangeFind').value = find;
        $('#rangeReplacement').value = replacement;
        first.value = last.value = String(Math.max(0, Math.min(index, project.captions.length - 1)) + 1);
        let composing = false;
        const owns = () => owner === generation && app.modal.open && $('#confirmReplaceRange') === confirm;
        const valid = () => isCurrent() && app.panel === 'captions' && app.state === project &&
            JSON.stringify(project) === signature && app.sources.videoFile === media[0] && app.sources.audioFile === media[1];
        const invalidate = () => { if (generation === owner) generation++; };
        const close = () => {
            invalidate(); app.modal.close();
            if (!app.modal.open && app.panel === 'captions') $('#replaceCaptionRange')?.focus();
        };
        const args = () => {
            const start = first.value.trim() ? Number(first.value) : NaN;
            const end = last.value.trim() ? Number(last.value) : NaN;
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > project.captions.length) return null;
            return {find, replacement, captionIndex:start - 1, count:end - start + 1};
        };
        const preview = () => {
            if (!owns()) return;
            const options = args();
            try {
                if (!options) { setText($('#replaceRangeSummary'), 'panels.captionRangeInvalid', {total:project.captions.length}); return; }
                const result = inspectCaptionTextReplacement(project.captions, options);
                setText($('#replaceRangeSummary'), 'replaceRange.summary', {matches:result.matches, captions:result.changedCaptions});
            } catch (error) {
                if (error.messageKey) setText($('#replaceRangeSummary'), error.messageKey, error.messageParams);
                else {
                    const summary = $('#replaceRangeSummary');
                    summary.removeAttribute('data-i18n');
                    summary.removeAttribute('data-i18n-params');
                    summary.textContent = formatError(error);
                }
            }
        };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelReplaceRange').onclick = () => { if (owns()) close(); };
        confirm.onclick = event => {
            if (!owns() || blocked() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (!valid()) { app.toast(message('panels.captionRangeStale')); return; }
            const options = args();
            if (!options) {
                setValidity(first, 'panels.captionRangeInvalid', {total:project.captions.length});
                first.reportValidity?.(); first.focus(); return;
            }
            try {
                const result = inspectCaptionTextReplacement(project.captions, options);
                if (!result.changedCaptions) { close(); app.toast(message('replaceRange.unchanged')); return; }
                if (app.runEditorCommand('captions.text.replace', options) && owns()) close();
            } catch (error) { app.toast(error.messageKey ? error : formatError(error)); }
        };
        for (const input of [first, last]) {
            input.oncompositionstart = () => { if (owns()) composing = true; };
            input.oncompositionend = () => { if (owns()) composing = false; };
            input.oninput = () => { if (owns()) { setValidity(first, ''); preview(); } };
            input.onkeydown = event => {
                if (!owns() || composing || dialogEnterBlocked(event)) return;
                event.preventDefault(); confirm.onclick(event);
            };
        }
        preview(); first.focus();
    }
    return {open};
}
