import { decimalTime } from './ui-format.mjs';
import {text, message, setValidity} from './i18n.mjs';
import { hasMinimumDuration } from './core/validation.mjs';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Timeline and session editing commands. Validation and history stay shared so
// trim, split, undo and reset never bypass the project command boundary.
export function createEditingActions(app) {
    let resetGeneration = 0;
    // Capture source time into one draft only; Apply remains the mutation boundary.
    function bindTrimDrafts({ start, end, startButton, endButton, current = () => true }) {
        const fields = [app.query(start), app.query(end)];
        const initialClip = app.state.clips[app.selected];
        const baseline = fields.map((field, index) => ({
            value: initialClip?.[index ? 'end' : 'start'], displayed: field.value,
        }));
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
        // Only the current owner may query these drafts. Do not infer cleanliness
        // from rounded display text or reuse a different occurrence's controls.
        return () => {
            if (!current() || app.query(start) !== fields[0] || app.query(end) !== fields[1]) return false;
            const clip = app.state.clips[app.selected];
            if (!clip) return false;
            if (composing) return true;
            return fields.some((field, index) => {
                const value = clip[index ? 'end' : 'start'];
                if (value === baseline[index].value && field.value === baseline[index].displayed) return false;
                const number = field.valueAsNumber;
                return !Number.isFinite(number) || number !== value;
            });
        };
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
        if (app.panel === 'settings') app.renderPanel();
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
        const owner = ++resetGeneration;
        const cancel = app.query('#cancelReset');
        const confirm = app.query('#confirmReset');
        const ownsDialog = () => resetGeneration === owner && app.modal.open &&
            app.query('#cancelReset') === cancel && app.query('#confirmReset') === confirm;
        const invalidate = () => {
            if (resetGeneration === owner) resetGeneration++;
        };
        const composing = event => event?.isComposing || event?.keyCode === 229;
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => {
            // A queued close event must not invalidate a newly opened dialog.
            if (!app.modal.open) invalidate();
        };
        cancel.onclick = event => {
            if (!ownsDialog() || composing(event)) return;
            invalidate();
            app.modal.close();
        };
        confirm.onclick = event => {
            if (!ownsDialog() || composing(event) || resetBlocked()) return;
            // Busy refusals keep ownership for retry; accepted reset is one-shot.
            invalidate();
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
