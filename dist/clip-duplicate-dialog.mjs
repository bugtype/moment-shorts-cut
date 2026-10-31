import { dialogEnterBlocked } from './dialog-enter.mjs';
import { text, message, setValidity } from './i18n.mjs';
import { metadataEditBlocked } from './metadata-edit-availability.mjs';

// Range numbers describe authored clip positions, not a persisted selection.
export function createClipDuplicateDialog(app) {
    const $ = app.query;
    let generation = 0;
    const blocked = () => metadataEditBlocked(app);

    function open(trigger, event) {
        if (blocked() || app.modal.open || event?.isComposing || event?.keyCode === 229 ||
            !trigger || $('#' + trigger.id) !== trigger || !app.state.clips.length) return;
        const project = app.state;
        const signature = JSON.stringify(project);
        const selected = app.selected;
        const panel = app.panel;
        const media = [app.sources.videoFile, app.sources.audioFile];
        const owner = ++generation;
        const field = (id, key) => `<label class="panel-label" for="${id}">${text(key)}</label>` +
            `<input class="panel-input" id="${id}" type="number" min="1" max="${project.clips.length}" step="1" required>`;
        app.modalOpen(message('duplicateRange.open'),
            `<div class="time-fields"><div>${field('duplicateRangeFirst', 'panels.firstClip')}</div>` +
            `<div>${field('duplicateRangeLast', 'panels.lastClip')}</div></div>`,
            `<div class="modal-foot"><button class="button" id="cancelDuplicateRange">${text('shell.cancel')}</button>` +
            `<button class="button primary" id="confirmDuplicateRange">${text('duplicateRange.confirm')}</button></div>`);
        const first = $('#duplicateRangeFirst');
        const last = $('#duplicateRangeLast');
        const confirm = $('#confirmDuplicateRange');
        let composing = null;
        first.value = last.value = String(selected + 1);
        const owns = () => generation === owner && app.modal.open && $('#confirmDuplicateRange') === confirm;
        const valid = () => app.state === project && JSON.stringify(app.state) === signature &&
            app.selected === selected && app.panel === panel &&
            app.sources.videoFile === media[0] && app.sources.audioFile === media[1];
        const invalidate = () => { if (generation === owner) generation++; };
        const focus = () => {
            if (!app.modal.open && app.panel === panel) $('#' + trigger.id)?.focus();
        };
        const close = () => { invalidate(); app.modal.close(); focus(); };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelDuplicateRange').onclick = () => { if (owns()) close(); };
        confirm.onclick = event => {
            if (!owns() || blocked() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (!valid()) { app.toast(message('panels.clipMoveStale')); return; }
            const start = first.value.trim() === '' ? NaN : Number(first.value);
            const end = last.value.trim() === '' ? NaN : Number(last.value);
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > project.clips.length) {
                setValidity(first, 'duplicateRange.invalid', { total: project.clips.length });
                first.reportValidity?.();
                first.focus();
                return;
            }
            const count = end - start + 1;
            if (!app.runEditorCommand('timeline.duplicate', { clipIndex: start - 1, count })) return;
            app.selected = end;
            const restore = owns();
            if (restore) { invalidate(); app.modal.close(); }
            app.renderTimeline();
            app.renderInspector();
            if (panel !== 'templates' || app.panel !== 'templates') app.renderPanel();
            app.seekTo(app.state.clips.slice(0, app.selected).reduce((sum, clip) => sum + clip.end - clip.start, 0));
            if (restore) focus();
        };
        for (const input of [first, last]) {
            input.oncompositionstart = () => { if (owns()) composing = input; };
            input.oncompositionend = () => { if (owns() && composing === input) composing = null; };
            input.oninput = () => { if (owns()) setValidity(first, ''); };
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
