import { createCaptionInspectionDialog } from './caption-inspection-dialog.mjs';
import { createTextFileWorkflow } from './text-file-workflow.mjs';
import { createMediaSources } from './media-sources.mjs';
import { createProjectPersistence } from './project-persistence.mjs';
import { createCaptionPanel } from './caption-panel.mjs';
import { createCaptionGeneration } from './caption-generation.mjs';
import { createInspectorView } from './inspector-view.mjs';
import { createTemplatePreview } from './template-preview.mjs';
import { createVideoExport } from './video-export.mjs';
import { createAudioRecording } from './audio-recording.mjs';
import { createTranscriptionClient } from './transcription-client.mjs';
import { icon, esc, fmt } from './ui-format.mjs';
import { createDemoProject, srtTimestamp } from './core/project.mjs';
import { prepareCommand } from './core/commands.mjs';
import { CommandError } from './core/validation.mjs';
import { createEditorService } from './integration/editor-service.mjs';
import { editedCaptions } from './captions.mjs';
import { createTimelineView } from './timeline-view.mjs';
import { createInputHistory } from './input-history.mjs';
import { retimeOutputLayers } from './effects.mjs';
import { applyTemplate, visualPreset } from './template-catalog.mjs';
import { createTemplateWorkspace } from './template-workspace.mjs';
import { createCompositionRenderer } from './composition-renderer.mjs';
import { createProjectStore } from './project-store.mjs';
import { createPlayback } from './playback.mjs';
import { createExportFlow } from './export-flow.mjs';
import { createMediaLoader } from './media-loader.mjs';
import { createDesignWorkspace } from './design-workspace.mjs';
import { createWorkspacePanels } from './workspace-panels.mjs';
import { bindUi } from './app-bindings.mjs';
import { createEditingActions } from './editing-actions.mjs';
import { createCaptionFlow } from './caption-flow.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function icons(root = document) {
    $$('[data-icon]', root).forEach(el => {
        if (!el.querySelector('.icon'))
            el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    });
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const initial = () => createDemoProject();

// App-owned mutable session state. The `app` facade below lets extracted modules
// read and update these bindings without sharing module scope.
let state = initial(), current = 0, selected = 0, playing = false, panel = 'templates';
let textLayer = 'title', history = [], future = [], exporting = false, muted = false;
let transcribing = false, transcriptionStatus = '', exportCancelled = false;
let timelineCache = null, frameHandle = 0, paintHandle = 0, lastDrawTime = -Infinity;
let playRequest = 0, loadingMedia = false, lastTick = 0, sampleRaster = null;
let lastSaveStatus = '', effectTab = 'cards', selectedCard = null, cardPlaybackEnd = null;
let editorReady = false, resolveEditorReady;
const editorReadyPromise = new Promise(resolve => {
    resolveEditorReady = resolve;
});

