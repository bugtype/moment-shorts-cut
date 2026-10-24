import { message, text } from './i18n.mjs';
import { outputDimensions } from './core/aspect-ratio.mjs';

// The dialog owns user intent; the exporter owns the paused render and encoding.
export function createScenePngDialog(app, exporter) {
    const { query: $ } = app;
    let generation = 0;
    const blocked = () => !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        !app.mediaReady() || app.audioRecording.requesting || app.audioRecording.current;

    function open(event) {
        if (app.panel !== 'settings' || app.modal.open || blocked() || event?.isComposing || event?.keyCode === 229) return;
        const project = app.state, signature = JSON.stringify(project);
        const media = [app.sources.videoFile, app.sources.audioFile];
        const owner = ++generation;
        const options = [720, 1080].map(quality => {
            const { width, height } = outputDimensions(project.ratio, quality);
            return `<option value="${quality}"${quality === 1080 ? ' selected' : ''}>${width} × ${height}</option>`;
        }).join('');
        app.modalOpen(message('scenePng.title'),
            `<p class="modal-copy">${text('scenePng.description')}</p><div class="modal-field"><label for="scenePngQuality">${text('shell.resolution')}</label><select id="scenePngQuality">${options}</select></div>`,
            `<div class="modal-foot"><button class="button" id="cancelScenePng">${text('shell.cancel')}</button><button class="button primary" id="saveScenePng">${text('scenePng.save')}</button></div>`);
        const save = $('#saveScenePng'), quality = $('#scenePngQuality');
        quality.value = '1080';
        const owns = () => owner === generation && app.modal.open && $('#saveScenePng') === save;
        const valid = () => app.panel === 'settings' && app.state === project && JSON.stringify(app.state) === signature &&
            app.sources.videoFile === media[0] && app.sources.audioFile === media[1];
        const invalidate = () => { if (owner === generation) generation++; };
        const close = () => {
            invalidate();
            app.modal.close();
            if (!app.modal.open && valid()) $('#openScenePng')?.focus();
        };
        app.modal.onreplace = invalidate;
        app.modal.onclose = () => { if (!app.modal.open) invalidate(); };
        let composing = false;
        quality.oncompositionstart = () => { if (owns()) composing = true; };
        quality.oncompositionend = () => { if (owns()) composing = false; };
        $('#cancelScenePng').onclick = event => {
            if (owns() && !event?.isComposing && event?.keyCode !== 229) close();
        };
        save.onclick = event => {
            if (!owns() || composing || event?.isComposing || event?.keyCode === 229) return;
            if (!valid()) { app.toast(message('scenePng.stale')); return; }
            if (blocked()) { app.toast(message('shell.scenePngUnavailable')); return; }
            if (exporter.save(Number(quality.value)) && owns()) close();
        };
        quality.focus();
    }
    return { open };
}
