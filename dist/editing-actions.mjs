import { decimalTime } from './ui-format.mjs';
import {text, message, setValidity} from './i18n.mjs';
import { hasMinimumDuration } from './core/validation.mjs';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Timeline and session editing commands. Validation and history stay shared so
// trim, split, undo and reset never bypass the project command boundary.
export function createEditingActions(app) {
    // Capture source time into one draft only; Apply remains the mutation boundary.
    function bindTrimDrafts({ start, end, startButton, endButton, current = () => true }) {
        const fields = [app.query(start), app.query(end)];
        let composing = null;
        for (const field of fields) {
            field.oncompositionstart = () => { composing = field; };
            field.oncompositionend = () => { if (composing === field) composing = null; };
        }
        for (const [selector, field] of [[startButton, fields[0]], [endButton, fields[1]]]) {
            const button = app.query(selector);
            button.onclick = (event = {}) => {
                if (composing || event.isComposing || event.keyCode === 229 || !current() ||
                    app.query(selector) !== button || !app.editorReady || app.modal.open ||
                    app.exporting || app.loadingMedia || app.transcribing ||
                    app.persistence.restorePhase !== 'ready' || app.audioRecording.requesting || app.audioRecording.current) return;
                const clip = app.state.clips[app.selected];
                if (!clip) return;
                const offset = app.state.clips.slice(0, app.selected).reduce((sum, item) => sum + (item.end - item.start), 0);
                const limit = offset + (clip.end - clip.start), time = app.current;
                const epsilon = Number.EPSILON * Math.max(Math.abs(time), Math.abs(offset), Math.abs(limit)) * 8;
                if (!Number.isFinite(time) || time < offset - epsilon || time > limit + epsilon) {
                    app.toast(message('panels.trimPlayheadOutside'));
                    return;
                }
                const source = time <= offset ? clip.start : time >= limit ? clip.end : clip.start + (time - offset);
                app.pause();
                field.value = decimalTime(clamp(source, clip.start, clip.end));
                setValidity(field, '');
                field.focus({ preventScroll: true });
            };
        }
    }

    function trim(start, end) {
        const state = app.state;
        if (start < 0 || end > state.duration || !hasMinimumDuration(start, end)) {
            app.toast(message("shell.trimError"));
            return;
        }
        const clips = structuredClone(state.clips);
        clips[app.selected] = { start, end };
        if (!app.runEditorCommand('timeline.replace', { clips }))
            return;
        app.seekTo(state.clips.slice(0, app.selected).reduce((sum, clip) => sum + clip.end - clip.start, 0));
        if (app.panel === 'settings')
            app.renderPanel();
    }

    function split() {
        const pos = app.locate(app.current);
        if (!app.runEditorCommand('timeline.split', { clipIndex: pos.index, sourceTime: pos.source }))
            return;
        app.selected = pos.index + 1;
        app.renderTimeline();
        app.renderInspector();
        app.openInspector('clip');
        app.toast(message("shell.splitDone"));
    }

    function duplicate() {
        const index = app.selected;
        if (!app.runEditorCommand('timeline.duplicate', { clipIndex: index })) return;
        app.selected = index + 1;
        const start = app.state.clips.slice(0, app.selected).reduce((sum, clip) => sum + clip.end - clip.start, 0);
        app.renderTimeline();
        app.renderInspector();
        app.openInspector('clip');
        app.seekTo(start);
        if (app.panel === 'settings') app.renderPanel();
        app.toast(message("shell.duplicateDone"));
    }

    function undo(redo = false) {
        app.inputHistory.reset();
        const from = redo ? app.future : app.history, to = redo ? app.history : app.future;
        if (!from.length)
            return;
        app.pause();
        to.push(JSON.stringify(app.state));
        app.state = JSON.parse(from.pop());
        app.timelineCache = null;
        if (app.persistence.restorePhase === 'ready')
            app.state.audioName = app.sources.audioFile?.name || '';
        app.selected = clamp(app.selected, 0, app.state.clips.length - 1);
        app.current = Math.min(app.current, app.duration());
        app.changed();
        app.resizePreview();
        app.renderPanel();
        app.seekTo(app.current);
    }

    function resetBlocked() {
        if (app.recoveryBlocked())
            return true;
        if (app.loadingMedia || app.exporting || app.transcribing || app.audioRecording.requesting || app.audioRecording.current) {
            app.toast(message("shell.busy"));
            return true;
        }
        return false;
    }

    function confirmReset() {
        if (resetBlocked())
            return;
        app.modalOpen(message("shell.resetTitle"), `<p class="modal-copy">${text("shell.resetNotice")}</p>`, `<div class="modal-foot"><button class="button" id="cancelReset">${text("shell.cancel")}</button><button class="button primary" id="confirmReset">${text("shell.resetConfirm")}</button></div>`);
        app.query('#cancelReset').onclick = () => app.modal.close();
        app.query('#confirmReset').onclick = () => {
            if (resetBlocked())
                return;
            app.pause();
            app.state = app.initial();
            app.timelineCache = null;
            app.sources.reset();
            app.current = 0;
            app.selected = 0;
            app.history = [];
            app.future = [];
            app.inputHistory.reset();
            app.persistMedia();
            app.changed();
            app.renderPanel();
            app.resizePreview();
            app.modal.close();
        };
    }

    return { bindTrimDrafts, trim, split, duplicate, undo, confirmReset };
}