const video = $('#sourceVideo'), audio = $('#sourceAudio'), canvas = $('#preview');
const ctx = canvas.getContext('2d'), sample = new Image(), modal = $('#modal');
const composition = createCompositionRenderer(() => document.createElement('canvas'));
const projectStore = createProjectStore();
const sources = createMediaSources({ video, audio });
const inspectorView = createInspectorView($, $$);
const timelineView = createTimelineView($, () => performance.now());
const videoExport = createVideoExport({
    createCanvas: () => document.createElement('canvas'),
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
    onRelease: () => {
        exporting = false;
        document.body.classList.remove('exporting');
    },
});
const transcription = createTranscriptionClient(() => new Worker('./transcribe-worker.js', { type: 'module' }));
const captionGeneration = createCaptionGeneration({
    transcription,
    getProject: () => state,
    getFile: source => source === 'audio' ? sources.audioFile : sources.videoFile,
    getDuration: () => duration(),
});
const audioRecording = createAudioRecording({
    prepare: () => pause(),
    onReady: (file, recorder) => loadAudio(file, recorder),
    onError: message => toast(message),
    onIdle: () => {
        if (panel === 'audio')
            renderPanel();
    },
    onProgress: seconds => {
        const button = $('#recordButton');
        if (seconds === 0) {
            button.classList.add('recording');
            button.innerHTML = icon('mic') + ' 녹음 완료 · 00:00';
        }
        else if (button)
            button.innerHTML = icon('mic') + ` 녹음 완료 · ${fmt(seconds)}`;
    },
});
const persistence = createProjectPersistence({
    store: projectStore, sources,
    getProject: () => state,
    replaceProject: project => { state = project; timelineCache = null; },
    saveStatus: (text, ok) => saveStatus(text, ok),
    toast: message => toast(message),
    pause: () => pause(),
});
const templatePreview = createTemplatePreview({
    composition,
    getMedia: () => ({ source: sampleRaster || sample, ready: sample.complete }),
    modal,
    openModal: (title, body, foot) => modalOpen(title, body, foot),
    query: $,
    onApply: (template, withContent) => {
        if (template.custom)
            edit(() => applyTemplate(state, template, withContent));
        else if (!runEditorCommand('template.apply', { templateId: template.id, withContent }))
            return;
        modal.close();
        selectedCard = state.overlays[0]?.id;
        renderPanel();
        seekTo(0);
        toast(withContent ? '예시 타이틀과 구간별 문구를 적용했습니다. 문구를 내 영상에 맞게 수정하세요.' : '스타일을 적용했습니다. 기존 문구와 자막은 유지했습니다.');
    },
});
const templateWorkspace = createTemplateWorkspace({
    getProject: () => state,
    query: $, modal,
    openModal: (title, body, foot) => modalOpen(title, body, foot),
    thumbnail: templatePreview.draw,
    preview: template => { pause(); templatePreview.open(template); },
    refresh: () => renderPanel(),
    navigate: next => switchPanel(next),
    download: (blob, name) => download(blob, name),
    toast: message => toast(message),
});
const captionInspection = createCaptionInspectionDialog({
    getProject: () => state, query: $, modal,
    openModal: (...args) => modalOpen(...args),
    blocked: () => !editorReady || exporting || loadingMedia || transcribing || persistence.restorePhase !== 'ready' || audioRecording.requesting || audioRecording.current,
    pause, seek: time => seekTo(time),
    focusCaption: index => { switchPanel('captions'); focusCaption(index); },
    toast: message => toast(message),
});
const captionPanel = createCaptionPanel({
    inspect: () => captionInspection.open(),
    execute: (command, args) => app.runEditorCommand(command, args),
    query: $, queryAll: $$,
    getProject: () => state,
    getDuration: () => duration(),
    sourceTime: () => locate(current).source,
    edit: (change, refresh) => edit(change, refresh),
    refresh: () => renderPanel(),
    toast: message => toast(message),
});
const inputHistory = createInputHistory(snapshot, () => exporting || persistence.restorePhase === 'restoring');

function timelineIndex() {
    if (timelineCache?.clips === state.clips)
        return timelineCache;
    let total = 0;
    const entries = state.clips.map((clip, index) => {
        const entry = { clip, index, offset: total };
        total += clip.end - clip.start;
        return entry;
    });
    return timelineCache = { clips: state.clips, entries, total };
}
const duration = () => timelineIndex().total;
function locate(t) {
    const { entries } = timelineIndex();
    let low = 0, high = entries.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1, entry = entries[middle];
        if (t < entry.offset + entry.clip.end - entry.clip.start)
            high = middle;
        else
            low = middle + 1;
    }
    const entry = entries[low];
    return {
        index: entry.index,
        source: entry.clip.start + clamp(t - entry.offset, 0, entry.clip.end - entry.clip.start),
        offset: entry.offset,
    };
}

