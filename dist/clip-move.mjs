import {text, message, setValidity} from './i18n.mjs';

export function createClipMove(app) {
    const $ = app.query;
    let generation = 0;
    const blocked = () => !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        (app.persistence.restorePhase !== 'ready' && !(app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid)) || app.audioRecording.requesting || app.audioRecording.current;
    function move(toIndex) {
        const clipIndex = app.selected;
        if (blocked() || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= app.state.clips.length) return false;
        if (toIndex === clipIndex) return true;
        // This operation preserves the selected source range, so its four trim
        // fields can retain drafts even though controls rebind to cloned clips.
        const trimIds = ['trimStart', 'trimEnd', ...(app.panel === 'settings' ? ['panelTrimStart', 'panelTrimEnd'] : [])];
        const drafts = trimIds.map(id => [id, $('#' + id)?.value]);
        if (!app.runEditorCommand('timeline.move', {clipIndex, toIndex})) return false;
        app.selected = toIndex;
        app.renderTimeline(); app.renderInspector(); app.renderPanel();
        app.seekTo(app.state.clips.slice(0, toIndex).reduce((sum, clip) => sum + (clip.end - clip.start), 0));
        for (const [id, value] of drafts) if (value !== undefined && $('#' + id)) $('#' + id).value = value;
        return true;
    }
    function open(trigger) {
        if (blocked() || app.modal.open) return;
        const project = app.state, selected = app.selected, contents = JSON.stringify(project);
        const media = [app.sources.videoFile, app.sources.audioFile], panel = app.panel, owner = ++generation;
        app.modalOpen(message('panels.moveClip'), `<label class="panel-label" for="clipMovePosition">${text('panels.clipDestination', {total:project.clips.length})}</label><input class="panel-input" id="clipMovePosition" type="number" min="1" max="${project.clips.length}" step="1" required>`, `<div class="modal-foot"><button class="button" id="cancelClipMove">${text('shell.cancel')}</button><button class="button primary" id="confirmClipMove">${text('panels.move')}</button></div>`);
        const input = $('#clipMovePosition'), confirm = $('#confirmClipMove');
        let composing = false;
        const owns = () => owner === generation && app.modal.open && $('#confirmClipMove') === confirm;
        input.value = String(selected + 1);
        app.modal.onclose = () => { if (owner === generation && !app.modal.open) generation++; };
        const close = () => { generation++; app.modal.close(); if (trigger?.id) $('#' + trigger.id)?.focus(); };
        $('#cancelClipMove').onclick = () => { if (owns()) close(); };
        input.oncompositionstart = () => { composing = true; };
        input.oncompositionend = () => { composing = false; };
        input.oninput = () => { if (owns()) setValidity(input, ''); };
        confirm.onclick = event => {
            if (!owns() || composing || event?.isComposing || event?.keyCode === 229 || blocked()) return;
            if (app.state !== project || app.selected !== selected || app.panel !== panel || JSON.stringify(app.state) !== contents ||
                app.sources.videoFile !== media[0] || app.sources.audioFile !== media[1]) {
                app.toast(message('panels.clipMoveStale')); return;
            }
            const position = input.value.trim() === '' ? NaN : Number(input.value);
            if (!Number.isInteger(position) || position < 1 || position > project.clips.length) {
                setValidity(input, 'panels.clipMoveRange', {total:project.clips.length});
                input.reportValidity?.(); input.focus(); return;
            }
            if (move(position - 1) && owns()) close();
        };
        input.onkeydown = event => {
            if (!owns() || composing || event.defaultPrevented || event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            event.preventDefault(); confirm.onclick(event);
        };
        input.focus();
    }
    return {open, move};
}
