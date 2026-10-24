import { bindPreviewDrag, bindEditorKeyboard } from './editor-interactions.mjs';
import { icon } from './ui-format.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Wires static DOM controls and global shortcuts to the app's editing actions.
// No project state or media resources are owned here.
export function bindUi(app) {
    const { query: $, queryAll: $$ } = app;
    app.icons();
    $$('[data-panel]').forEach(button => button.onclick = () => {
        if (button.dataset.panel === app.panel)
            app.togglePanelSheet();
        else
            app.switchPanel(button.dataset.panel);
    });
    $('#panelClose')?.addEventListener('click', () => app.closePanelSheet());
    app.document.addEventListener('keydown', event => {
        if (event.key === 'Escape')
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
    $('#videoInput').onchange = event => event.target.files[0] && app.loadVideo(event.target.files[0]);
    $('#audioInput').onchange = event => event.target.files[0] && app.loadAudio(event.target.files[0]);
    $('#srtInput').onchange = event => event.target.files[0] && app.importSrt(event.target.files[0]);
    $('#projectInput').onchange = event => event.target.files[0] && app.importProjectSettings(event.target.files[0]);
    $('#projectName').onchange = event => app.edit(() => app.state.name = event.target.value.trim() || '제목 없는 쇼츠');
    $('#saveButton').onclick = () => app.saveProject(true);
    $('#playButton').onclick = () => app.playing ? app.pause() : app.play();
    $('#timeDisplay').onclick = () => app.openSeek();
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
        $('#muteButton').setAttribute('aria-label', app.muted ? '미리보기 음소거 해제' : '미리보기 음소거');
        app.renderInspector();
    };
    $('#speed').onchange = event => app.runEditorCommand('project.update', { patch: { speed: +event.target.value } });
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
    $('#trimButton').onclick = () => app.trim($('#trimStart').valueAsNumber, $('#trimEnd').valueAsNumber);
    $('#splitButton').onclick = app.split;
    $('#duplicateClipButton').onclick = app.duplicate;
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
        });
        app.seekTo(0);
    };
    for (const [id, delta] of [['moveLeft', -1], ['moveRight', 1]])
        $('#' + id).onclick = () => {
            const dest = app.selected + delta;
            if (dest < 0 || dest >= app.state.clips.length)
                return;
            app.pause();
            app.edit(() => {
                const clip = app.state.clips.splice(app.selected, 1)[0];
                app.state.clips.splice(dest, 0, clip);
                app.selected = dest;
            });
            app.seekTo(0);
        };
    $('#undoButton').onclick = () => app.undo();
    $('#redoButton').onclick = () => app.undo(true);
    $('#videoTrack').onclick = event => {
        const clip = event.target.closest('[data-clip]');
        if (!clip)
            return;
        app.pause();
        app.selected = +clip.dataset.clip;
        const current = app.state.clips[app.selected], rect = clip.getBoundingClientRect();
        const offset = app.state.clips.slice(0, app.selected).reduce((sum, item) => sum + item.end - item.start, 0);
        app.seekTo(offset + clamp((event.clientX - rect.left) / rect.width, 0, .999) * (current.end - current.start));
        app.renderInspector();
        app.renderTimeline();
        app.openInspector('clip');
        if (app.panel === 'settings')
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
        stepBlocked: () => app.persistence.restorePhase === 'restoring' || app.loadingMedia ||
            app.transcribing || app.audioRecording.requesting || app.audioRecording.current,
        stepOutput: direction => {
            app.pause();
            app.seekTo(app.current + direction * app.state.speed / 30);
        },
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
                app.toast('탭이 숨겨져 내보내기를 중단했습니다. 이 탭을 연 상태로 다시 시도하세요.');
            }
            else
                app.pause();
        }
    });
    app.window.addEventListener('beforeunload', event => {
        if (app.exporting || app.audioRecording.current || (app.persistence.restorePhase === 'failed' && JSON.stringify(app.state) !== app.persistence.recoveryBaseline)) {
            event.preventDefault();
            event.returnValue = true;
        }
    });
    app.video.addEventListener('seeked', app.requestDraw);
}
