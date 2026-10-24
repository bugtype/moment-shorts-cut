import { text, mark, t, message, setValidity, setText } from './i18n.mjs';
import { esc } from './ui-format.mjs';
import { MAX_CAPTIONS } from './captions.mjs';
import { CommandError } from './core/validation.mjs';

// This dialog owns file, clock and action choices; legacy imports still replace in source time.
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
            `<label class="panel-label" for="subtitleImportMode">${text('panels.subtitleImportMode')}</label><select class="panel-select" id="subtitleImportMode"><option value="replace" ${mark('panels.subtitleImportReplace')}>${esc(t('panels.subtitleImportReplace'))}</option><option value="append" ${mark('panels.subtitleImportAppend')}>${esc(t('panels.subtitleImportAppend'))}</option></select>` +
            `<p class="notice" id="subtitleImportWarning">${text('panels.subtitleReplaceWarning')}</p><div id="subtitleImportReport" aria-live="polite"></div>`,
            `<div class="modal-foot"><button class="button" id="cancelSubtitleImport">${text('shell.cancel')}</button><button class="button primary" id="confirmSubtitleImport">${text('importReview.review')}</button></div>`
        );

        const fileInput = $('#subtitleImportFile');
        const clock = $('#subtitleImportClock');
        const action = $('#subtitleImportMode');
        const confirm = $('#confirmSubtitleImport');
        action.value = 'replace';
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
            const mode = clock.value, importMode = action.value;
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

            if (!['replace', 'append'].includes(importMode)) {
                app.toast(message('panels.subtitleImportModeInvalid')); return;
            }

            const attemptOwner = prepared ? attemptVersion : ++attemptVersion;
            pending = true;
            confirm.disabled = true;
            const isCurrent = () => ownsDialog() && attemptOwner === attemptVersion &&
                fileInput.files?.[0] === file && clock.value === mode && action.value === importMode;
            try {
                const result = prepared ? await prepared.commit() : await app.importSrt(file, {
                    prepareOnly: true,
                    owned: true,
                    clock: mode,
                    mode: importMode,
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
                        `<div class="modal-field"><span>${text('importReview.afterImport', {limit:MAX_CAPTIONS})}</span><strong>${counts.acceptedCaptions + (importMode === 'append' ? project.captions.length : 0)}</strong></div>` +
                        `<p class="modal-copy">${text('importReview.limitations')}</p>`;
                    setText(confirm, importMode === 'append' ? 'panels.subtitleAdd' : 'panels.subtitleReplace');
                    return result;
                }
                if (result.ok) {
                    close();
                    app.focusCaption(importMode === 'append' ? project.captions.length : 0);
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

        for (const input of [fileInput, clock, action]) {
            input.onchange = () => {
                if (ownsDialog()) {
                    attemptVersion++;
                    pending = false;
                    confirm.disabled = false;
                    setValidity(fileInput, '');
                    clearReview();
                    setText($('#subtitleImportWarning'), action.value === 'append' ? 'panels.subtitleAppendWarning' : 'panels.subtitleReplaceWarning');
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
