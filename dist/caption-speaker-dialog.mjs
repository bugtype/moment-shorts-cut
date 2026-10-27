import { dialogEnterBlocked } from './dialog-enter.mjs';
import { prepareCommand } from './core/commands.mjs';
import { text, mark, t, message, setValidity, formatError } from './i18n.mjs';
import { esc } from './ui-format.mjs';
import { readCaptionRangeInputs } from './caption-range-inputs.mjs';

// This range is an explicit authored-row choice, independent of search and playback.
export function createCaptionSpeakerDialog(app, blocked) {
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
            message('panels.assignSpeakerRange'),
            `<div class="time-fields"><div>${rangeField('speakerRangeFirst', 'panels.firstCaption')}</div>` +
            `<div>${rangeField('speakerRangeLast', 'panels.lastCaption')}</div></div>` +
            `<label class="panel-label" for="speakerRangeValue">${text('panels.speakerRangeLabel')}</label>` +
            `<select class="panel-select" id="speakerRangeValue"><option value="" ${mark('panels.noSpeaker')}>${esc(t('panels.noSpeaker'))}</option>` +
            project.speakerLabels.map((label, slot) => `<option value="${slot}">${slot + 1} · ${esc(label)}</option>`).join('') + `</select>`,
            `<div class="modal-foot"><button class="button" id="cancelSpeakerRange">${text('shell.cancel')}</button>` +
            `<button class="button primary" id="confirmSpeakerRange">${text('panels.applySpeakerRange')}</button></div>`
        );

        const first = $('#speakerRangeFirst');
        const last = $('#speakerRangeLast');
        const speaker = $('#speakerRangeValue');
        const confirm = $('#confirmSpeakerRange');
        first.value = last.value = String(Math.max(0, Math.min(index, project.captions.length - 1)) + 1);
        speaker.value = project.captions[Number(first.value) - 1].speaker || '';
        let composing = null;
        const owns = () => generation === owner && app.modal.open && $('#confirmSpeakerRange') === confirm;
        const invalidate = () => { if (generation === owner) generation++; };
        const close = () => {
            invalidate();
            app.modal.close();
            if (!app.modal.open && app.panel === 'captions') $('#assignSpeakerRange')?.focus();
        };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelSpeakerRange').onclick = event => {
            if (owns() && !composing && !event?.isComposing && event?.keyCode !== 229) close();
        };

        confirm.onclick = event => {
            if (!owns() || blocked() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (app.state !== project || JSON.stringify(app.state) !== contents || app.panel !== 'captions' ||
                app.sources.videoFile !== media[0] || app.sources.audioFile !== media[1]) {
                app.toast(message('panels.captionRangeStale'));
                return;
            }
            const range = readCaptionRangeInputs(first, last, project);
            if (!range) return;
            const { start, end } = range;
            const args = { captionIndex: start - 1, count: end - start + 1, speaker: speaker.value };
            try {
                // Preview uses the same validation and no-op rules as the committed command.
                const prepared = prepareCommand(project, 'captions.speaker.assign', args);
                if (!prepared.data.updated) {
                    close();
                    app.toast(message('panels.speakerRangeUnchanged'));
                    return;
                }
                if (app.runEditorCommand('captions.speaker.assign', args) && owns()) close();
            } catch (error) {
                app.toast(error.messageKey ? error : formatError(error));
            }
        };

        for (const input of [first, last, speaker]) {
            input.oncompositionstart = () => { if (owns()) composing = input; };
            input.oncompositionend = () => { if (owns() && composing === input) composing = null; };
            input.oninput = () => {
                if (owns()) setValidity(first, '');
            };
            // Preserve native select activation; only the numeric fields submit on Enter.
            if (input === speaker) continue;
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
