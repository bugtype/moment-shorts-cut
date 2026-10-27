import { dialogEnterBlocked } from './dialog-enter.mjs';
import { prepareCommand } from './core/commands.mjs';
import { text, mark, t, message, setValidity, formatError } from './i18n.mjs';
import { esc } from './ui-format.mjs';

// This range is an explicit authored-row choice, independent of search and playback.
export function createCaptionSplitRangeDialog(app, blocked) {
    const $ = app.query;
    let generation = 0;

    function open(index = 0, selectedLimit = 18) {
        if (app.modal.open || blocked() || app.panel !== 'captions' || !app.state.captions.length) return;
        const project = app.state;
        const contents = JSON.stringify(project);
        const media = [app.sources.videoFile, app.sources.audioFile];
        const owner = ++generation;
        const rangeField = (id, label) => `<label class="panel-label" for="${id}">${text(label)}</label>` +
            `<input class="panel-input" id="${id}" type="number" min="1" max="${project.captions.length}" step="1" required>`;

        app.modalOpen(
            message('panels.splitRangeOpen'),
            `<div class="time-fields"><div>${rangeField('splitRangeFirst', 'panels.firstCaption')}</div>` +
            `<div>${rangeField('splitRangeLast', 'panels.lastCaption')}</div></div>` +
            `<label class="panel-label" for="splitRangeLimit">${text('panels.chunkLength')}</label>` +
            `<select class="panel-input" id="splitRangeLimit">${[[12, 'panels.chunkShort'], [18, 'panels.chunkNormal'], [24, 'panels.chunkLong']].map(([value, key]) =>
                `<option value="${value}" ${mark(key)}>${esc(t(key))}</option>`).join('')}</select>`,
            `<div class="modal-foot"><button class="button" id="cancelSplitRange">${text('shell.cancel')}</button>` +
            `<button class="button primary" id="confirmSplitRange">${text('panels.splitLong')}</button></div>`
        );

        const first = $('#splitRangeFirst');
        const last = $('#splitRangeLast');
        const limit = $('#splitRangeLimit');
        const confirm = $('#confirmSplitRange');
        first.value = last.value = String(Math.max(0, Math.min(index, project.captions.length - 1)) + 1);
        limit.value = String([12, 18, 24].includes(selectedLimit) ? selectedLimit : 18);
        let composing = null;
        const owns = () => generation === owner && app.modal.open && $('#confirmSplitRange') === confirm;
        const invalidate = () => { if (generation === owner) generation++; };
        const close = () => {
            invalidate();
            app.modal.close();
            if (!app.modal.open && app.panel === 'captions') $('#splitCaptionRange')?.focus();
        };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelSplitRange').onclick = () => { if (owns()) close(); };

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
            const args = { limit: Number(limit.value), captionIndex: start - 1, count: end - start + 1 };
            try {
                // Preview uses the same validation and no-op rules as the committed command.
                const prepared = prepareCommand(project, 'captions.split.long', args);
                if (!prepared.data.updated) {
                    close();
                    app.toast(message('panels.nothingToSplit'));
                    return;
                }
                if (app.runEditorCommand('captions.split.long', args) && owns()) close();
            } catch (error) {
                app.toast(error.messageKey ? error : formatError(error));
            }
        };

        for (const input of [first, last, limit]) {
            input.oncompositionstart = () => { if (owns()) composing = input; };
            input.oncompositionend = () => { if (owns() && composing === input) composing = null; };
            input.oninput = () => {
                if (owns()) setValidity(first, '');
            };
            // Preserve native select activation; only the numeric fields submit on Enter.
            if (input === limit) continue;
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
