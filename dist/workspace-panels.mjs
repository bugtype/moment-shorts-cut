import { createPanelSheet } from './panel-sheet.mjs';
import { createScenePngExport } from './scene-png-export.mjs';
import { createScenePngDialog } from './scene-png-dialog.mjs';
import { message, setAttr, text } from './i18n.mjs';
import { icon, fmt } from './ui-format.mjs';
import { mediaPanelMarkup, audioPanelMarkup, settingsPanelMarkup } from './panel-markup.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Renders the active workspace panel and owns panel navigation. Project edits and
// media lifetime stay in the app; this module only wires the current panel controls.
export function createWorkspacePanels(app) {
    const { query: $, queryAll: $$ } = app;
    const { syncSheet, setSheetOpen, closePanelSheet, togglePanelSheet } =
        createPanelSheet(app, { query: $, queryAll: $$ });
    let renderGeneration = 0;
    let pendingTrim = null;
    let thirdsGrid = false;
    const desktopGrid = $('#thirdsGridDesktop');
    function syncThirdsGrid() {
        $('#thirdsGuide').hidden = !thirdsGrid;
        desktopGrid.checked = thirdsGrid;
        if (app.panel === 'settings') $('#thirdsGridPanel').checked = thirdsGrid;
    }
    function changeThirdsGrid(input, event) {
        if (app.modal.open || event?.isComposing || event?.keyCode === 229) {
            input.checked = thirdsGrid;
            return;
        }
        thirdsGrid = !!input.checked;
        syncThirdsGrid();
    }
    desktopGrid.checked = false;
    $('#thirdsGuide').hidden = true;
    desktopGrid.onchange = event => {
        if ($('#thirdsGridDesktop') === desktopGrid) changeThirdsGrid(desktopGrid, event);
    };
    const scenePng = createScenePngDialog(app, createScenePngExport(app));

    function renderCaptionsPanel(target) {
        app.captionPanel.render(target, {
            transcribing: app.transcribing,
            hasAudio: !!app.sources.audioFile,
            transcriptionStatus: app.transcriptionStatus,
        }, {
            design: () => {
                app.textLayer = 'caption';
                switchPanel('text');
            },
            generate: app.generateCaptions,
            download: format => app.downloadSubtitles(format),
        });
    }

    function navigateCaption(event) {
        if (app.exporting)
            return;
        switchPanel('captions');
        if (app.panel !== 'captions')
            return;
        const block = event?.target.closest('[data-caption-index]');
        if (!block)
            return;
        app.pause();
        app.seekTo(+block.dataset.captionTime);
        focusCaption(+block.dataset.captionIndex);
    }

    function focusCaption(index) {
        app.captionPanel.focus(index);
    }

    function syncPreviewExportLabel() {
        if (app.panel !== 'settings') return;
        const button = $('#savePreviewPng');
        if (!button) return;
        const dimensions = { width: app.canvas.width, height: app.canvas.height };
        setAttr(button, 'title', 'shell.previewPngDimensions', dimensions);
        setAttr(button, 'aria-label', 'shell.previewPngDimensions', dimensions);
    }

    function syncRecordingControl() {
        if (app.panel !== 'audio') return;
        const button = $('#recordButton');
        if (!button) return;
        const owner = app.audioRecording;
        const recording = owner.current?.state === 'recording';
        const finishing = !!owner.current && !recording;
        const preparing = !owner.current && owner.requesting;
        button.classList.toggle('recording', recording);
        button.disabled = finishing || preparing;
        button.innerHTML = recording
            ? icon('mic') + ' ' + text('shell.recordDone', { time: fmt(owner.elapsed) })
            : finishing ? text('shell.recordFinishing')
            : preparing ? text('shell.recordPreparing')
            : icon('mic') + ' ' + text('panels.recordMicrophone');
    }

    function bindAudioGain(id, key, generation) {
        const input = $('#' + id), project = app.state;
        const video = app.sources.videoFile, audio = app.sources.audioFile;
        const current = () => generation === renderGeneration && app.panel === 'audio' &&
            $('#' + id) === input && app.state === project && app.sources.videoFile === video && app.sources.audioFile === audio;
        const unavailable = () => !app.editorReady || app.modal.open || app.exporting || app.loadingMedia || app.transcribing ||
            app.audioRecording.requesting || app.audioRecording.current ||
            (app.persistence.restorePhase !== 'ready' && !(app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid));
        app.inputHistory.bind(input, () => project[key], value => {
            project[key] = value;
            app.renderInspector();
            app.scheduleSave();
        });
        for (const name of ['oninput', 'onpointerdown', 'onpointerup', 'onpointercancel', 'onblur']) {
            const handler = input[name];
            if (!handler) continue;
            input[name] = event => {
                if (!current()) return;
                if (name === 'oninput') {
                    if (unavailable() || event?.isComposing || event?.keyCode === 229) {
                        input.value = String(project[key]);
                        return;
                    }
                    const value = Number(input.value);
                    if (!input.value.trim() || !Number.isFinite(value) || value < 0 || value > 1) {
                        input.value = String(project[key]);
                        return;
                    }
                }
                handler(event);
            };
        }
    }

    function bindOriginalDownload(target, generation, kind) {
        const video = kind === 'video';
        const id = video ? '#downloadOriginalVideo' : '#downloadOriginalAudio';
        const fileKey = video ? 'videoFile' : 'audioFile';
        const urlKey = video ? 'sourceURL' : 'audioURL';
        const panel = video ? 'media' : 'audio';
        const file = app.sources[fileKey], sourceURL = app.sources[urlKey], project = app.state;
        const button = $(id);
        let composing = false;
        target.oncompositionstart = () => { composing = true; };
        target.oncompositionend = () => { composing = false; };
        button.disabled = !app.mediaReady();
        button.onclick = event => {
            if (composing || event?.isComposing || event?.keyCode === 229 || generation !== renderGeneration ||
                app.panel !== panel || $(id) !== button || app.state !== project ||
                app.sources[fileKey] !== file || app.sources[urlKey] !== sourceURL || (video && app.state.kind !== 'video') ||
                app.modal.open || !app.editorReady || !app.mediaReady() || app.exporting || app.loadingMedia || app.transcribing ||
                app.audioRecording.current || app.audioRecording.requesting) return;
            try { app.download(file, file.name); }
            catch { app.toast(message(video ? 'sourceVideo.failed' : 'panels.originalAudioDownloadFailed')); }
        };
    }

    function renderSettingsPanel(target, generation) {
        target.innerHTML = settingsPanelMarkup(app.state, app.state.clips[app.selected], app.loopPreview);
        for (const [id, key] of [['mobileZoom', 'zoom'], ['captionSize', 'captionSize'], ['captionY', 'captionY'], ['panelVolume', 'volume']]) {
            const control = $('#' + id);
            app.inputHistory.bind(control, () => app.state[key], value => {
                app.state[key] = value;
                app.renderInspector();
                app.draw();
                app.scheduleSave();
            });
        }
        const gaps = $('#keepPanelGaps'), gapProject = app.state, gapGeneration = renderGeneration;
        gaps.onclick = event => {
            if (app.panel === 'settings' && app.state === gapProject && gapGeneration === renderGeneration && $('#keepPanelGaps') === gaps &&
                !event?.isComposing && event?.keyCode !== 229) app.openKeepGaps('keepPanelGaps');
        };
        const framing = $('#openPanelFraming'), framingProject = app.state, framingGeneration = renderGeneration;
        framing.onclick = event => {
            if (app.panel === 'settings' && app.state === framingProject && framingGeneration === renderGeneration && $('#openPanelFraming') === framing &&
                !event?.isComposing && event?.keyCode !== 229) app.openFraming('openPanelFraming');
        };
        const grid = $('#thirdsGridPanel'), gridGeneration = renderGeneration;
        syncThirdsGrid();
        grid.onchange = event => {
            if (app.panel === 'settings' && gridGeneration === renderGeneration && $('#thirdsGridPanel') === grid)
                changeThirdsGrid(grid, event);
        };
        const sceneButton = $('#openScenePng'), sceneGeneration = renderGeneration;
        sceneButton.onclick = event => {
            if (sceneGeneration === renderGeneration && $('#openScenePng') === sceneButton) scenePng.open(event);
        };
        const savePreview = $('#savePreviewPng'), previewProject = app.state;
        syncPreviewExportLabel();
        savePreview.onclick = () => {
            if (app.panel === 'settings' && app.state === previewProject && $('#savePreviewPng') === savePreview)
                app.savePreview();
        };
        $('#resetPosition').onclick = () => app.edit(() => {
            app.state.zoom = 1;
            app.state.panX = 0;
            app.state.panY = 0;
        }, true);
        const loop = $('#loopPreview');
        loop.checked = app.loopPreview;
        loop.onchange = () => {
            if (app.panel !== 'settings' || $('#loopPreview') !== loop) return;
            if (!app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
                !app.mediaReady() || app.audioRecording.requesting || app.audioRecording.current) {
                loop.checked = app.loopPreview;
                return;
            }
            app.setLoopPreview(loop.checked);
        };
        const trimClip = app.state.clips[app.selected], trimIndex = app.selected;
        pendingTrim = app.bindTrimDrafts({ start: '#panelTrimStart', end: '#panelTrimEnd',
            startButton: '#panelTrimStartPlayhead', endButton: '#panelTrimEndPlayhead',
            current: () => app.panel === 'settings' && app.selected === trimIndex && app.state.clips[trimIndex] === trimClip,
        });
        const moveClipButton = $('#panelMoveClip');
        moveClipButton.onclick = event => {
            if (!event?.isComposing && event?.keyCode !== 229 && app.panel === 'settings' &&
                $('#panelMoveClip') === moveClipButton && app.selected === trimIndex && app.state.clips[trimIndex] === trimClip)
                app.openClipMove(moveClipButton);
        };
        const duplicateRangeButton = $('#panelDuplicateClipRange');
        duplicateRangeButton.onclick = event => {
            if (app.panel === 'settings' && renderGeneration === generation &&
                $('#panelDuplicateClipRange') === duplicateRangeButton && app.selected === trimIndex && app.state.clips[trimIndex] === trimClip)
                app.openClipDuplicate(duplicateRangeButton, event);
        };
        const removeRangeButton = $('#panelRemoveClipRange');
        removeRangeButton.disabled = app.state.clips.length <= 1;
        removeRangeButton.onclick = event => {
            if (!event?.isComposing && event?.keyCode !== 229 && app.panel === 'settings' &&
                $('#panelRemoveClipRange') === removeRangeButton && app.selected === trimIndex && app.state.clips[trimIndex] === trimClip)
                app.openClipRange(removeRangeButton);
        };
        $('#panelTrimApply').onclick = () => app.trim($('#panelTrimStart').valueAsNumber, $('#panelTrimEnd').valueAsNumber);
    }

    function renderAudioPanel(target, generation) {
        target.innerHTML = audioPanelMarkup(app.state, !!app.sources.audioFile, app.sources.audioFile ? app.duration() : 0);
        $('#chooseAudio').onclick = () => $('#audioInput').click();
        $('#recordButton').onclick = app.toggleRecording;
        syncRecordingControl();
        if (app.state.kind === 'video') bindAudioGain('audioSourceVolume', 'volume', generation);
        if (app.sources.audioFile) {
            bindOriginalDownload(target, generation, 'audio');
            $('#removeAudio').onclick = () => {
                if (app.recoveryBlocked() || app.audioRecording.current || app.audioRecording.requesting || app.loadingMedia)
                    return;
                app.pause();
                app.sources.audioFile = null;
                app.state.audioName = '';
                app.audio.removeAttribute('src');
                try { app.audio.load(); } catch { /* Best-effort native resource reset. */ }
                if (app.sources.audioURL)
                    app.revokeObjectURL(app.sources.audioURL);
                app.persistMedia();
                app.changed();
                renderPanel();
            };
            $('#audioOffset').onchange = event => {
                const value = Number(event.target.value);
                if (!event.target.value.trim() || !Number.isFinite(value)) {
                    app.toast(message('panels.audioStartInvalid'));
                    return;
                }
                const offset = app.state.audioOffset;
                // Compare the displayed output time before inverse conversion can drift.
                // An out-of-range stored offset still takes the existing clamp path.
                if (offset >= 0 && offset <= app.duration() && value === offset / app.state.speed) return;
                const next = clamp(value * app.state.speed, 0, app.duration()), delta = next - offset;
                if (next > 86400) {
                    app.toast(message('errors.numberRange'));
                    return;
                }
                const captions = app.state.captions.map(caption => caption.basis === 'timeline'
                    ? { ...caption, start: Math.max(0, caption.start + delta), end: Math.max(.001, caption.end + delta) }
                    : caption);
                if (captions.some(caption => caption.basis === 'timeline' &&
                    (!Number.isFinite(caption.start) || !Number.isFinite(caption.end) || caption.start < 0 ||
                        caption.end > 86400 || caption.end <= caption.start))) {
                    app.toast(message('errors.shiftRange'));
                    return;
                }
                app.edit(() => {
                    app.state.audioOffset = next;
                    app.state.captions = captions;
                }, true);
            };
            bindAudioGain('audioVolume', 'audioVolume', generation);
        }
    }

    function renderPanel() {
        const generation = ++renderGeneration;
        pendingTrim = null;
        const target = $('#panelContent');
        if (app.panel === 'templates') {
            app.templateWorkspace.render(target);
        }
        else if (app.panel === 'effects') {
            app.renderEffects(target);
        }
        else if (app.panel === 'media') {
            target.innerHTML = mediaPanelMarkup(app.state, app.sources.thumbnail, !!app.sources.videoFile);
            if (app.state.kind === 'video' && app.sources.videoFile) bindOriginalDownload(target, generation, 'video');
            $('#chooseVideo').onclick = () => $('#videoInput').click();
            $('#assetSelect').onclick = () => {
                app.seekTo(0);
                app.toast(message('panels.firstScene'));
            };
            $('#loadDemo').onclick = () => app.confirmReset(true);
            const drop = $('#dropzone');
            ['dragenter', 'dragover'].forEach(name => drop.addEventListener(name, event => {
                event.preventDefault();
                drop.classList.add('dragover');
            }));
            ['dragleave', 'drop'].forEach(name => drop.addEventListener(name, event => {
                event.preventDefault();
                drop.classList.remove('dragover');
                if (name === 'drop' && event.dataTransfer.files[0])
                    app.loadVideo(event.dataTransfer.files[0]);
            }));
        }
        else if (app.panel === 'captions') {
            renderCaptionsPanel(target);
        }
        else if (app.panel === 'audio') {
            renderAudioPanel(target, generation);
        }
        else if (app.panel === 'text') {
            app.renderDesignPanel(target);
        }
        else {
            renderSettingsPanel(target, generation);
        }
        app.icons(target);
        app.updateLayerGuide();
    }

    function switchPanel(next, { openSheet = true } = {}) {
        if (app.audioRecording.current && next !== 'audio') {
            app.toast(message('panels.finishRecording'));
            return;
        }
        app.panel = next;
        if (next === 'settings')
            app.openInspector('frame');
        else if (next === 'captions' || (next === 'text' && app.textLayer === 'caption'))
            app.openInspector('caption');
        $$('[data-panel]').forEach(button => {
            button.classList.toggle('active', button.dataset.panel === app.panel);
            button.setAttribute('aria-pressed', button.dataset.panel === app.panel);
        });
        renderPanel();
        if (openSheet)
            setSheetOpen(true);
        else
            syncSheet();
    }

    return { syncRecordingControl, revision: () => renderGeneration, hasPendingTrim: () => pendingTrim?.() === true,
        syncPreviewExportLabel, renderPanel, switchPanel, renderCaptionsPanel, navigateCaption, focusCaption, closePanelSheet, togglePanelSheet, syncPanelSheet: syncSheet };
}
