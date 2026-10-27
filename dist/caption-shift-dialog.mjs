import { dialogEnterBlocked } from './dialog-enter.mjs';
import { prepareCommand } from './core/commands.mjs';
import { text, mark, t, message, setValidity, formatError } from './i18n.mjs';
import { esc } from './ui-format.mjs';

// This range is an explicit authored-row choice, independent of search and playback.
export function createCaptionShiftDialog(app, blocked) {
    const $ = app.query;
    let generation = 0;

    function open(index = 0) {
        if (app.modal.open || blocked() || app.panel !== 'captions' || !app.state.captions.length) return;
        const project = app.state;
        const contents = JSON.stringify(project);
        const media = [app.sources.videoFile, app.sources.audioFile];
        const owner = ++generation;
        const rangeField = (id, label) => `<label class="panel-label" for="${id}">${text(label)}</label>` +
            `<input class="panel-input" id="${id}" type="number" min="1" max="${project.captions.length}" step="1" required>`;

        app.modalOpen(
            message('panels.shiftCaptionRange'),
            `<div class="time-fields"><div>${rangeField('shiftRangeFirst', 'panels.firstCaption')}</div>` +
            `<div>${rangeField('shiftRangeLast', 'panels.lastCaption')}</div></div>` +
            `<label class="panel-label" for="shiftRangeBasis">${text('panels.shiftBasis')}</label>` +
            `<select class="panel-select" id="shiftRangeBasis"><option value="source" ${mark('panels.sourceTime')}>${esc(t('panels.sourceTime'))}</option>` +
            `<option value="timeline" ${mark('panels.timelineTime')}>${esc(t('panels.timelineTime'))}</option></select>` +
            `<label class="panel-label" for="shiftRangeDelta">${text('panels.shiftSeconds')}</label>` +
            `<input class="panel-input" id="shiftRangeDelta" type="number" step="any" required>` +
            `<p class="notice">${text('panels.shiftRangeBasisNotice')}</p>`,
            `<div class="modal-foot"><button class="button" id="cancelShiftRange">${text('shell.cancel')}</button>` +
            `<button class="button primary" id="confirmShiftRange">${text('panels.shift')}</button></div>`
        );

        const first = $('#shiftRangeFirst');
        const last = $('#shiftRangeLast');
        const basis = $('#shiftRangeBasis');
        const delta = $('#shiftRangeDelta');
        const confirm = $('#confirmShiftRange');
        first.value = last.value = String(Math.max(0, Math.min(index, project.captions.length - 1)) + 1);
        basis.value = 'source';
        delta.value = '0';
        let composing = null;
        const owns = () => generation === owner && app.modal.open && $('#confirmShiftRange') === confirm;
        const invalidate = () => { if (generation === owner) generation++; };
        const close = () => {
            invalidate();
            app.modal.close();
            if (!app.modal.open && app.panel === 'captions') $('#shiftCaptionRange')?.focus();
        };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelShiftRange').onclick = () => { if (owns()) close(); };

        confirm.onclick = event => {
            if (!owns() || blocked() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (app.state !== project || JSON.stringify(app.state) !== contents || app.panel !== 'captions' ||
                app.sources.videoFile !== media[0] || app.sources.audioFile !== media[1]) {
                app.toast(message('panels.captionRangeStale'));
                return;
            }
            const start = first.value.trim() === '' ? NaN : Number(first.value);
            const end = last.value.trim() === '' ? NaN : Number(last.value);
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > project.captions.length) {
                setValidity(first, 'panels.captionRangeInvalid', { total: project.captions.length });
                first.reportValidity?.();
                first.focus();
                return;
            }
            const seconds = delta.value.trim() === '' ? NaN : Number(delta.value);
            if (!Number.isFinite(seconds)) {
                setValidity(delta, 'panels.enterShift');
                delta.reportValidity?.();
                delta.focus();
                return;
            }
            const args = { basis: basis.value, delta: seconds, captionIndex: start - 1, count: end - start + 1 };
            try {
                // Preview uses the same validation and no-op rules as the committed command.
                const prepared = prepareCommand(project, 'captions.timing.shift', args);
                if (!prepared.data.updated) {
                    close();
                    app.toast(message('panels.shiftRangeUnchanged'));
                    return;
                }
                if (app.runEditorCommand('captions.timing.shift', args) && owns()) close();
            } catch (error) {
                app.toast(error.messageKey ? error : formatError(error));
            }
        };

        for (const input of [first, last, basis, delta]) {
            input.oncompositionstart = () => { if (owns()) composing = input; };
            input.oncompositionend = () => { if (owns() && composing === input) composing = null; };
            input.oninput = () => {
                if (owns()) { setValidity(first, ''); setValidity(delta, ''); }
            };
            // Preserve native select activation; only the numeric fields submit on Enter.
            if (input === basis) continue;
            input.onkeydown = event => {
                if (!owns() || composing || dialogEnterBlocked(event)) return;
                event.preventDefault();
                confirm.onclick(event);
            };
        }
        first.focus();
    }
    return { open };
}
