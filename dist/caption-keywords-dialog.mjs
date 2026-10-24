import { clearCaptionKeywords } from './core/caption-keywords.mjs';
import { validateProject } from './core/project.mjs';
import { text, message, formatError } from './i18n.mjs';

// One explicit reset of keyword fields, not caption styling or authored text.
export function createCaptionKeywordsDialog(app) {
    const $ = app.query;
    let generation = 0;
    const context = () => app.panel === 'text' && app.textLayer === 'caption';
    const blocked = () => !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        app.audioRecording.requesting || app.audioRecording.current ||
        (app.persistence.restorePhase !== 'ready' && !(app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid));
    function open() {
        if (!context() || app.modal.open || blocked()) return;
        const project = app.state, contents = JSON.stringify(project);
        const media = [app.sources.videoFile, app.sources.audioFile];
        app.modalOpen(message('keywords.clear'), `<p class="modal-copy">${text('keywords.confirm')}</p>`,
            `<div class="modal-foot"><button class="button" id="cancelClearKeywords">${text('shell.cancel')}</button>` +
            `<button class="button primary" id="confirmClearKeywords">${text('keywords.apply')}</button></div>`);
        const owner = ++generation, confirm = $('#confirmClearKeywords');
        const owns = () => generation === owner && app.modal.open && $('#confirmClearKeywords') === confirm;
        const invalidate = () => { if (generation === owner) generation++; };
        const close = () => {
            invalidate();
            app.modal.close();
            if (!app.modal.open && context()) $('#panelContent')?.querySelector('#clearKeywordEmphasis')?.focus();
        };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        $('#cancelClearKeywords').onclick = event => {
            if (owns() && !event?.isComposing && event?.keyCode !== 229) close();
        };
        confirm.onclick = event => {
            if (!owns() || blocked() || event?.isComposing || event?.keyCode === 229) return;
            if (!context() || app.state !== project || JSON.stringify(app.state) !== contents ||
                app.sources.videoFile !== media[0] || app.sources.audioFile !== media[1]) {
                app.toast(message('keywords.stale'));
                return;
            }
            try {
                const next = clearCaptionKeywords(project);
                if (next === project) {
                    close();
                    app.toast(message('keywords.unchanged'));
                    return;
                }
                validateProject(next);
                let applied = false;
                app.edit(() => { app.state = next; applied = true; }, true);
                if (applied && owns()) close();
            } catch (error) {
                app.toast(error.messageKey ? error : formatError(error));
            }
        };
    }
    return { open };
}