const editorService = createEditorService({
    getProject() {
        if (!editorReady)
            throw new CommandError('BUSY', '편집기를 불러오는 중입니다.');
        if (persistence.restorePhase === 'failed' && !persistence.recoveryValid)
            throw new CommandError('RECOVERY_REQUIRED', persistence.restoreMessage);
        return structuredClone(state);
    },
    commitProject: commitCommandProject,
});
const { importProjectSettings, downloadProjectSettings, importSrt, downloadSrt, downloadSubtitles } = createTextFileWorkflow({
    getProject: () => state,
    execute: (...args) => editorService.execute(...args),
    query: $,
    closeModal: () => modal.close(),
    focusImportedCaption: () => { if (panel === 'captions') focusCaption(0); },
    settingsUnavailable: () => settingsUnavailable(),
    download: (blob, name) => download(blob, name),
    toast: message => toast(message),
});

// The facade is the single integration point between app-owned state and the
// extracted playback, export, media, workspace and binding modules.
const app = {
    get state() { return state; }, set state(value) { state = value; },
    get current() { return current; }, set current(value) { current = value; },
    get selected() { return selected; }, set selected(value) { selected = value; },
    get playing() { return playing; }, set playing(value) { playing = value; },
    get panel() { return panel; }, set panel(value) { panel = value; },
    get textLayer() { return textLayer; }, set textLayer(value) { textLayer = value; },
    get history() { return history; }, set history(value) { history = value; },
    get future() { return future; }, set future(value) { future = value; },
    get exporting() { return exporting; }, set exporting(value) { exporting = value; },
    get exportCancelled() { return exportCancelled; }, set exportCancelled(value) { exportCancelled = value; },
    get muted() { return muted; }, set muted(value) { muted = value; },
    get transcribing() { return transcribing; }, set transcribing(value) { transcribing = value; },
    get transcriptionStatus() { return transcriptionStatus; }, set transcriptionStatus(value) { transcriptionStatus = value; },
    get timelineCache() { return timelineCache; }, set timelineCache(value) { timelineCache = value; },
    get frameHandle() { return frameHandle; }, set frameHandle(value) { frameHandle = value; },
    get paintHandle() { return paintHandle; }, set paintHandle(value) { paintHandle = value; },
    get lastDrawTime() { return lastDrawTime; }, set lastDrawTime(value) { lastDrawTime = value; },
    get lastTick() { return lastTick; }, set lastTick(value) { lastTick = value; },
    get playRequest() { return playRequest; }, set playRequest(value) { playRequest = value; },
    get loadingMedia() { return loadingMedia; }, set loadingMedia(value) { loadingMedia = value; },
    get sampleRaster() { return sampleRaster; }, set sampleRaster(value) { sampleRaster = value; },
    get effectTab() { return effectTab; }, set effectTab(value) { effectTab = value; },
    get selectedCard() { return selectedCard; }, set selectedCard(value) { selectedCard = value; },
    get cardPlaybackEnd() { return cardPlaybackEnd; }, set cardPlaybackEnd(value) { cardPlaybackEnd = value; },
    get editorReady() { return editorReady; }, set editorReady(value) { editorReady = value; },

    query: $, queryAll: $$, document, window, canvas, ctx, video, audio, sample, modal,
    composition, templatePreview, templateWorkspace, captionPanel, projectStore,
    sources, persistence, videoExport, transcription, captionGeneration, audioRecording,
    inspectorView, timelineView, inputHistory,
    initial, icons, clamp, visualSettings,
    duration: () => duration(), locate: t => locate(t),
    updateTime: force => updateTime(force),
    updateLayerGuide: () => updateLayerGuide(),
    renderPanel: () => renderPanel(), renderInspector: () => renderInspector(),
    renderTimeline: () => renderTimeline(), resizePreview: () => resizePreview(),
    openInspector: section => openInspector(section), setRatio: value => setRatio(value),
    edit: (change, refresh) => edit(change, refresh), snapshot: () => snapshot(),
    changed: () => changed(), scheduleSave: () => scheduleSave(),
    persistMedia: () => persistMedia(), saveProject: show => saveProject(show),
    recoveryBlocked: (show = true) => recoveryBlocked(show),
    settingsUnavailable: () => settingsUnavailable(),
    runEditorCommand: (name, args) => runEditorCommand(name, args),
    showHelp: () => showHelp(), toast: message => toast(message),
    modalOpen: (title, body, footer) => modalOpen(title, body, footer),
    confirmReset: () => confirmReset(), download: (blob, name) => download(blob, name),
    trim: (start, end) => trim(start, end), split: () => split(), duplicate: () => editingActions.duplicate(), undo: redo => undo(redo),
    generateCaptions: () => generateCaptions(), downloadSubtitles: format => downloadSubtitles(format),
    importSrt: file => importSrt(file),
    importProjectSettings: file => importProjectSettings(file),
    downloadProjectSettings: () => downloadProjectSettings(),
    exportDialog: () => exportDialog(), startExport: (type, quality) => startExport(type, quality),
    stopExport: cancelled => stopExport(cancelled),
    play: () => play(), pause: () => pause(), seekTo: t => seekTo(t),
    draw: () => draw(), requestDraw: () => requestDraw(),
    ensureAudio: () => ensureAudio(), seekVideo: time => seekVideo(time),
    loadVideo: file => loadVideo(file), loadAudio: (file, recording) => loadAudio(file, recording),
    toggleRecording: () => toggleRecording(), switchPanel: (next, options) => switchPanel(next, options),
    closePanelSheet: () => workspacePanels.closePanelSheet(),
    togglePanelSheet: () => workspacePanels.togglePanelSheet(),
    syncPanelSheet: () => workspacePanels.syncPanelSheet(),
    navigateCaption: event => navigateCaption(event), focusCaption: index => focusCaption(index),
    renderDesignPanel: target => renderDesignPanel(target),
    renderEffects: target => renderEffects(target),
    selectedSceneLayer: () => selectedSceneLayer(),
    previewDesign: change => previewDesign(change),
    revokeObjectURL: url => URL.revokeObjectURL(url),
};

