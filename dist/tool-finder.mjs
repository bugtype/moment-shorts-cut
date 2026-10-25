import {text, message} from './i18n.mjs';
import {findToolTargets} from './tool-finder-targets.mjs';

// A fixed navigation directory. This owner never clicks a control, executes an
// editing command, opens a picker, starts a provider or persists search text.
export function createToolFinder(app) {
    const $ = app.query;
    let generation = 0;
    const blocked = () => !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        app.audioRecording.requesting || app.audioRecording.current ||
        (app.persistence.restorePhase !== 'ready' && !(app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid));
    const media = () => [app.sources.videoFile, app.sources.audioFile, app.sources.sourceURL, app.sources.audioURL];
    function open() {
        if (blocked()) { app.toast(message('finder.busy')); return; }
        const owner = ++generation, project = app.state, signature = JSON.stringify(project);
        const sources = media(), panel = app.panel, selected = app.selected, revision = app.panelRevision;
        let active = true, resultGeneration = 0, composing = false;
        app.modalOpen(message('finder.title'),
            `<label class="panel-label" for="toolFinderQuery">${text('finder.search')}</label>` +
            `<input class="panel-input" id="toolFinderQuery" type="search" autocomplete="off" spellcheck="false">` +
            `<p id="toolFinderStatus" role="status" aria-live="polite"></p><div id="toolFinderResults" class="tool-finder-results"></div>`,
            `<div class="modal-foot"><button class="button" id="cancelToolFinder">${text('shell.cancel')}</button></div>`);
        const input = $('#toolFinderQuery'), results = $('#toolFinderResults'), status = $('#toolFinderStatus');
        input.value = '';
        const owns = () => active && owner === generation && app.modal.open && $('#toolFinderQuery') === input;
        const current = () => app.state === project && JSON.stringify(app.state) === signature &&
            app.panel === panel && app.selected === selected && app.panelRevision === revision &&
            media().every((value,index) => value === sources[index]);
        const isComposing = event => composing || event?.isComposing || event?.keyCode === 229;
        const invalidate = () => { active = false; generation++; resultGeneration++; };
        app.modal.onreplace = () => { if (owns()) invalidate(); };
        app.modal.onclose = () => {
            if (active && owner === generation && !app.modal.open) {
                invalidate(); $('#helpButton')?.focus();
            }
        };
        $('#cancelToolFinder').onclick = event => { if (owns() && !isComposing(event)) app.modal.close(); };
        const canFocus = node => node && !node.disabled && !node.hidden && !node.closest?.('[hidden]');
        function route(target) {
            invalidate();
            app.modal.close(); // Invalidate before native close can dispatch a late callback.
            if (target.action === 'seek') { app.openSeek(); return; }
            if (target.action === 'projectFiles') { app.showProjectFiles(); return; }
            app.switchPanel(target.panel);
            if (app.panel !== target.panel) return;
            if (target.details) {
                const disclosure = $(target.details);
                if (disclosure) disclosure.open = true;
            }
            const control = $(target.selector);
            const fallback = $(`[data-panel="${target.panel}"]`);
            const destination = canFocus(control) ? control : canFocus(fallback) ? fallback : null;
            destination?.focus();
            destination?.scrollIntoView?.({block:'nearest',inline:'nearest'});
        }
        function render() {
            if (!owns()) return;
            const request = ++resultGeneration, query = input.value;
            const targets = findToolTargets(query);
            status.innerHTML = text('finder.count',{count:targets.length});
            results.innerHTML = targets.length ? targets.map((target,index) =>
                `<button class="button full" id="toolFinderResult${index}">${text(target.labelKey)}</button>`).join('') :
                `<p>${text('finder.empty')}</p>`;
            targets.forEach((target,index) => {
                const selector = '#toolFinderResult'+index, button = $(selector);
                button.onclick = event => {
                    if (!owns() || request !== resultGeneration || $(selector) !== button || input.value !== query || isComposing(event)) return;
                    if (!current()) { resultGeneration++; results.innerHTML = ''; status.innerHTML = text('finder.stale'); return; }
                    if (blocked()) { app.toast(message('finder.busy')); return; }
                    route(target);
                };
            });
        }
        input.oncompositionstart = () => { if (owns()) { composing = true; resultGeneration++; } };
        input.oncompositionend = () => { if (owns()) { composing = false; render(); } };
        input.oninput = () => { if (owns() && !composing) render(); };
        render(); input.focus();
    }
    return {open};
}
