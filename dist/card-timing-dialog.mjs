import { dialogEnterBlocked } from './dialog-enter.mjs';
import {text, message, setText, setValidity} from './i18n.mjs';
import {decimalTime} from './ui-format.mjs';

// Move one existing output-time interval without changing its length or identity.
export function createCardTimingDialog(app) {
    const $ = app.query;
    let generation = 0;
    const blocked = () => !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        (app.persistence.restorePhase !== 'ready' && !(app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid)) ||
        app.audioRecording.requesting || app.audioRecording.current;
    function open(id) {
        if (blocked() || app.modal.open) return;
        const project = app.state, card = project.overlays.find(item => item.id === id);
        if (!card) return;
        const contents = JSON.stringify(project), selected = app.selectedCard, panel = app.panel, tab = app.effectTab;
        const media = [app.sources.videoFile, app.sources.audioFile], owner = ++generation;
        const length = card.end - card.start, total = app.duration() / project.speed;
        const endpointTolerance = (a, b) => Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)) * 4;
        const fits = Number.isFinite(length) && length > 0 && length - total <= endpointTolerance(length, total);
        const movedEnd = start => {
            const end = start + length;
            // Decimal input can land a few ULPs beyond the identical output end.
            // Normalize only that endpoint, never genuine overflow or duration collapse.
            return end > total && end - total <= endpointTolerance(end, total) ? total : end;
        };
        app.modalOpen(message('panels.moveCardTime'), `<label class="panel-label" for="cardMoveStart">${text('panels.cardOutputStart')}</label><input class="panel-input" id="cardMoveStart" type="number" min="0" step="any" required><button class="button" id="cardMovePlayhead">${text('panels.trimStartPlayhead')}</button><dl class="modal-copy"><dt>${text('panels.cardDuration')}</dt><dd>${decimalTime(length)}</dd><dt>${text('panels.cardNewEnd')}</dt><dd id="cardMoveEnd" aria-live="polite"></dd></dl>${fits ? '' : `<p role="status">${text('panels.cardCannotFit')}</p>`}`, `<div class="modal-foot"><button class="button" id="cancelCardMove">${text('shell.cancel')}</button><button class="button primary" id="confirmCardMove">${text('panels.move')}</button></div>`);
        const input = $('#cardMoveStart'), confirm = $('#confirmCardMove');
        let composing = false;
        const owns = () => owner === generation && app.modal.open && $('#confirmCardMove') === confirm;
        const contextCurrent = () => app.state === project && JSON.stringify(app.state) === contents && app.selectedCard === selected && app.panel === panel && app.effectTab === tab &&
            app.sources.videoFile === media[0] && app.sources.audioFile === media[1];
        const canAct = event => {
            if (!owns() || composing || event?.isComposing || event?.keyCode === 229 || blocked()) return false;
            if (!contextCurrent()) { app.toast(message('panels.cardMoveStale')); return false; }
            return true;
        };
        const close = () => { generation++; app.modal.close(); $('#moveSceneTime')?.focus(); };
        app.modal.onclose = () => { if (owner === generation && !app.modal.open) generation++; };
        input.value = decimalTime(card.start);
        const preview = () => {
            const start = input.value.trim() === '' ? NaN : Number(input.value), end = movedEnd(start);
            if (Number.isFinite(end)) {
                const output = $('#cardMoveEnd');
                output.removeAttribute('data-i18n'); output.removeAttribute('data-i18n-params');
                output.textContent = decimalTime(end);
            }
            else setText($('#cardMoveEnd'), 'panels.cardTimeUnknown');
        };
        preview();
        input.oninput = () => { if (owns()) { setValidity(input, ''); preview(); } };
        input.oncompositionstart = () => { composing = true; };
        input.oncompositionend = () => { composing = false; };
        $('#cancelCardMove').onclick = () => { if (owns()) close(); };
        $('#cardMovePlayhead').onclick = event => {
            if (!canAct(event)) return;
            const start = app.current / project.speed;
            if (!Number.isFinite(start) || start < 0 || start > total) {
                setValidity(input, 'panels.cardMoveRange', {total:decimalTime(total)});
                input.reportValidity?.(); input.focus(); return;
            }
            // Capture only the draft. Overflow remains visible for confirmation to reject.
            input.value = decimalTime(start);
            setValidity(input, ''); preview(); input.focus();
        };
        confirm.onclick = event => {
            if (!canAct(event)) return;
            const start = input.value.trim() === '' ? NaN : Number(input.value);
            if (start === card.start) { close(); return; }
            const end = movedEnd(start);
            if (!fits || !Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start || end > total) {
                setValidity(input, fits ? 'panels.cardMoveRange' : 'panels.cardCannotFit', {total:decimalTime(total)});
                input.reportValidity?.(); input.focus(); return;
            }
            if (app.runEditorCommand('overlays.update', {id, patch:{start, end}}) && owns()) close();
        };
        input.onkeydown = event => {
            if (!owns() || composing || dialogEnterBlocked(event)) return;
            event.preventDefault(); confirm.onclick(event);
        };
        input.focus();
    }
    return {open};
}
