import { text, mark, t, message, setValidity, setText } from './i18n.mjs';
import { esc } from './ui-format.mjs';
import { CommandError } from './core/validation.mjs';

// This dialog owns its file and clock choice; legacy hidden imports remain source-only.
export function createCaptionImportDialog(app, blocked) {
    const $ = app.query;
    let generation = 0;

    function open() {
        if (app.modal.open || blocked() || app.panel !== 'captions') return;

        const project = app.state;
        const contents = JSON.stringify(project);
        const selected = app.selected;
        const media = [app.sources.videoFile, app.sources.audioFile];
        const owner = ++generation;

        app.modalOpen(
            message('panels.importSrt'),
            `<label class="panel-label" for="subtitleImportFile">${text('panels.subtitleFile')}</label><input class="panel-input" id="subtitleImportFile" type="file" accept=".srt,.vtt,text/plain,text/vtt" required>` +
            `<label class="panel-label" for="subtitleImportClock">${text('panels.subtitleClock')}</label><select class="panel-select" id="subtitleImportClock"><option value="source" ${mark('panels.subtitleClockSource')}>${esc(t('panels.subtitleClockSource'))}</option><option value="output" ${mark('panels.subtitleClockOutput')}>${esc(t('panels.subtitleClockOutput'))}</option></select>` +
            `<p class="notice">${text('panels.subtitleReplaceWarning')}</p><div id="subtitleImportReport" aria-live="polite"></div>`,
            `<div class="modal-foot"><button class="button" id="cancelSubtitleImport">${text('shell.cancel')}</button><button class="button primary" id="confirmSubtitleImport">${text('importReview.review')}</button></div>`
        );

        const fileInput = $('#subtitleImportFile');
        const clock = $('#subtitleImportClock');
        const confirm = $('#confirmSubtitleImport');
        clock.value = 'source';
        let attemptVersion = 0;
        let pending = false;
        let composing = null;
        let prepared = null;
        const report = $('#subtitleImportReport');
        const clearReview = () => {
            prepared = null;
            report.innerHTML = '';
            setText(confirm, 'importReview.review');
        };

        const ownsDialog = () => generation === owner && app.modal.open &&
            $('#confirmSubtitleImport') === confirm;
        const originalContextIsCurrent = () => app.state === project &&
            JSON.stringify(app.state) === contents && app.panel === 'captions' &&
            app.selected === selected && app.sources.videoFile === media[0] &&
            app.sources.audioFile === media[1];
        const invalidate = () => {
            if (generation === owner) {
                generation++;
                attemptVersion++;
                prepared = null;
            }
        };
        const close = () => {
            invalidate();
            app.modal.close();
        };

        app.modal.onreplace = invalidate;
        app.modal.onclose = () => {
            if (!app.modal.open) invalidate();
        };
        $('#cancelSubtitleImport').onclick = () => {
            if (ownsDialog()) {
                close();
                if (app.panel === 'captions') $('#importSrt')?.focus();
            }
        };

        confirm.onclick = async event => {
            if (!ownsDialog() || pending || blocked() || composing ||
                event?.isComposing || event?.keyCode === 229) return;
            if (!originalContextIsCurrent()) {
                app.toast(message('panels.subtitleImportStale'));
                return;
            }

            const file = fileInput.files?.[0];
            const mode = clock.value;
            if (!file) {
                setValidity(fileInput, 'panels.subtitleChooseFile');
                fileInput.reportValidity?.();
                fileInput.focus();
                return;
            }
            if (!['source', 'output'].includes(mode)) {
                app.toast(message('panels.subtitleClockInvalid'));
                return;
            }

            const attemptOwner = prepared ? attemptVersion : ++attemptVersion;
            pending = true;
            confirm.disabled = true;
            const isCurrent = () => ownsDialog() && attemptOwner === attemptVersion &&
                fileInput.files?.[0] === file && clock.value === mode;
            try {
                const result = prepared ? await prepared.commit() : await app.importSrt(file, {
                    prepareOnly: true,
                    owned: true,
                    clock: mode,
                    isCurrent,
                    beforeCommit: () => {
                        if (!isCurrent() || !originalContextIsCurrent() || blocked()) {
                            throw new CommandError('CONFLICT', message('panels.subtitleImportStale'));
                        }
                    },
                });

                // Our successful commit replaces the project. Only failed attempts
                // must still match the original context before reporting an error.
                if (!isCurrent() ||
                    ((!result.ok || result.prepared) && (!originalContextIsCurrent() || blocked()))) return;
                if (result.stale) {
                    clearReview();
                    app.toast(message('importReview.expired'));
                    return result;
                }
                if (result.prepared) {
                    prepared = result;
                    const counts = result.report;
                    report.innerHTML =
                        [['accepted', counts.acceptedCaptions], ['clipped', counts.clippedCaptions],
                         ['discarded', counts.discardedRecognizedEntries]].map(([key, count]) =>
                            `<div class="modal-field"><span>${text('importReview.' + key)}</span><strong>${esc(String(count))}</strong></div>`).join('') +
                        `<p class="modal-copy">${text('importReview.limitations')}</p>`;
                    setText(confirm, 'panels.subtitleReplace');
                    return result;
                }
                if (result.ok) {
                    close();
                    app.focusCaption(0);
                    app.toast(result.message);
                } else {
                    app.toast(result.error);
                }
                return result;
            } finally {
                // An older completion cannot unlock a newer attempt's controls.
                if (ownsDialog() && attemptOwner === attemptVersion) {
                    pending = false;
                    confirm.disabled = false;
                }
            }
        };

        for (const input of [fileInput, clock]) {
            input.onchange = () => {
                if (ownsDialog()) {
                    attemptVersion++;
                    pending = false;
                    confirm.disabled = false;
                    setValidity(fileInput, '');
                    clearReview();
                }
            };
            input.oncompositionstart = () => {
                if (ownsDialog()) composing = input;
            };
            input.oncompositionend = () => {
                if (ownsDialog() && composing === input) composing = null;
            };
            // File/select Enter belongs to native activation, not form submission.
        }
        fileInput.focus();
    }
    return { open };
}