const playback = createPlayback(app, {
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id),
    createAudioContext: () => new AudioContext(),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer),
    clock: () => performance.now(),
});
app.playback = playback;

const mediaLoader = createMediaLoader(app, {
    createObjectURL: file => URL.createObjectURL(file),
    revokeObjectURL: url => URL.revokeObjectURL(url),
    createAudio: () => new Audio(),
});
const designWorkspace = createDesignWorkspace(app);
const workspacePanels = createWorkspacePanels(app);
const exportFlow = createExportFlow(app, {
    isTypeSupported: mime => MediaRecorder.isTypeSupported(mime),
    hasMediaRecorder: () => typeof MediaRecorder !== 'undefined',
    body: () => document.body,
    fontsReady: () => document.fonts.ready,
});
const editingActions = createEditingActions(app);
const captionFlow = createCaptionFlow(app);

sample.onload = () => {
    sampleRaster = document.createElement('canvas');
    sampleRaster.width = 540;
    sampleRaster.height = 960;
    sampleRaster.getContext('2d').drawImage(sample, 0, 0, 540, 960);
    requestDraw();
    if (panel === 'templates')
        renderPanel();
};
sample.src = './sample.svg';

function snapshot() {
    inputHistory.reset();
    history.push(JSON.stringify(state));
    if (history.length > 40)
        history.shift();
    future = [];
}
function changed() {
    // Commands and undo can remove the selected card; keep panel and preview targets aligned.
    if (!state.overlays.some(card => card.id === selectedCard))
        selectedCard = state.overlays[0]?.id || null;
    timelineCache = null;
    renderTimeline();
    renderInspector();
    updateLayerGuide();
    requestDraw();
    scheduleSave();
}
function edit(change, refresh = false) {
    if (exporting || persistence.restorePhase === 'restoring')
        return;
    const previousDuration = duration() / state.speed;
    snapshot();
    change();
    timelineCache = null;
    retimeOutputLayers(state, previousDuration, duration() / state.speed);
    current = clamp(current, 0, duration());
    changed();
    if (refresh)
        renderPanel();
}

