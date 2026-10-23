import { mediaPanelMarkup, audioPanelMarkup, settingsPanelMarkup } from './panel-markup.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Renders the active workspace panel and owns panel navigation. Project edits and
// media lifetime stay in the app; this module only wires the current panel controls.
export function createWorkspacePanels(app) {
    const { query: $, queryAll: $$ } = app;
    let sheetOpen = false;

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
            setExpanded();
            return;
        }
        if (library)
            library.hidden = !sheetOpen;
        app.document.body.classList.toggle('panel-sheet-open', sheetOpen);
        setExpanded();
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
            download: app.downloadSrt,
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

    function renderPanel() {
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
                app.toast('프로젝트의 첫 장면으로 이동했습니다.');
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
            target.innerHTML = settingsPanelMarkup(app.state, app.state.clips[app.selected]);
            for (const [id, key] of [['mobileZoom', 'zoom'], ['captionSize', 'captionSize'], ['captionY', 'captionY'], ['panelVolume', 'volume']]) {
                const control = $('#' + id);
                app.inputHistory.bind(control, () => app.state[key], value => {
                    app.state[key] = value;
                    app.renderInspector();
                    app.draw();
                    app.scheduleSave();
                });
            }
            $('#resetPosition').onclick = () => app.edit(() => {
                app.state.zoom = 1;
                app.state.panX = 0;
                app.state.panY = 0;
            }, true);
            $('#panelTrimApply').onclick = () => app.trim($('#panelTrimStart').valueAsNumber, $('#panelTrimEnd').valueAsNumber);
        }
        app.icons(target);
        app.updateLayerGuide();
    }

    function switchPanel(next, { openSheet = true } = {}) {
        if (app.audioRecording.current && next !== 'audio') {
            app.toast('녹음을 먼저 완료해 주세요.');
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

    return { renderPanel, switchPanel, renderCaptionsPanel, navigateCaption, focusCaption, closePanelSheet, togglePanelSheet, syncPanelSheet: syncSheet };
}
