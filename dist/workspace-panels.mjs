import { createScenePngExport } from './scene-png-export.mjs';
import { createScenePngDialog } from './scene-png-dialog.mjs';
import { message, setAttr } from './i18n.mjs';
import { mediaPanelMarkup, audioPanelMarkup, settingsPanelMarkup } from './panel-markup.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Renders the active workspace panel and owns panel navigation. Project edits and
// media lifetime stay in the app; this module only wires the current panel controls.
export function createWorkspacePanels(app) {
    const { query: $, queryAll: $$ } = app;
    let sheetOpen = false, renderGeneration = 0;
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

    // Compact layouts keep the preview visible and turn the side panel into a
    // sheet above the bottom tool rail. Desktop keeps the panel permanently docked.
    const isCompact = () => app.window.matchMedia?.('(max-width:700px), (max-height:560px) and (orientation:landscape)').matches === true;

    function syncSheet() {
        const library = $('#libraryPanel');
        if (!isCompact()) {
            sheetOpen = false;
            if (library)
                library.hidden = false;
            app.document.body.classList.remove('panel-sheet-open');
            fitSheet();
            setExpanded();
            return;
        }
        if (library)
            library.hidden = !sheetOpen;
        app.document.body.classList.toggle('panel-sheet-open', sheetOpen);
        fitSheet();
        setExpanded();
    }

    // The sheet grows from the rail up to just below the preview, so it uses the
    // room a given ratio leaves instead of an arbitrary share of the viewport.
    function fitSheet() {
        const library = $('#libraryPanel');
        if (!library)
            return;
        library.style.removeProperty('max-height');
        if (!isCompact() || !sheetOpen || app.window.matchMedia?.('(max-height:720px)').matches)
            return;
        const canvas = $('#canvasWrap')?.getBoundingClientRect();
        const rail = $('.rail')?.getBoundingClientRect();
        if (!canvas || !rail)
            return;
        const available = Math.floor(rail.top - canvas.bottom - 8);
        if (available > 0)
            library.style.maxHeight = `${Math.max(180, available)}px`;
    }

    function setExpanded() {
        $$('[data-panel]').forEach(button => {
            const active = button.dataset.panel === app.panel;
            button.setAttribute('aria-expanded', String(active && (!isCompact() || sheetOpen)));
        });
    }

    function setSheetOpen(open) {
        sheetOpen = !!open && isCompact();
        syncSheet();
    }

    function closePanelSheet() {
        if (!isCompact() || !sheetOpen)
            return;
        setSheetOpen(false);
        $$('[data-panel]').find(button => button.dataset.panel === app.panel)?.focus();
    }

    function togglePanelSheet() {
        if (!isCompact())
            return;
        setSheetOpen(!sheetOpen);
        if (sheetOpen)
            $('#panelClose')?.focus();
    }

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

    function renderPanel() {
        const generation = ++renderGeneration;
        const target = $('#panelContent');
        if (app.panel === 'templates') {
            app.templateWorkspace.render(target);
        }
        else if (app.panel === 'effects') {
            app.renderEffects(target);
        }
        else if (app.panel === 'media') {
            target.innerHTML = mediaPanelMarkup(app.state, app.sources.thumbnail);
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
            target.innerHTML = audioPanelMarkup(app.state, !!app.sources.audioFile, app.sources.audioFile ? app.duration() : 0);
            $('#chooseAudio').onclick = () => $('#audioInput').click();
            $('#recordButton').onclick = app.toggleRecording;
            if (app.sources.audioFile) {
                const file = app.sources.audioFile, project = app.state, audioURL = app.sources.audioURL;
                const button = $('#downloadOriginalAudio');
                let composing = false;
                target.oncompositionstart = () => { composing = true; };
                target.oncompositionend = () => { composing = false; };
                button.disabled = !app.mediaReady();
                button.onclick = event => {
                    if (composing || event?.isComposing || event?.keyCode === 229 || generation !== renderGeneration ||
                        app.panel !== 'audio' || $('#downloadOriginalAudio') !== button || app.state !== project ||
                        app.sources.audioFile !== file || app.sources.audioURL !== audioURL || app.modal.open ||
                        !app.editorReady || !app.mediaReady() || app.exporting || app.loadingMedia || app.transcribing ||
                        app.audioRecording.current || app.audioRecording.requesting) return;
                    try { app.download(file, file.name); }
                    catch { app.toast(message('panels.originalAudioDownloadFailed')); }
                };
                $('#removeAudio').onclick = () => {
                    if (app.recoveryBlocked() || app.audioRecording.current || app.audioRecording.requesting || app.loadingMedia)
                        return;
                    app.pause();
                    app.sources.audioFile = null;
                    app.state.audioName = '';
                    app.audio.removeAttribute('src');
                    if (app.sources.audioURL)
                        app.revokeObjectURL(app.sources.audioURL);
                    app.persistMedia();
                    app.changed();
                    renderPanel();
                };
                $('#audioOffset').onchange = event => app.edit(() => {
                    const next = clamp((+event.target.value || 0) * app.state.speed, 0, app.duration()), delta = next - app.state.audioOffset;
                    app.state.audioOffset = next;
                    app.state.captions = app.state.captions.map(caption => caption.basis === 'timeline'
                        ? { ...caption, start: Math.max(0, caption.start + delta), end: Math.max(.001, caption.end + delta) }
                        : caption);
                }, true);
                app.inputHistory.bind($('#audioVolume'), () => app.state.audioVolume, value => {
                    app.state.audioVolume = value;
                    $('#audioVolumeOutput').textContent = Math.round(app.state.audioVolume * 100) + '%';
                    app.renderInspector();
                    app.scheduleSave();
                });
            }
        }
        else if (app.panel === 'text') {
            app.renderDesignPanel(target);
        }
        else {
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
            app.bindTrimDrafts({ start: '#panelTrimStart', end: '#panelTrimEnd',
                startButton: '#panelTrimStartPlayhead', endButton: '#panelTrimEndPlayhead',
                current: () => app.panel === 'settings' && app.selected === trimIndex && app.state.clips[trimIndex] === trimClip,
            });
            const moveClipButton = $('#panelMoveClip');
            moveClipButton.onclick = event => {
                if (!event?.isComposing && event?.keyCode !== 229 && app.panel === 'settings' &&
                    $('#panelMoveClip') === moveClipButton && app.selected === trimIndex && app.state.clips[trimIndex] === trimClip)
                    app.openClipMove(moveClipButton);
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

    return { syncPreviewExportLabel, renderPanel, switchPanel, renderCaptionsPanel, navigateCaption, focusCaption, closePanelSheet, togglePanelSheet, syncPanelSheet: syncSheet };
}