function commitCommandProject(next, { command } = {}) {
    if (!editorReady || exporting || loadingMedia || transcribing || audioRecording.requesting || audioRecording.current)
        throw new CommandError('BUSY', '진행 중인 로드·녹음·인식·내보내기를 먼저 완료하세요.');
    if (command === 'project.import' && (next.kind !== state.kind || (next.kind === 'video' && (next.fileName !== state.fileName || Math.abs(next.duration - state.duration) > .05)) || next.audioName !== state.audioName))
        throw new CommandError('MEDIA_RELINK_REQUIRED', '설정에 사용된 원본 영상과 오디오를 먼저 같은 이름으로 연결하세요.');
    // Non-timeline commands clone clips without changing the trim draft's target.
    const preserveTrim = ['project.update', 'effects.update', 'overlays.update', 'overlays.move', 'overlays.add', 'overlays.remove', 'title.update', 'credit.update', 'captions.replace', 'captions.update', 'captions.merge', 'captions.split', 'captions.import', 'captions.timing.shift', 'captions.text.replace', 'captions.style.update'].includes(command) && inspectorView.hasTrimTarget(state.clips[selected]);
    pause();
    snapshot();
    state = next;
    if (preserveTrim)
        inspectorView.retargetTrim(state.clips[selected]);
    timelineCache = null;
    selected = clamp(selected, 0, state.clips.length - 1);
    current = clamp(current, 0, duration());
    changed();
    renderPanel();
    resizePreview();
    seekTo(current);
}
function runEditorCommand(name, args) {
    try {
        const result = prepareCommand(state, name, args);
        if (result.project)
            commitCommandProject(result.project, { command: name });
        return true;
    }
    catch (error) {
        toast(error.message || '변경을 적용하지 못했습니다.');
        return false;
    }
}

function showHelp() {
    modalOpen('짧게 담고, 오래 기억되게.', `<ol class="guide-steps"><li>영상을 올리고 화면 비율과 구도를 맞추세요.</li><li>템플릿, 타이틀, 대사 자막을 편집하세요.</li><li>필요한 음성을 연결하고 완성된 영상을 내보내세요.</li></ol><p class="modal-copy"><span class="keyboard-key">Space</span> 재생 / 정지 &nbsp; <span class="keyboard-key">Ctrl Z</span> 실행 취소 &nbsp; <span class="keyboard-key">, / .</span> 출력 시간 1/30초 이동</p><div class="notice">편집 설정 파일에는 제목·자막·클립 구간이 담깁니다. 영상·오디오 파일은 포함하지 않습니다. 다른 브라우저에서 불러올 때는 같은 원본 파일을 먼저 연결하세요.</div>`, '<div class="modal-foot"><button class="button" id="importProjectSettingsButton">편집 설정 불러오기</button><button class="button primary" id="downloadProjectSettingsButton">편집 설정 저장</button></div>');
    $('#importProjectSettingsButton').onclick = () => $('#projectInput').click();
    $('#downloadProjectSettingsButton').onclick = downloadProjectSettings;
}
function toast(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 5000);
}
function saveStatus(text, ok = true) {
    const key = text + ok;
    if (lastSaveStatus === key)
        return;
    lastSaveStatus = key;
    $('#saveStatus').innerHTML = `<i style="background:${ok ? '#93a88d' : '#dd9c70'}"></i> ${esc(text)}`;
}
function setRatio(value) {
    runEditorCommand('project.update', { patch: { ratio: value } });
}
function openInspector(section) {
    inspectorView.open(section);
}
function renderInspector() {
    inspectorView.render(state, selected, history.length, future.length);
    playback.applyVolumes(muted);
    video.playbackRate = state.speed;
    audio.playbackRate = state.speed;
}
function renderTimeline() {
    timelineView.render(state, duration(), { selected, thumbnail: sources.thumbnail, hasAudio: !!sources.audioFile });
    updateTime();
}
function updateTime(force = true) {
    timelineView.updateTime(state, current, duration, exporting, force);
}
function visualSettings() {
    return visualPreset(state);
}

