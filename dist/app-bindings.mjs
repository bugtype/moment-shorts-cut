import { adjacentCut } from './timeline-view.mjs';
import {t, message, setAttr} from './i18n.mjs';
import { bindPreviewDrag, bindEditorKeyboard } from './editor-interactions.mjs';
import { icon } from './ui-format.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Wires static DOM controls and global shortcuts to the app's editing actions.
// No project state or media resources are owned here.
export function bindUi(app) {
    const { query: $, queryAll: $$ } = app;
    app.icons();
    $('#uiLocale').onchange = event => app.setUiLocale(event.target.value);
    $$('[data-panel]').forEach(button => button.onclick = () => {
        if (button.dataset.panel === app.panel)
            app.togglePanelSheet();
        else
            app.switchPanel(button.dataset.panel);
    });
    $('#panelClose')?.addEventListener('click', () => app.closePanelSheet());
    app.document.addEventListener('keydown', event => {
        // Modal dialogs and composition own Escape before the underlying sheet.
        if (event.key === 'Escape' && !app.modal.open && !event.defaultPrevented &&
            !event.isComposing && event.keyCode !== 229)
            app.closePanelSheet();
    });
    app.document.addEventListener('click', event => {
        const ratio = event.target.closest('[data-ratio]'), fit = event.target.closest('[data-fit]'), style = event.target.closest('[data-style]');
        if (ratio)
            app.setRatio(ratio.dataset.ratio);
        if (fit)
            app.edit(() => app.state.fit = fit.dataset.fit);
        if (style)
            app.edit(() => {
                app.state.style = style.dataset.style;
                app.state.captionItalic = app.state.style === 'impact';
                app.state.captionStroke = app.state.style === 'minimal' ? 2 : 3;
            }, app.panel === 'text');
    });
    $('#videoInput').onchange = event => {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = ''; // A refused import must allow the same file to be selected again.
        return app.loadVideo(file);
    };
    $('#audioInput').onchange = event => {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = ''; // A refused import must allow the same file to be selected again.
        return app.loadAudio(file);
    };
    $('#srtInput').onchange = event => event.target.files[0] && app.importSrt(event.target.files[0]);
    $('#projectInput').onchange = event => event.target.files[0] && app.importProjectSettings(event.target.files[0], app.captureSettingsImportClose());
    $('#projectInput').oncancel = () => { app.captureSettingsImportClose(); };
    $('#projectName').onchange = event => app.edit(() => {
        app.state.name = event.target.value.trim() || t('shell.untitled');
        event.target.value = app.state.name;
    });
    $('#saveButton').onclick = () => app.saveProject(true);
    $('#projectFilesButton').onclick = () => app.showProjectFiles();
    $('#playButton').onclick = () => app.playing ? app.pause() : app.play();
    $('#timeDisplay').onclick = () => app.openSeek();
    const navigateCut = direction => {
        if (!app.editorReady || app.modal.open || app.exporting || app.loadingMedia || app.transcribing ||
            !app.mediaReady() || app.audioRecording.requesting || app.audioRecording.current) return false;
        const next = adjacentCut(app.state.clips, app.current, direction);
        if (next == null) return false;
        app.pause();
        app.seekTo(next);
        return true;
    };
    $('#previousCutButton').onclick = () => navigateCut(-1);
    $('#nextCutButton').onclick = () => navigateCut(1);
    $('#startButton').onclick = () => {
        app.pause();
        app.seekTo(0);
    };
    $('#seek').oninput = event => {
        app.pause();
        app.seekTo(+event.target.value);
    };
    $('#muteButton').onclick = () => {
        app.muted = !app.muted;
        $('#muteButton').innerHTML = icon(app.muted ? 'mute' : 'volume');
        setAttr($('#muteButton'), 'aria-label', app.muted ? 'shell.unmute' : 'shell.mute');
        app.renderInspector();
    };
    $('#speed').onchange = event => app.changeSpeed(event.target.value);
    const gaps = $('#keepGapsButton');
    gaps.onclick = event => {
        if ($('#keepGapsButton') === gaps && !event?.isComposing && event?.keyCode !== 229) app.openKeepGaps('keepGapsButton');
    };
    const framing = $('#openFraming');
    framing.onclick = event => {
        if ($('#openFraming') === framing && !event?.isComposing && event?.keyCode !== 229) app.openFraming('openFraming');
    };
    app.inputHistory.bind($('#zoom'), () => app.state.zoom, value => {
        app.state.zoom = value;
        app.draw();
        app.renderInspector();
        app.scheduleSave();
    });
    app.inputHistory.bind($('#volume'), () => app.state.volume, value => {
        app.state.volume = value;
        app.renderInspector();
        app.scheduleSave();
    });
    app.bindTrimDrafts({ start: '#trimStart', end: '#trimEnd',
        startButton: '#trimStartPlayhead', endButton: '#trimEndPlayhead',
        current: () => app.inspectorView.hasTrimTarget(app.state.clips[app.selected]),
    });
    $('#trimButton').onclick = () => app.trim($('#trimStart').valueAsNumber, $('#trimEnd').valueAsNumber);
    $('#splitButton').onclick = app.split;
    $('#duplicateClipButton').onclick = app.duplicate;
    const duplicateRangeButton = $('#duplicateClipRangeButton');
    duplicateRangeButton.onclick = event => app.openClipDuplicate(duplicateRangeButton, event);
    $('#timelineToggle').onclick = () => {
        app.timelineView.setCollapsed(!app.timelineView.isCollapsed());
        app.resizePreview();
    };
    $('#timelineZoom').onclick = () => {
        app.timelineView.cycleZoom();
        app.renderTimeline();
    };
    // Pinching the tracks changes zoom around the fingers' midpoint, so the time
    // under them stays put while the lane grows or shrinks.
    const timelineBody = $('#timelineBody'), zoomLevels = app.timelineView.zoomLevels();
    const touchDistance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    let pinch = null;
    timelineBody.addEventListener('touchstart', event => {
        if (event.touches.length !== 2) {
            pinch = null;
            return;
        }
        const area = $('#tracksArea').getBoundingClientRect();
        const mid = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        pinch = {
            distance: touchDistance(event.touches),
            zoom: app.timelineView.getZoom(),
            at: area.width > 0 ? Math.max(0, Math.min(1, (mid - area.left) / area.width)) : 0,
        };
    }, { passive: true });
    timelineBody.addEventListener('touchmove', event => {
        if (!pinch || event.touches.length !== 2)
            return;
        event.preventDefault();
        const scale = touchDistance(event.touches) / Math.max(1, pinch.distance);
        const start = zoomLevels.indexOf(pinch.zoom);
        const next = zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, start + Math.round(Math.log2(scale))))];
        if (next === app.timelineView.getZoom())
            return;
        app.timelineView.setZoom(next);
        app.renderTimeline();
        const area = $('#tracksArea').getBoundingClientRect();
        const mid = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        // The client rect is already shifted by scrolling; apply only the anchor delta.
        timelineBody.scrollLeft = Math.max(0, timelineBody.scrollLeft + pinch.at * area.width - (mid - area.left));
    }, { passive: false });
    ['touchend', 'touchcancel'].forEach(name => timelineBody.addEventListener(name, event => {
        if (event.touches.length < 2)
            pinch = null;
    }));
    // Landscape phones cannot fit the preview, player and tracks together; start
    // with the canvas in view and leave the expanded timeline one tap away.
    if (app.window.matchMedia?.('(max-height: 560px) and (orientation: landscape)')?.matches)
        app.timelineView.setCollapsed(true);
    $('#deleteButton').onclick = () => {
        if (app.state.clips.length <= 1)
            return;
        app.pause();
        app.edit(() => {
            app.state.clips.splice(app.selected, 1);
            app.selected = Math.min(app.selected, app.state.clips.length - 1);
        }, app.panel === 'settings');
        app.seekTo(0);
    };
    $('#removeClipRangeButton').onclick = event => { if (!event?.isComposing) app.openClipRange($('#removeClipRangeButton')); };
    $('#moveClipButton').onclick = event => { if (!event?.isComposing) app.openClipMove($('#moveClipButton')); };
    for (const [id, delta] of [['moveLeft', -1], ['moveRight', 1]])
        $('#' + id).onclick = event => {
            if (!app.modal.open && !event?.isComposing && event?.keyCode !== 229) app.moveClip(app.selected + delta);
        };
    $('#undoButton').onclick = () => app.undo();
    $('#redoButton').onclick = () => app.undo(true);
    $('#videoTrack').onclick = event => {
        const clip = event.target.closest('[data-clip]');
        if (!clip)
            return;
        app.pause();
        const selectionChanged = app.selected !== +clip.dataset.clip;
        app.selected = +clip.dataset.clip;
        const current = app.state.clips[app.selected], rect = clip.getBoundingClientRect();
        const offset = app.state.clips.slice(0, app.selected).reduce((sum, item) => sum + item.end - item.start, 0);
        const fraction = event.detail === 0 ? 0 : clamp((event.clientX - rect.left) / rect.width, 0, .999);
        app.seekTo(offset + fraction * (current.end - current.start));
        app.renderInspector();
        app.renderTimeline();
        app.openInspector('clip');
        if (app.panel === 'settings' && selectionChanged)
            app.renderPanel();
    };
    $('#ruler').onclick = event => {
        app.pause();
        const rect = event.currentTarget.getBoundingClientRect();
        app.seekTo((event.clientX - rect.left) / rect.width * app.duration());
    };
    $('#captionTrack').onclick = app.navigateCaption;
    $('#audioTrack').onclick = () => app.switchPanel('audio');
    $('#ratioShortcut').onclick = () => app.switchPanel('settings');
    $('#titleTrack').onclick = event => {
        const id = event.target.closest('[data-track-card]')?.dataset.trackCard;
        if (id) {
            app.selectedCard = id;
            app.effectTab = 'cards';
            const card = app.state.overlays.find(item => item.id === id);
            app.pause();
            if (card)
                app.seekTo(Math.min(card.end - .001, card.start + .2) * app.state.speed);
            app.switchPanel('effects');
        }
        else {
            app.textLayer = event.target.closest('[data-track-layer]')?.dataset.trackLayer || 'title';
            app.switchPanel('text');
        }
    };
    $('#safeButton').onclick = () => {
        const button = $('#safeButton');
        $('#safeGuide').hidden = !$('#safeGuide').hidden;
        button.setAttribute('aria-pressed', !$('#safeGuide').hidden);
    };
    $('#resetButton').onclick = app.confirmReset;
    $('#exportButton').onclick = app.exportDialog;
    $('#helpButton').onclick = app.showHelp;
    app.modal.addEventListener('cancel', event => {
        if (app.exporting)
            event.preventDefault();
    });
    bindPreviewDrag(app.canvas, {
        getProject: () => app.state,
        blocked: () => app.exporting || app.persistence.restorePhase === 'restoring',
        pause: () => app.pause(),
        selection: () => {
            const scene = app.selectedSceneLayer();
            return { scene, mode: scene ? 'scene' : app.panel === 'text' && app.textLayer !== 'frame' ? app.textLayer : 'video' };
        },
        snapshot: () => app.snapshot(),
        preview: () => {
            app.updateLayerGuide();
            app.requestDraw();
        },
        commit: () => {
            app.changed();
            if (app.panel === 'text' || app.panel === 'effects')
                app.renderPanel();
        },
    });
    bindEditorKeyboard(app.document, {
        blocked: () => app.modal.open || app.exporting,
        stepBlocked: () => !app.mediaReady() || app.loadingMedia ||
            app.transcribing || app.audioRecording.requesting || app.audioRecording.current,
        stepOutput: direction => {
            app.pause();
            app.seekTo(app.current + direction * app.state.speed / 30);
        },
        navigateCut,
        togglePlayback: () => app.playing ? app.pause() : app.play(),
        undo: redo => app.undo(redo),
        seekBy: delta => {
            app.pause();
            app.seekTo(app.current + delta);
        },
    });
    app.window.addEventListener('resize', () => {
        app.resizePreview();
        app.syncPanelSheet();
    });
    app.document.addEventListener('visibilitychange', () => {
        if (app.document.hidden) {
            if (app.exporting) {
                app.stopExport(true);
                app.toast(message('shell.hiddenExport'));
            }
            else
                app.pause();
        }
    });
    app.window.addEventListener('beforeunload', event => {
        if (app.exporting || app.audioRecording.current || app.persistence.hasUnsavedChanges()) {
            event.preventDefault();
            event.returnValue = true;
        }
    });
    app.video.addEventListener('seeked', app.requestDraw);
    app.video.addEventListener('error', () => app.playback.handleVideoError());
}
