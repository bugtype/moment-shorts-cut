import { dialogEnterBlocked } from './dialog-enter.mjs';
import {text, message, setValidity} from './i18n.mjs';

// A range is session UI state, not a persisted multi-selection or new edit command.
export function createClipRange(app) {
    const $ = app.query;
    let generation = 0;
    const blocked = () => !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        (app.persistence.restorePhase !== 'ready' && !(app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid)) ||
        app.audioRecording.requesting || app.audioRecording.current;
    function open(trigger) {
        if (blocked() || app.modal.open || app.state.clips.length < 2) return;
        const project = app.state, contents = JSON.stringify(project), selected = app.selected, panel = app.panel;
        const media = [app.sources.videoFile, app.sources.audioFile], owner = ++generation;
        const field = (id, key) => `<label class="panel-label" for="${id}">${text(key)}</label><input class="panel-input" id="${id}" type="number" min="1" max="${project.clips.length}" step="1" required>`;
        app.modalOpen(message('panels.removeClipRange'), `<div class="time-fields"><div>${field('clipRangeFirst','panels.firstClip')}</div><div>${field('clipRangeLast','panels.lastClip')}</div></div>`, `<div class="modal-foot"><button class="button" id="cancelClipRange">${text('shell.cancel')}</button><button class="button primary" id="confirmClipRange">${text('panels.removeClipRangeConfirm')}</button></div>`);
        const first = $('#clipRangeFirst'), last = $('#clipRangeLast'), confirm = $('#confirmClipRange');
        const owns = () => generation === owner && app.modal.open && $('#confirmClipRange') === confirm;
        let composing = null;
        first.value = last.value = String(selected + 1);
        app.modal.onclose = () => { if (generation === owner && !app.modal.open) generation++; };
        const restoreFocus = () => {
            const target = trigger?.id && $('#' + trigger.id);
            (target && !target.disabled ? target : $(panel === 'settings' ? '#panelTrimApply' : '#trimButton'))?.focus();
        };
        const close = () => { generation++; app.modal.close(); restoreFocus(); };
        $('#cancelClipRange').onclick = () => { if (owns()) close(); };
        confirm.onclick = event => {
            if (!owns() || blocked() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (app.state !== project || JSON.stringify(app.state) !== contents || app.selected !== selected || app.panel !== panel ||
                app.sources.videoFile !== media[0] || app.sources.audioFile !== media[1]) {
                app.toast(message('panels.clipMoveStale')); return;
            }
            const start = first.value.trim() === '' ? NaN : Number(first.value), end = last.value.trim() === '' ? NaN : Number(last.value);
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > project.clips.length || end - start + 1 >= project.clips.length) {
                setValidity(first,'panels.clipRangeInvalid',{total:project.clips.length}); first.reportValidity?.(); first.focus(); return;
            }
            const clips = project.clips.filter((_, index) => index < start - 1 || index >= end);
            if (!app.runEditorCommand('timeline.replace', {clips})) return;
            // The surviving successor occupies the removed range's start; otherwise use the last clip.
            app.selected = Math.min(start - 1, clips.length - 1);
            const restore = owns();
            if (restore) { generation++; app.modal.close(); }
            app.renderTimeline(); app.renderInspector();
            if (panel !== 'templates' || app.panel !== 'templates') app.renderPanel();
            app.seekTo(clips.slice(0, app.selected).reduce((sum, clip) => sum + (clip.end - clip.start), 0));
            if (restore && !app.modal.open) restoreFocus();
        };
        for (const input of [first,last]) {
            input.oncompositionstart = () => { if (owns()) composing = input; };
            input.oncompositionend = () => { if (owns() && composing === input) composing = null; };
            input.oninput = () => { if (owns()) setValidity(first,''); };
            input.onkeydown = event => {
                if (!owns() || composing || dialogEnterBlocked(event)) return;
                event.preventDefault(); confirm.onclick(event);
            };
        }
        first.focus();
    }
    return {open};
}