// Thin wrappers keep the public editor surface (and test harness hooks) stable
// while the implementations live in their responsibility modules.
function draw() { playback.draw(); }
function requestDraw() { playback.requestDraw(); }
function ensureAudio() { return playback.ensureAudio(); }
function seekTo(t) { playback.seekTo(t); }
function play() { return playback.play(); }
function pause() { playback.pause(); }
function tick(now) { playback.tick(now); }
function seekVideo(time) { return playback.seekVideo(time); }
function resizePreview() { playback.resizePreview(); }
function loadVideo(file) { return mediaLoader.loadVideo(file); }
function loadAudio(file, recording) { return mediaLoader.loadAudio(file, recording); }
function toggleRecording() { return mediaLoader.toggleRecording(); }
function renderPanel() { workspacePanels.renderPanel(); }
function switchPanel(next, options) { workspacePanels.switchPanel(next, options); }
function navigateCaption(event) { workspacePanels.navigateCaption(event); }
function focusCaption(index) { workspacePanels.focusCaption(index); }
function renderDesignPanel(target) { designWorkspace.renderDesignPanel(target); }
function renderEffects(target) { designWorkspace.renderEffects(target); }
function updateLayerGuide() { designWorkspace.updateLayerGuide(); }
function selectedSceneLayer() { return designWorkspace.selectedSceneLayer(); }
function previewDesign(change) { designWorkspace.previewDesign(change); }
function exportDialog() { exportFlow.exportDialog(); }
function startExport(type, quality) { return exportFlow.startExport(type, quality); }
function stopExport(cancelled) { exportFlow.stopExport(cancelled); }
function cleanupExport(request) { exportFlow.cleanupExport(request); }
function supportedTypes() { return exportFlow.supportedTypes(); }
function bind() { bindUi(app); }

function trim(start, end) { return editingActions.trim(start, end); }
function split() { return editingActions.split(); }
function undo(redo = false) { return editingActions.undo(redo); }
function modalOpen(title, body, footer = '') {
    modal.onclose?.();
    modal.onclose = null;
    modal.className = '';
    modal.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-button" id="closeModal" aria-label="닫기">${icon('close')}</button></div>${body}${footer}`;
    $('#closeModal').onclick = () => modal.close();
    modal.showModal();
}
function confirmReset() { return editingActions.confirmReset(); }
function download(blob, name) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function srtTime(t) {
    return srtTimestamp(t);
}
function outputCaptions() {
    return editedCaptions(state.captions, state.clips, state.speed);
}
function generateCaptions() { return captionFlow.generateCaptions(); }
function recoveryBlocked(show = true) { return persistence.recoveryBlocked(show); }
function settingsUnavailable() { return persistence.settingsUnavailable(); }
function scheduleSave() { persistence.scheduleSave(); }
function saveProject(show = false) { return persistence.saveProject(show); }
function persistMedia() { persistence.persistMedia(); }

async function init() {
    bind();
    editorReady = false;
    await persistence.restore();
    document.body.classList.toggle('restore-failed', persistence.restorePhase === 'failed');
    renderPanel();
    renderInspector();
    renderTimeline();
    resizePreview();
    switchPanel(panel, { openSheet: false });
    document.fonts.ready.then(() => {
        composition.clear();
        requestDraw();
        if (panel === 'templates')
            renderPanel();
    });
    editorReady = true;
    resolveEditorReady();
}
window.moment = Object.freeze({
    apiVersion: 1,
    ready: editorReadyPromise,
    execute: editorService.execute,
    describe: editorService.describe,
    capabilities: editorService.capabilities,
    downloadProject: downloadProjectSettings,
    importProject: importProjectSettings
});
init();
