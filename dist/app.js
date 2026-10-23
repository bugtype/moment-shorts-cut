import { createVideoExport } from './video-export.mjs';
import { createAudioRecording } from './audio-recording.mjs';
import { createTranscriptionClient } from './transcription-client.mjs';
import { icon, esc, fmt } from './ui-format.mjs';
import { captionsPanelMarkup, mediaPanelMarkup, audioPanelMarkup, settingsPanelMarkup } from './panel-markup.mjs';
import { createDemoProject, createProjectDocument, srtTimestamp, projectSrt, readProjectDocument, MAX_CLIPS } from './core/project.mjs';
import { prepareCommand } from './core/commands.mjs';
import { CommandError } from './core/validation.mjs';
import { createEditorService } from './integration/editor-service.mjs';
import { captionOccurrences, editedCaptions, mapAudioCaptions, parseSubtitles, MAX_SUBTITLE_BYTES, MAX_CAPTIONS } from './captions.mjs';
import { renderCaptionTrack, renderCaptionTrackError, updateTimelineMarkup } from './timeline-view.mjs';
import { createInputHistory } from './input-history.mjs';
import { defaultEnhancements, newCard, splitCaptionText, retimeOutputLayers, activeSceneLayers, sceneBounds } from './effects.mjs';
import { TEMPLATES, REFERENCE_SOURCES, applyTemplate, visualPreset, saveCustomTemplate } from './template-catalog.mjs';
import { readTemplateLibrary, validateTemplateLibrary } from './template-library.mjs';
import { mountTemplateGallery } from './template-gallery.mjs';
import { mountEffectsPanel } from './effects-panel.mjs';
import { migrateProject } from './typography.mjs';
import { createCompositionRenderer } from './composition-renderer.mjs';
import { createProjectStore } from './project-store.mjs';
import { mountDesignPanel } from './design-panel.mjs';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function icons(root = document) {
    $$('[data-icon]', root).forEach(el => {
        if (!el.querySelector('.icon'))
            el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    });
}
function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}
function initial() {
    return createDemoProject();
}
let state = initial(), current = 0, selected = 0, playing = false, panel = 'templates', textLayer = 'title', videoFile = null, audioFile = null, sourceURL = '', audioURL = '', thumbnail = '', history = [], future = [], exporting = false, muted = false, transcriptionCancelled = false, transcribing = false, transcriptionStatus = '', saveTimer, pendingSave = Promise.resolve();
const video = $('#sourceVideo'), audio = $('#sourceAudio'), canvas = $('#preview'), ctx = canvas.getContext('2d'), sample = new Image(), modal = $('#modal');
let audioCtx, videoNode, audioNode, videoGain, audioGain, destination, exportCancelled = false, lastTick = 0;
let sampleRaster = null, lastSaveStatus = '', effectTab = 'cards', selectedCard = null, templatePreviewFrame = 0, cardPlaybackEnd = null;
const galleryUI = { query: '', category: '전체' };
let savedTemplates = [], favoriteTemplates = [], templateLibraryError = '';
try {
    const library = readTemplateLibrary(localStorage.getItem('moment-templates-v1'), localStorage.getItem('moment-favorites-v1'));
    savedTemplates = library.templates;
    favoriteTemplates = library.favorites;
}
catch {
    templateLibraryError = '저장된 템플릿·즐겨찾기를 읽을 수 없습니다. 원본 저장값은 유지되며 이번 세션의 템플릿 저장·삭제·즐겨찾기 변경은 차단됩니다. 기본 템플릿과 프로젝트 편집은 사용할 수 있습니다. 새로고침은 읽기를 다시 시도합니다.';
}
const composition = createCompositionRenderer(() => document.createElement('canvas'));
const projectStore = createProjectStore();
const videoExport = createVideoExport({
    createCanvas: () => document.createElement('canvas'),
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
    onRelease: () => {
        exporting = false;
        document.body.classList.remove('exporting');
    },
});
const transcription = createTranscriptionClient(() => new Worker('./transcribe-worker.js', { type: 'module' }));
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
// Session-only protection: never overwrite a project whose restore is incomplete.
let restorePhase = 'restoring', restoreMessage = '프로젝트를 불러오는 중…', recoveryValid = false, recoveryBaseline = '';
function recoveryBlocked(show = true) {
    if (restorePhase === 'ready')
        return false;
    saveStatus(restoreMessage, false);
    if (show)
        toast(restoreMessage);
    return true;
}
function settingsUnavailable() {
    if (restorePhase === 'ready' || (restorePhase === 'failed' && recoveryValid))
        return false;
    recoveryBlocked();
    return true;
}
let inspectorTrimContext = null;
let timelineCache = null, frameHandle = 0, paintHandle = 0, lastUiTime = 0, lastTimeLabel = '', lastDrawTime = -Infinity, playRequest = 0, loadingMedia = false;
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
        const middle = (low + high) >> 1, e = entries[middle];
        if (t < e.offset + e.clip.end - e.clip.start)
            high = middle;
        else
            low = middle + 1;
    }
    const e = entries[low];
    return {
        index: e.index,
        source: e.clip.start + clamp(t - e.offset, 0, e.clip.end - e.clip.start),
        offset: e.offset };
}
const inputHistory = createInputHistory(snapshot, () => exporting || restorePhase === 'restoring');
function snapshot() {
    inputHistory.reset();
    history.push(JSON.stringify(state));
    if (history.length > 40)
        history.shift();
    future = [];
}
function changed() {
    timelineCache = null;
    renderTimeline();
    renderInspector();
    updateLayerGuide();
    requestDraw();
    scheduleSave();
}
function edit(fn, refresh = false) {
    if (exporting || restorePhase === 'restoring')
        return;
    const previousDuration = duration() / state.speed;
    snapshot();
    fn();
    timelineCache = null;
    retimeOutputLayers(state, previousDuration, duration() / state.speed);
    current = clamp(current, 0, duration());
    changed();
    if (refresh)
        renderPanel();
}
let editorReady = false, resolveEditorReady;
const editorReadyPromise = new Promise(resolve => {
    resolveEditorReady = resolve;
});
function commitCommandProject(next, { command } = {}) {
    if (!editorReady || exporting || loadingMedia || transcribing || audioRecording.requesting || audioRecording.current)
        throw new CommandError('BUSY', '진행 중인 로드·녹음·인식·내보내기를 먼저 완료하세요.');
    if (command === 'project.import' && (next.kind !== state.kind || (next.kind === 'video' && (next.fileName !== state.fileName || Math.abs(next.duration - state.duration) > .05)) || next.audioName !== state.audioName))
        throw new CommandError('MEDIA_RELINK_REQUIRED', '설정에 사용된 원본 영상과 오디오를 먼저 같은 이름으로 연결하세요.');
    // Non-timeline commands clone clips without changing the trim draft's target.
    const preserveTrim = ['project.update', 'title.update', 'captions.replace'].includes(command) && inspectorTrimContext?.clip === state.clips[selected];
    pause();
    snapshot();
    state = next;
    if (preserveTrim)
        inspectorTrimContext.clip = state.clips[selected];
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
const editorService = createEditorService({
    getProject() {
        if (!editorReady)
            throw new CommandError('BUSY', '편집기를 불러오는 중입니다.');
        if (restorePhase === 'failed' && !recoveryValid)
            throw new CommandError('RECOVERY_REQUIRED', restoreMessage);
        return structuredClone(state);
    },
    commitProject: commitCommandProject,
});
async function readUtf8File(file) {
    const bytes = await file.arrayBuffer();
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch {
        throw new Error('파일을 올바른 UTF-8로 저장한 뒤 다시 불러오세요.');
    }
}
let textImportRequest = 0;
function guardTextImport() {
    const request = ++textImportRequest, original = state, contents = JSON.stringify(state);
    return () => {
        if (request !== textImportRequest || state !== original || JSON.stringify(state) !== contents)
            throw new CommandError('CONFLICT', '프로젝트가 변경되었거나 다른 가져오기를 선택했습니다. 파일을 다시 선택하세요.');
    };
}
async function importProjectSettings(file) {
    try {
        const beforeCommit = guardTextImport();
        if (file.size > 10 * 1024 * 1024)
            throw new Error('편집 설정 JSON은 10 MB 이하만 불러올 수 있습니다.');
        const result = await editorService.execute('project.import', { document: JSON.parse(await readUtf8File(file)) }, beforeCommit);
        if (!result.ok)
            throw new Error(result.error.message);
        modal.close();
        toast('편집 설정을 적용했습니다. 실행 취소할 수 있습니다.');
        return result;
    }
    catch (error) {
        toast(error.message || '설정 파일을 확인하세요.');
        return { ok: false, error: { code: 'IMPORT_FAILED', message: error.message } };
    }
    finally {
        $('#projectInput').value = '';
    }
}
function downloadProjectSettings() {
    if (settingsUnavailable())
        return;
    download(new Blob([JSON.stringify(createProjectDocument(state), null, 2)], { type: 'application/json' }), `${state.name || 'moment'}.moment.json`);
}
function showHelp() {
    modalOpen('짧게 담고, 오래 기억되게.', `<ol class="guide-steps"><li>영상을 올리고 화면 비율과 구도를 맞추세요.</li><li>템플릿, 타이틀, 대사 자막을 편집하세요.</li><li>필요한 음성을 연결하고 완성된 영상을 내보내세요.</li></ol><p class="modal-copy"><span class="keyboard-key">Space</span> 재생 / 정지 &nbsp; <span class="keyboard-key">Ctrl Z</span> 실행 취소</p><div class="notice">편집 설정 파일에는 제목·자막·클립 구간이 담깁니다. 영상·오디오 파일은 포함하지 않습니다. 다른 브라우저에서 불러올 때는 같은 원본 파일을 먼저 연결하세요.</div>`, '<div class="modal-foot"><button class="button" id="importProjectSettingsButton">편집 설정 불러오기</button><button class="button primary" id="downloadProjectSettingsButton">편집 설정 저장</button></div>');
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
const dbGet = key => projectStore.get(key);
function scheduleSave() {
    clearTimeout(saveTimer);
    if (recoveryBlocked(false))
        return;
    saveStatus('저장 중…');
    saveTimer = setTimeout(() => saveProject(), 500);
}
async function saveProject(show = false) {
    clearTimeout(saveTimer);
    if (recoveryBlocked(show))
        return;
    try {
        if (show && (videoFile || audioFile))
            persistMedia();
        let saving;
        do {
            saving = pendingSave;
            await saving;
            if (recoveryBlocked(show))
                return;
        } while (saving !== pendingSave);
        localStorage.setItem('moment-state-v1', JSON.stringify(state));
        saveStatus('이 브라우저에 저장됨');
        if (show)
            toast('프로젝트를 이 브라우저에 저장했습니다.');
    }
    catch (e) {
        if (recoveryBlocked(show))
            return;
        saveStatus('저장 공간을 확인하세요', false);
        if (show)
            toast('저장 공간이 부족하거나 브라우저 저장이 차단되었습니다.');
    }
}
function persistMedia() {
    if (recoveryBlocked(false))
        return;
    pendingSave = projectStore.setMedia(videoFile, audioFile);
    pendingSave.catch(() => {
        if (!recoveryBlocked(false))
            saveStatus('미디어 저장 실패', false);
    });
}
function setRatio(value) {
    runEditorCommand('project.update', { patch: { ratio: value } });
}
function resizePreview() {
    const [w, h] = state.ratio.split(':').map(Number);
    canvas.width = w / h >= 1 ? 960 : 540;
    canvas.height = Math.round(canvas.width * h / w);
    const wrap = $('#canvasWrap'), stage = $('#stage');
    wrap.style.aspectRatio = `${w}/${h}`;
    const maxH = stage.clientHeight - 53, maxW = stage.clientWidth - 50;
    wrap.style.height = `${Math.max(100, Math.min(maxH, maxW * h / w, 570))}px`;
    wrap.style.width = 'auto';
    draw();
}
function openInspector(section) {
    for (const name of ['frame', 'clip', 'caption'])
        $('#' + name + 'Settings').open = name === section;
}
function renderInspector() {
    for (const [id, key] of [['mobileZoom', 'zoom'], ['panelVolume', 'volume']]) {
        const control = $('#' + id), value = String(state[key]);
        if (control && control.value !== value)
            control.value = value;
    }
    const c = state.clips[selected] || state.clips[0];
    if (inspectorTrimContext?.clip !== c || inspectorTrimContext.index !== selected || inspectorTrimContext.start !== c.start || inspectorTrimContext.end !== c.end) {
        $('#trimStart').value = c.start.toFixed(1);
        $('#trimEnd').value = c.end.toFixed(1);
        inspectorTrimContext = { clip: c, index: selected, start: c.start, end: c.end };
    }
    $('#projectName').value = state.name;
    $('#ratioLabel').textContent = state.ratio;
    $('#previewSize').textContent = state.ratio === '9:16' ? '1080 × 1920' : state.ratio === '1:1' ? '1080 × 1080' : '1920 × 1080';
    $$('[data-ratio]').forEach(b => b.classList.toggle('active', b.dataset.ratio === state.ratio));
    $$('[data-fit]').forEach(b => b.classList.toggle('active', b.dataset.fit === state.fit));
    $$('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === state.style));
    $('#zoom').value = state.zoom;
    $('#zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
    $('#volume').value = state.volume;
    $('#volumeValue').textContent = `${Math.round(state.volume * 100)}%`;
    $('#speed').value = state.speed;
    $('#clipIndex').textContent = `클립 ${selected + 1}`;
    $('#undoButton').disabled = !history.length;
    $('#redoButton').disabled = !future.length;
    $('#deleteButton').disabled = state.clips.length <= 1;
    $('#moveLeft').disabled = selected <= 0;
    $('#moveRight').disabled = selected >= state.clips.length - 1;
    $('#sampleBadge').hidden = state.kind !== 'demo';
    if (videoGain) {
        videoGain.gain.value = muted ? 0 : state.volume;
        audioGain.gain.value = muted ? 0 : state.audioVolume;
    }
    video.playbackRate = state.speed;
    audio.playbackRate = state.speed;
}
function renderTimelineCaptions(len) {
    try {
        renderCaptionTrack($('#captionTrack'), captionOccurrences(state.captions, state.clips), len, state.speed);
    }
    catch (error) {
        if (error.code !== 'CAPTION_OUTPUT_LIMIT')
            throw error;
        renderCaptionTrackError($('#captionTrack'), error.message);
    }
}
function renderTimeline() {
    renderLayerTrack();
    const len = duration();
    $('#seek').max = len;
    updateTimelineMarkup($('#videoTrack'), state.clips.map((c, i) => `<button class="clip ${i === selected ? 'active' : ''}" data-clip="${i}" style="flex:${c.end - c.start};${thumbnail ? `background-image:url('${thumbnail}');background-size:auto 100%;` : ''}" title="클립 ${i + 1}: ${fmt(c.start)}–${fmt(c.end)}"><span>${i === 0 ? esc(state.fileName) : '클립 ' + (i + 1)}</span></button>`).join(''));
    renderTimelineCaptions(len);
    $('#ruler').innerHTML = Array.from({ length: 6 }, (_, i) => `<span>${fmt(len * i / 5 / state.speed)}</span>`).join('');
    $('#audioTrack').classList.toggle('has-audio', !!audioFile);
    $('#audioTrack').textContent = audioFile ? `♫ ${state.audioName} · ${(state.audioOffset / state.speed).toFixed(1)}초부터` : '+ 오디오를 추가해 보세요';
    updateTime();
}
function updateTime(force = true) {
    const now = performance.now();
    if (!force && now - lastUiTime < 100)
        return;
    lastUiTime = now;
    const len = duration(), label = `${fmt(current / state.speed)} <span>/ ${fmt(len / state.speed)}</span>`;
    if (label !== lastTimeLabel) {
        $('#timeDisplay').innerHTML = label;
        lastTimeLabel = label;
    }
    $('#seek').value = current;
    $('#playhead').style.transform = `translateX(${len ? current / len * $('#tracksArea').clientWidth : 0}px)`;
    if (exporting) {
        const progress = Math.round(current / len * 100), bar = $('#exportProgress'), label = $('#exportPercent');
        if (bar)
            bar.style.width = progress + '%';
        if (label)
            label.textContent = progress + '%';
    }
}
function renderLayerTrack() {
    const total = duration() / state.speed, d = state.design;
    let html = [['title', d.title, '타이틀'], ['credit', d.credit, '크레딧']].filter(([, l]) => l.enabled).map(([key, l, label]) => {
        const start = clamp(l.start, 0, total), end = clamp(l.end ?? total, start, total);
        return `<button class="title-track-block ${key}" data-track-layer="${key}" style="left:${start / total * 100}%;width:${(end - start) / total * 100}%">${label} · ${esc(key === 'title' ? l.lines.filter(Boolean).join(' / ') : l.text)}</button>`;
    }).join('');
    html += (state.overlays || []).filter(card => card.start < total).map(card => `<button class="title-track-block scene" data-track-card="${esc(card.id)}" style="left:${clamp(card.start / total * 100, 0, 100)}%;width:${clamp((Math.min(total, card.end) - card.start) / total * 100, 0, 100)}%">${esc(card.label)} · ${esc(card.text)}</button>`).join('');
    updateTimelineMarkup($('#titleTrack'), html || '<span class="empty-layer-track">+ 타이틀 · 장면 카드를 추가하세요</span>');
}
function selectedSceneLayer() {
    const active = activeSceneLayers(state, current / state.speed);
    if (panel === 'effects' && effectTab === 'cards')
        return active.find(card => card.id === (selectedCard || state.overlays[0]?.id));
    if (panel === 'text' && textLayer === 'title')
        return active.find(card => (card.role || 'headline') === 'headline');
    return null;
}
function updateLayerGuide() {
    const guide = $('#layerSelection');
    if (!guide)
        return;
    const scene = selectedSceneLayer(), isText = panel === 'text' && textLayer !== 'frame';
    const l = textLayer === 'caption' ? { x: state.captionX, y: state.captionY, enabled: true } : state.design[textLayer];
    guide.hidden = !scene && (!isText || !l?.enabled);
    if (scene) {
        const box = sceneBounds(scene, canvas.width, canvas.height);
        guide.style.left = `${box.x / canvas.width * 100}%`;
        guide.style.top = `${box.y / canvas.height * 100}%`;
        guide.style.width = `${box.width / canvas.width * 100}%`;
        guide.style.height = `${box.height / canvas.height * 100}%`;
        guide.dataset.label = '구간별 타이틀';
    }
    else if (!guide.hidden) {
        guide.style.width = '84%';
        guide.style.left = `${l.x * 100}%`;
        guide.style.top = `${l.y * 100}%`;
        guide.dataset.label = { title: '타이틀', caption: '대사', credit: '크레딧' }[textLayer];
        guide.style.height = textLayer === 'title' ? '16%' : textLayer === 'credit' ? '7%' : '12%';
    }
    $('#moveHint').textContent = scene || isText ? '선택한 글자를 드래그해 이동' : '영상을 드래그해 구도 조절';
}
function previewDesign(change) {
    change(state);
    renderLayerTrack();
    updateLayerGuide();
    requestDraw();
    scheduleSave();
    $('#undoButton').disabled = !history.length;
    $('#redoButton').disabled = !future.length;
}
function renderDesignPanel(target) {
    mountDesignPanel(target, {
        state,
        layer: textLayer,
        time: current / state.speed,
        total: duration() / state.speed,
        snapshot,
        input: inputHistory.bind,
        update: previewDesign,
        navigate: switchPanel,
        timedTitle(id) {
            selectedCard = id;
            effectTab = 'cards';
            switchPanel('effects');
        },
        select(layer) {
            textLayer = layer;
            renderPanel();
            updateLayerGuide();
        },
        preset(preset) {
            if (!runEditorCommand('template.apply', { templateId: preset }))
                return;
            toast('타이틀·대사·여백 구성을 적용했습니다. 문구는 그대로 유지합니다.');
        },
        captionStyle(style) {
            edit(() => {
                state.style = style;
                state.captionItalic = style !== 'minimal';
                state.captionStroke = style === 'minimal' ? 2 : 3;
            }, true);
        }
    });
}
function templateLibraryBlocked() {
    if (!templateLibraryError)
        return false;
    toast(templateLibraryError);
    return true;
}
function persistTemplateLibrary() {
    if (templateLibraryBlocked())
        return false;
    try {
        validateTemplateLibrary(savedTemplates, favoriteTemplates);
        localStorage.setItem('moment-templates-v1', JSON.stringify(savedTemplates));
        localStorage.setItem('moment-favorites-v1', JSON.stringify(favoriteTemplates));
        return true;
    }
    catch {
        toast('템플릿·즐겨찾기를 저장하지 못했습니다. 설정과 브라우저 저장 공간을 확인하세요.');
        return false;
    }
}
const templateDemos = new WeakMap();
function templateProject(template) {
    if (templateDemos.has(template))
        return templateDemos.get(template);
    const p = initial();
    applyTemplate(p, template, true);
    p.globalKeywords = p.globalKeywords || '순간, 속도';
    if (template.id === 'interview')
        p.captions.forEach((cap, i) => cap.speaker = String(i % 2));
    templateDemos.set(template, p);
    return p;
}
function renderTemplateCanvas(target, template, fraction = .4) {
    const p = templateProject(template), t = clamp(fraction, 0, .999) * 12;
    composition.draw(target.getContext('2d'), target.width, target.height, p, {
        source: sampleRaster || sample,
        sw: 540,
        sh: 960,
        ready: sample.complete,
        sourceTime: t,
        time: t,
        total: 12,
        elapsed: t,
        remaining: 12 - t,
        progress: t / 12
    });
}
function renderGallery(target) {
    mountTemplateGallery(target, {
        ui: galleryUI,
        active: state.templateId,
        custom: savedTemplates,
        favorites: favoriteTemplates,
        error: templateLibraryError,
        thumbnail: renderTemplateCanvas,
        preview: openTemplatePreview,
        save: saveTemplateDialog,
        favorite(id) {
            if (templateLibraryBlocked())
                return;
            const previous = [...favoriteTemplates], i = favoriteTemplates.indexOf(id);
            if (i < 0)
                favoriteTemplates.push(id);
            else
                favoriteTemplates.splice(i, 1);
            if (!persistTemplateLibrary())
                favoriteTemplates.splice(0, favoriteTemplates.length, ...previous);
        },
        remove(id) {
            if (templateLibraryBlocked())
                return;
            modalOpen('내 템플릿을 삭제할까요?', '<p class="modal-copy">현재 편집 중인 영상은 그대로 유지됩니다.</p>', '<div class="modal-foot"><button class="button" id="cancelRemoveTemplate">취소</button><button class="button primary" id="confirmRemoveTemplate">템플릿 삭제</button></div>');
            $('#cancelRemoveTemplate').onclick = () => modal.close();
            $('#confirmRemoveTemplate').onclick = () => {
                const previous = savedTemplates;
                savedTemplates = savedTemplates.filter(t => t.id !== id);
                if (!persistTemplateLibrary()) {
                    savedTemplates = previous;
                    return;
                }
                modal.close();
                renderPanel();
            };
        }
    });
}
function saveTemplateDialog() {
    if (templateLibraryBlocked())
        return;
    if (savedTemplates.length >= 20) {
        toast('내 템플릿은 20개까지 저장할 수 있습니다.');
        return;
    }
    modalOpen('나만의 구성으로 저장', `<p class="modal-copy">타이틀 스타일·자막 스타일·효과·구간별 문구를 저장합니다. 영상과 오디오는 포함하지 않습니다.</p><label class="panel-label" for="customTemplateName">템플릿 이름</label><input class="panel-input" id="customTemplateName" maxlength="40" value="${esc(state.name)} 스타일">`, '<div class="modal-foot"><button class="button primary" id="saveCustomTemplate">이 브라우저에 저장</button></div>');
    $('#saveCustomTemplate').onclick = () => {
        const name = $('#customTemplateName').value.trim();
        if (!name) {
            $('#customTemplateName').focus();
            return;
        }
        const item = saveCustomTemplate(name, state);
        savedTemplates.push(item);
        if (!persistTemplateLibrary()) {
            savedTemplates.pop();
            return;
        }
        modal.close();
        galleryUI.category = '내 템플릿';
        switchPanel('templates');
        toast('내 템플릿을 저장했습니다.');
    };
}
function openTemplatePreview(template) {
    pause();
    const reference = REFERENCE_SOURCES[template.source];
    modalOpen(esc(template.name), `<div class="template-preview-layout"><div class="template-demo-stage"><canvas id="templateDemo" width="432" height="768"></canvas><button class="button" id="toggleTemplateDemo">▶ 예시 재생</button><small>샘플 그래픽 · 12초 미리보기</small></div><div class="template-details"><span class="template-category">${esc(template.category)}</span><p class="modal-copy">${esc(template.description)}</p><div class="template-flow">${template.flow.map((line, i) => `<div><b>${i + 1}</b><span>${esc(line)}</span></div>`).join('')}</div><div class="notice"><strong>스타일만 적용</strong><br>기존 타이틀 문구·자막·카드를 유지합니다.<br><br><strong>예시 구성까지 적용</strong><br>예시 타이틀·크레딧·구간별 문구로 교체합니다. 대사 자막과 영상은 유지됩니다. 실행 취소할 수 있습니다.</div>${reference ? `<a class="reference-link" href="${reference.url}" target="_blank" rel="noopener noreferrer">참고한 공식 자료 ↗</a>` : ''}</div></div>`, '<div class="modal-foot"><button class="button" id="applyTemplateStructure">예시 구성까지 적용</button><button class="button primary" id="applyTemplateStyle">스타일만 적용</button></div>');
    modal.classList.add('template-modal');
    renderTemplateCanvas($('#templateDemo'), template, .4);
    let started = 0, running = false, lastPreview = -Infinity;
    const stop = () => {
        running = false;
        if (templatePreviewFrame)
            cancelAnimationFrame(templatePreviewFrame);
        templatePreviewFrame = 0;
    };
    const animate = now => {
        if (!modal.open || !running) {
            stop();
            return;
        }
        if (now - lastPreview >= 1000 / 30) {
            renderTemplateCanvas($('#templateDemo'), template, ((now - started) % 12000) / 12000);
            lastPreview = now;
        }
        templatePreviewFrame = requestAnimationFrame(animate);
    };
    $('#toggleTemplateDemo').onclick = () => {
        if (running) {
            stop();
            $('#toggleTemplateDemo').textContent = '▶ 예시 재생';
        }
        else {
            running = true;
            started = performance.now();
            $('#toggleTemplateDemo').textContent = 'Ⅱ 일시정지';
            templatePreviewFrame = requestAnimationFrame(animate);
        }
    };
    modal.onclose = stop;
    const apply = withContent => {
        stop();
        if (template.custom)
            edit(() => applyTemplate(state, template, withContent));
        else if (!runEditorCommand('template.apply', { templateId: template.id, withContent }))
            return;
        modal.close();
        selectedCard = state.overlays[0]?.id;
        renderPanel();
        seekTo(0);
        toast(withContent ? '예시 타이틀과 구간별 문구를 적용했습니다. 문구를 내 영상에 맞게 수정하세요.' : '스타일을 적용했습니다. 기존 문구와 자막은 유지했습니다.');
    };
    $('#applyTemplateStyle').onclick = () => apply(false);
    $('#applyTemplateStructure').onclick = () => apply(true);
}
function renderEffects(target) {
    mountEffectsPanel(target, {
        state,
        total: duration() / state.speed,
        tab: effectTab,
        selected: selectedCard,
        snapshot,
        input: inputHistory.bind,
        update: previewDesign,
        changeTab(tab) {
            effectTab = tab;
            renderPanel();
        },
        toggleAll() {
            const visible = state.overlays.some(c => c.enabled !== false);
            edit(() => state.overlays.forEach(c => c.enabled = !visible), true);
        },
        reset() {
            edit(() => state.effects = defaultEnhancements().effects, true);
        },
        add() {
            if (state.overlays.length >= 12)
                return;
            edit(() => {
                const card = newCard(duration() / state.speed, current / state.speed);
                selectedCard = card.id;
                state.overlays.push(card);
            }, true);
        },
        select(id) {
            selectedCard = id;
            const card = state.overlays.find(c => c.id === id);
            pause();
            if (card)
                seekTo(Math.min(card.end - .001, card.start + .2) * state.speed);
            renderPanel();
        },
        remove(id) {
            edit(() => {
                state.overlays = state.overlays.filter(c => c.id !== id);
                selectedCard = state.overlays[0]?.id;
            }, true);
        },
        duplicate(id) {
            if (state.overlays.length >= 12) {
                toast('카드는 12개까지 추가할 수 있습니다.');
                return;
            }
            edit(() => {
                const card = structuredClone(state.overlays.find(c => c.id === id));
                card.id = newCard(duration() / state.speed).id;
                selectedCard = card.id;
                state.overlays.push(card);
            }, true);
        },
        play(start) {
            const card = state.overlays.find(c => c.id === selectedCard) || state.overlays[0];
            pause();
            seekTo(start * state.speed);
            cardPlaybackEnd = card?.end ?? null;
            play();
        }
    });
}
function splitLongCaptions() {
    const limit = Number($('#captionChunkSize').value), captions = [];
    try {
        for (const caption of state.captions) {
            const parts = splitCaptionText(caption, limit);
            if (captions.length + parts.length > MAX_CAPTIONS) {
                toast('자막은 10,000개 이하만 지원합니다.');
                return;
            }
            captions.push(...parts);
        }
    }
    catch (error) {
        toast(error.message);
        return;
    }
    if (captions.length === state.captions.length && captions.every((caption, i) => caption === state.captions[i] || JSON.stringify(caption) === JSON.stringify(state.captions[i]))) {
        toast('나눌 긴 자막이 없습니다.');
        return;
    }
    edit(() => state.captions = captions, true);
    $('#splitLongCaptions').focus();
    toast('긴 자막을 나눴습니다. 시간은 글자 수 기준으로 배분했으니 음성과 확인해 주세요.');
}
function renderCaptionsPanel(target) {
    const toolsOpen = target.querySelector('#captionTools')?.open;
    target.innerHTML = captionsPanelMarkup(state, { toolsOpen, transcribing, hasAudio: !!audioFile, transcriptionStatus });
    $('#captionDesignShortcut').onclick = () => {
        textLayer = 'caption';
        switchPanel('text');
    };
    $('#splitLongCaptions').onclick = splitLongCaptions;
    $$('[data-caption-keywords]').forEach(el => el.onchange = () => edit(() => state.captions[+el.dataset.captionKeywords].keywords = el.value));
    $$('[data-caption-speaker]').forEach(el => el.onchange = () => edit(() => state.captions[+el.dataset.captionSpeaker].speaker = el.value));
    $('#generateCaptions').onclick = generateCaptions;
    $('#addCaption').onclick = () => {
        if (state.captions.length >= MAX_CAPTIONS) {
            toast('자막은 10,000개 이하만 지원합니다.');
            return;
        }
        edit(() => {
            const t = Math.min(locate(current).source, Math.max(0, state.duration - .1));
            state.captions.push({ start: t, end: Math.min(state.duration, t + 3), text: '새로운 자막을 입력하세요' });
        }, true);
        focusCaption(state.captions.length - 1);
    };
    $('#importSrt').onclick = () => $('#srtInput').click();
    $('#downloadSrt').onclick = downloadSrt;
    $$('[data-delete-caption]').forEach(b => b.onclick = () => {
        const index = +b.dataset.deleteCaption;
        edit(() => state.captions.splice(index, 1), true);
        focusCaption(Math.min(index, state.captions.length - 1));
    });
    $$('[data-caption-text]').forEach(el => el.onchange = () => edit(() => state.captions[+el.dataset.captionText].text = el.value));
    for (const side of ['start', 'end'])
        $$(`[data-caption-${side}]`).forEach(el => el.onchange = () => {
            const i = +el.dataset[side === 'start' ? 'captionStart' : 'captionEnd'], c = state.captions[i], value = +el.value;
            if (!Number.isFinite(value) || value < 0 || value > (c.basis === 'timeline' ? duration() : state.duration) || (side === 'start' ? value >= c.end : value <= c.start)) {
                toast('시작은 끝보다 작고, 영상 길이 안에 있어야 합니다.');
                renderPanel();
                return;
            }
            edit(() => c[side] = value);
        });
}
function navigateCaption(event) {
    if (exporting)
        return;
    switchPanel('captions');
    if (panel !== 'captions')
        return;
    const block = event?.target.closest('[data-caption-index]');
    if (!block)
        return;
    pause();
    seekTo(+block.dataset.captionTime);
    focusCaption(+block.dataset.captionIndex);
}
function focusCaption(index) {
    const field = (index < 0 ? null : $('[data-caption-text="' + index + '"]')) || $('#addCaption');
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}
function renderPanel() {
    const target = $('#panelContent');
    if (panel === 'templates') {
        renderGallery(target);
    }
    else if (panel === 'effects') {
        renderEffects(target);
    }
    else if (panel === 'media') {
        target.innerHTML = mediaPanelMarkup(state, thumbnail);
        $('#chooseVideo').onclick = () => $('#videoInput').click();
        $('#assetSelect').onclick = () => {
            seekTo(0);
            toast('프로젝트의 첫 장면으로 이동했습니다.');
        };
        $('#loadDemo').onclick = () => confirmReset(true);
        const drop = $('#dropzone');
        ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => {
            ev.preventDefault();
            drop.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => {
            ev.preventDefault();
            drop.classList.remove('dragover');
            if (e === 'drop' && ev.dataTransfer.files[0])
                loadVideo(ev.dataTransfer.files[0]);
        }));
    }
    else if (panel === 'captions') {
        renderCaptionsPanel(target);
    }
    else if (panel === 'audio') {
        target.innerHTML = audioPanelMarkup(state, !!audioFile, audioFile ? duration() : 0);
        $('#chooseAudio').onclick = () => $('#audioInput').click();
        $('#recordButton').onclick = toggleRecording;
        if (audioFile) {
            $('#removeAudio').onclick = () => {
                if (recoveryBlocked() || audioRecording.current || audioRecording.requesting || loadingMedia)
                    return;
                pause();
                audioFile = null;
                state.audioName = '';
                audio.removeAttribute('src');
                if (audioURL)
                    URL.revokeObjectURL(audioURL);
                persistMedia();
                changed();
                renderPanel();
            };
            $('#audioOffset').onchange = e => edit(() => {
                const next = clamp((+e.target.value || 0) * state.speed, 0, duration()), delta = next - state.audioOffset;
                state.audioOffset = next;
                state.captions = state.captions.map(cap => cap.basis === 'timeline' ? { ...cap, start: Math.max(0, cap.start + delta), end: Math.max(.001, cap.end + delta) } : cap);
            }, true);
            inputHistory.bind($('#audioVolume'), () => state.audioVolume, value => {
                state.audioVolume = value;
                $('#audioVolumeOutput').textContent = Math.round(state.audioVolume * 100) + '%';
                renderInspector();
                scheduleSave();
            });
        }
    }
    else if (panel === 'text') {
        renderDesignPanel(target);
    }
    else {
        target.innerHTML = settingsPanelMarkup(state, state.clips[selected]);
        for (const [id, key] of [['mobileZoom', 'zoom'], ['captionSize', 'captionSize'], ['captionY', 'captionY'], ['panelVolume', 'volume']]) {
            const el = $('#' + id);
            inputHistory.bind(el, () => state[key], value => {
                state[key] = value;
                renderInspector();
                draw();
                scheduleSave();
            });
        }
        $('#resetPosition').onclick = () => edit(() => {
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
        }, true);
        $('#panelTrimApply').onclick = () => trim($('#panelTrimStart').valueAsNumber, $('#panelTrimEnd').valueAsNumber);
    }
    icons(target);
    updateLayerGuide();
}
function switchPanel(next) {
    if (audioRecording.current && next !== 'audio') {
        toast('녹음을 먼저 완료해 주세요.');
        return;
    }
    panel = next;
    if (next === 'settings')
        openInspector('frame');
    else if (next === 'captions' || (next === 'text' && textLayer === 'caption'))
        openInspector('caption');
    $$('[data-panel]').forEach(b => {
        b.classList.toggle('active', b.dataset.panel === panel);
        b.setAttribute('aria-pressed', b.dataset.panel === panel);
    });
    renderPanel();
}
function paint(c, w, h) {
    const pos = locate(current), clip = state.clips[pos.index];
    composition.draw(c, w, h, state, {
        source: state.kind === 'demo' ? (sampleRaster || sample) : video,
        sw: state.kind === 'demo' ? 540 : video.videoWidth,
        sh: state.kind === 'demo' ? 960 : video.videoHeight,
        ready: state.kind === 'demo' ? sample.complete : restorePhase === 'ready' && video.readyState >= 2,
        sourceTime: pos.source,
        time: current / state.speed,
        total: duration() / state.speed,
        elapsed: (pos.source - clip.start) / state.speed,
        remaining: (clip.end - pos.source) / state.speed,
        progress: (pos.source - clip.start) / (clip.end - clip.start)
    });
}
function draw() {
    if (exporting && videoExport.context) {
        paint(videoExport.context, videoExport.canvas.width, videoExport.canvas.height);
        ctx.drawImage(videoExport.canvas, 0, 0, canvas.width, canvas.height);
    }
    else
        paint(ctx, canvas.width, canvas.height);
}
function requestDraw() {
    if (playing || paintHandle)
        return;
    paintHandle = requestAnimationFrame(() => {
        paintHandle = 0;
        draw();
    });
}
async function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new AudioContext();
        destination = audioCtx.createMediaStreamDestination();
        videoNode = audioCtx.createMediaElementSource(video);
        audioNode = audioCtx.createMediaElementSource(audio);
        videoGain = audioCtx.createGain();
        audioGain = audioCtx.createGain();
        videoNode.connect(videoGain);
        audioNode.connect(audioGain);
        videoGain.connect(audioCtx.destination);
        audioGain.connect(audioCtx.destination);
        videoGain.connect(destination);
        audioGain.connect(destination);
    }
    await audioCtx.resume();
    renderInspector();
}
function syncAudio(force = false) {
    if (restorePhase !== 'ready' || !audioFile)
        return;
    const t = current - state.audioOffset;
    if (t >= 0 && t < audio.duration) {
        if (force || Math.abs(audio.currentTime - t) > .25)
            audio.currentTime = t;
        if (playing && audio.paused)
            audio.play().catch(() => {
            });
    }
    else
        audio.pause();
}
function seekTo(t) {
    current = clamp(t, 0, duration());
    const pos = locate(current);
    if (restorePhase === 'ready' && state.kind === 'video' && Number.isFinite(video.duration))
        video.currentTime = Math.min(video.duration - .001, pos.source);
    syncAudio(true);
    updateTime();
    updateLayerGuide();
    draw();
    if (panel === 'text')
        renderPanel();
}
async function play() {
    if (recoveryBlocked() || playing)
        return;
    const request = ++playRequest;
    if (current >= duration() - .03)
        seekTo(0);
    try {
        await ensureAudio();
        if (request !== playRequest || recoveryBlocked())
            return;
        if (state.kind === 'video') {
            const pos = locate(current);
            if (Math.abs(video.currentTime - pos.source) > .08)
                await seekVideo(pos.source);
            if (request !== playRequest)
                return;
            video.playbackRate = state.speed;
            await video.play();
        }
        if (request !== playRequest)
            return;
        playing = true;
        lastTick = performance.now();
        lastDrawTime = -Infinity;
        syncAudio(true);
        $('#playButton').innerHTML = icon('pause');
        $('#playButton').setAttribute('aria-label', '일시정지');
        if (frameHandle)
            cancelAnimationFrame(frameHandle);
        frameHandle = requestAnimationFrame(tick);
    }
    catch (e) {
        if (request !== playRequest)
            return;
        if (exporting)
            stopExport(true);
        toast('재생할 수 없습니다. 영상 형식과 오디오 장치를 확인하세요.');
    }
}
function pause() {
    ++playRequest;
    playing = false;
    cardPlaybackEnd = null;
    if (frameHandle)
        cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    video.pause();
    audio.pause();
    $('#playButton').innerHTML = icon('play');
    $('#playButton').setAttribute('aria-label', '재생');
}
function tick(now) {
    frameHandle = 0;
    if (!playing)
        return;
    const old = locate(current);
    if (state.kind === 'video') {
        if (!video.seeking) {
            const clip = state.clips[old.index];
            current = clamp(old.offset + video.currentTime - clip.start, old.offset, old.offset + clip.end - clip.start);
            if (video.currentTime >= clip.end - .015 || video.ended) {
                if (old.index + 1 < state.clips.length) {
                    current = old.offset + clip.end - clip.start;
                    video.currentTime = state.clips[old.index + 1].start;
                    video.play().catch(() => {
                    });
                }
                else
                    current = duration();
            }
        }
    }
    else
        current = Math.min(duration(), current + (now - lastTick) / 1000 * state.speed);
    lastTick = now;
    if (state.kind === 'video' && video.seeking)
        audio.pause();
    else
        syncAudio();
    updateTime(false);
    const frameInterval = 1000 / 30, elapsed = now - lastDrawTime;
    if ((state.kind === 'demo' || !video.seeking) && (elapsed >= frameInterval - .1 || current >= duration())) {
        draw();
        // Keep the cadence's remainder instead of losing it on every display refresh.
        lastDrawTime = Number.isFinite(lastDrawTime) ? lastDrawTime + Math.floor((elapsed + .1) / frameInterval) * frameInterval : now;
    }
    if (cardPlaybackEnd != null && current / state.speed >= cardPlaybackEnd) {
        pause();
        updateTime();
        return;
    }
    if (current >= duration() - .001) {
        pause();
        updateTime();
        if (exporting)
            stopExport(false);
    }
    else
        frameHandle = requestAnimationFrame(tick);
}
function seekVideo(time) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            video.removeEventListener('seeked', done);
            reject(new Error('영상 탐색 시간 초과'));
        }, 10000);
        function done() {
            clearTimeout(timeout);
            video.removeEventListener('seeked', done);
            resolve();
        }
        if (Math.abs(video.currentTime - time) < .001 && video.readyState >= 2 && !video.seeking) {
            clearTimeout(timeout);
            resolve();
            return;
        }
        video.addEventListener('seeked', done, { once: true });
        video.currentTime = clamp(time, 0, Math.max(0, video.duration - .001));
    });
}
function waitForMedia(element, event, message) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            element.removeEventListener(event, loaded);
            element.removeEventListener('error', failed);
        };
        const loaded = () => {
            cleanup();
            resolve();
        }, failed = () => {
            cleanup();
            reject(new Error(message));
        };
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('파일을 읽는 데 시간이 초과되었습니다. 더 작은 파일로 다시 시도하세요.'));
        }, 20000);
        element.addEventListener(event, loaded, { once: true });
        element.addEventListener('error', failed, { once: true });
    });
}
async function setVideoFile(file) {
    if (sourceURL)
        URL.revokeObjectURL(sourceURL);
    sourceURL = URL.createObjectURL(file);
    const loaded = waitForMedia(video, 'loadeddata', '브라우저에서 지원하지 않는 영상입니다. H.264 MP4 또는 WebM을 사용해 주세요.');
    video.src = sourceURL;
    await loaded;
    if (!Number.isFinite(video.duration) || video.duration <= 0)
        throw new Error('영상 길이를 읽을 수 없습니다.');
    const thumb = document.createElement('canvas');
    thumb.width = 320;
    thumb.height = 180;
    thumb.getContext('2d').drawImage(video, 0, 0, 320, 180);
    thumbnail = thumb.toDataURL('image/jpeg', .7);
}
function visualSettings() {
    return visualPreset(state);
}
async function loadVideo(file) {
    if (recoveryBlocked())
        return;
    if (loadingMedia || exporting || transcribing || audioRecording.requesting || audioRecording.current) {
        toast('진행 중인 작업을 먼저 완료해 주세요.');
        return;
    }
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
        toast('동영상 파일을 선택해 주세요.');
        return;
    }
    if (file.size > 500 * 1024 * 1024) {
        toast('500 MB 이하의 동영상을 선택해 주세요.');
        return;
    }
    loadingMedia = true;
    pause();
    const old = videoFile, previousOutput = duration() / state.speed;
    toast('영상을 불러오는 중입니다…');
    try {
        await setVideoFile(file);
        if (recoveryBlocked())
            return;
        videoFile = file;
        state = {
            ...initial(),
            ...visualSettings(),
            kind: 'video',
            name: file.name.replace(/\.[^.]+$/, ''),
            fileName: file.name,
            duration: video.duration,
            clips: [{ start: 0, end: video.duration }],
            captions: []
        };
        retimeOutputLayers(state, previousOutput, state.duration);
        current = 0;
        selected = 0;
        audioFile = null;
        audio.pause();
        audio.removeAttribute('src');
        if (audioURL)
            URL.revokeObjectURL(audioURL);
        audioURL = '';
        history = [];
        future = [];
        inputHistory.reset();
        persistMedia();
        changed();
        renderPanel();
        resizePreview();
        toast('영상을 불러왔습니다. 9:16 세로 화면이 적용되었습니다.');
    }
    catch (e) {
        videoFile = old;
        if (old)
            await setVideoFile(old).catch(() => {
            });
        else {
            if (sourceURL)
                URL.revokeObjectURL(sourceURL);
            sourceURL = '';
            video.removeAttribute('src');
        }
        toast(e.message);
    }
    finally {
        loadingMedia = false;
    }
    $('#videoInput').value = '';
}
async function loadAudio(file, recording = null) {
    if (recoveryBlocked())
        return;
    if (loadingMedia || exporting || transcribing || audioRecording.requesting || (audioRecording.current && audioRecording.current !== recording))
        return;
    if (file.size > 100 * 1024 * 1024) {
        toast('100 MB 이하의 오디오를 선택해 주세요.');
        return;
    }
    loadingMedia = true;
    const nextURL = URL.createObjectURL(file);
    const probe = new Audio();
    try {
        const loaded = waitForMedia(probe, 'loadedmetadata', '지원하지 않는 오디오 형식입니다.');
        probe.src = nextURL;
        await loaded;
        if (recoveryBlocked() || (recording && audioRecording.current !== recording)) {
            URL.revokeObjectURL(nextURL);
            return;
        }
        pause();
        if (audioURL)
            URL.revokeObjectURL(audioURL);
        audioURL = nextURL;
        audio.src = audioURL;
        audioFile = file;
        state.audioName = file.name;
        state.audioOffset = 0;
        persistMedia();
        changed();
        renderPanel();
        toast('오디오를 연결했습니다. 재생해서 소리를 확인하세요.');
    }
    catch (e) {
        URL.revokeObjectURL(nextURL);
        toast(e.message);
    }
    finally {
        loadingMedia = false;
        probe.removeAttribute('src');
        probe.load();
    }
    $('#audioInput').value = '';
}
async function toggleRecording() {
    if (recoveryBlocked())
        return;
    if (audioRecording.current?.state === 'recording') {
        audioRecording.stop();
        return;
    }
    if (audioRecording.current || loadingMedia || exporting || transcribing || audioRecording.requesting)
        return;
    const project = state;
    await audioRecording.start(() => restorePhase === 'ready' && state === project && panel === 'audio' && !loadingMedia && !exporting && !transcribing);
}
function trim(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > state.duration || end - start < .1) {
        toast('시작·끝을 확인하세요. 클립은 0.1초 이상이어야 합니다.');
        return;
    }
    const clips = structuredClone(state.clips);
    clips[selected] = { start, end };
    if (!runEditorCommand('timeline.replace', { clips }))
        return;
    seekTo(state.clips.slice(0, selected).reduce((s, c) => s + c.end - c.start, 0));
    if (panel === 'settings')
        renderPanel();
}
function split() {
    if (state.clips.length >= MAX_CLIPS) {
        toast('클립은 1,000개 이하만 지원합니다. 클립을 삭제한 뒤 다시 분할하세요.');
        return;
    }
    const pos = locate(current), c = state.clips[pos.index];
    if (pos.source - c.start < .1 || c.end - pos.source < .1) {
        toast('클립의 시작과 끝에서 0.1초 이상 떨어진 위치를 선택하세요.');
        return;
    }
    pause();
    edit(() => {
        state.clips.splice(pos.index, 1, { start: c.start, end: pos.source }, { start: pos.source, end: c.end });
        selected = pos.index + 1;
    });
    openInspector('clip');
    toast('재생 위치에서 클립을 분할했습니다.');
}
function undo(redo = false) {
    inputHistory.reset();
    const from = redo ? future : history, to = redo ? history : future;
    if (!from.length)
        return;
    pause();
    to.push(JSON.stringify(state));
    state = JSON.parse(from.pop());
    timelineCache = null;
    if (restorePhase === 'ready')
        state.audioName = audioFile?.name || '';
    selected = clamp(selected, 0, state.clips.length - 1);
    current = Math.min(current, duration());
    changed();
    resizePreview();
    renderPanel();
    seekTo(current);
}
function modalOpen(title, body, footer = '') {
    modal.onclose?.();
    modal.onclose = null;
    modal.className = '';
    modal.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="icon-button" id="closeModal" aria-label="닫기">${icon('close')}</button></div>${body}${footer}`;
    $('#closeModal').onclick = () => modal.close();
    modal.showModal();
}
function confirmReset() {
    if (recoveryBlocked())
        return;
    if (transcribing || audioRecording.requesting || audioRecording.current) {
        toast('진행 중인 작업을 먼저 완료해 주세요.');
        return;
    }
    modalOpen('새로운 순간을 시작할까요?', '<p class="modal-copy">이 브라우저에 저장된 현재 프로젝트가 샘플 프로젝트로 교체됩니다. 필요한 영상은 먼저 내보내 주세요.</p>', '<div class="modal-foot"><button class="button" id="cancelReset">취소</button><button class="button primary" id="confirmReset">새 작업 시작</button></div>');
    $('#cancelReset').onclick = () => modal.close();
    $('#confirmReset').onclick = () => {
        if (recoveryBlocked() || audioRecording.current || audioRecording.requesting)
            return;
        pause();
        state = initial();
        timelineCache = null;
        videoFile = null;
        audioFile = null;
        thumbnail = '';
        video.removeAttribute('src');
        audio.removeAttribute('src');
        if (sourceURL)
            URL.revokeObjectURL(sourceURL);
        if (audioURL)
            URL.revokeObjectURL(audioURL);
        sourceURL = '';
        audioURL = '';
        current = 0;
        selected = 0;
        history = [];
        future = [];
        inputHistory.reset();
        persistMedia();
        changed();
        renderPanel();
        resizePreview();
        modal.close();
    };
}
function download(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function srtTime(t) {
    return srtTimestamp(t);
}
function outputCaptions() {
    return editedCaptions(state.captions, state.clips, state.speed);
}
function downloadSrt() {
    if (settingsUnavailable())
        return;
    try {
        const srt = projectSrt(state, { bom: true });
        if (!srt) {
            toast('저장할 자막이 없습니다.');
            return;
        }
        download(new Blob([srt], { type: 'text/plain;charset=utf-8' }), state.name + '.srt');
    }
    catch (error) {
        toast(error.message || '자막을 저장하지 못했습니다.');
    }
}
async function importSrt(file) {
    try {
        const beforeCommit = guardTextImport();
        if (file.size > MAX_SUBTITLE_BYTES)
            throw new Error('자막 파일은 2 MB 이하만 지원합니다.');
        const text = await readUtf8File(file);
        const captions = parseSubtitles(text, state.duration);
        const result = await editorService.execute('captions.replace', { captions }, beforeCommit);
        if (!result.ok)
            throw new Error(result.error.message);
        if (panel === 'captions')
            focusCaption(0);
        toast(`${captions.length}개의 자막을 불러왔습니다.`);
    }
    catch (error) {
        toast(error.message || '자막 파일을 읽지 못했습니다.');
    }
    finally {
        $('#srtInput').value = '';
    }
}
function guardTranscription(source, file) {
    const original = state, captions = state.captions;
    const context = () => JSON.stringify([state.captions, state.duration, source === 'audio' ? [state.audioOffset, duration()] : null]);
    const contents = context();
    return () => {
        if (transcriptionCancelled)
            throw new Error('자동 자막 생성을 취소했습니다.');
        if (state !== original || state.captions !== captions || file !== (source === 'audio' ? audioFile : videoFile) || context() !== contents)
            throw new Error('원본·자막·시간 기준이 변경되어 인식 결과를 적용하지 않았습니다. 다시 생성하세요.');
    };
}
async function generateCaptions() {
    if (recoveryBlocked())
        return;
    if (transcribing) {
        transcriptionCancelled = true;
        transcription.cancel();
        return;
    }
    if (audioRecording.current || audioRecording.requesting || loadingMedia || exporting) {
        toast('진행 중인 작업을 먼저 완료해 주세요.');
        return;
    }
    const source = $('#captionSource').value, language = $('#language').value, file = source === 'audio' ? audioFile : videoFile;
    if (!file) {
        toast(source === 'video' ? '샘플에는 음성이 없습니다. 음성이 있는 영상을 업로드하세요.' : '인식할 오디오를 먼저 추가하세요.');
        return;
    }
    if (state.duration > 180) {
        toast('자동 자막은 원본 길이 3분 이하를 지원합니다. 짧은 원본을 업로드하세요.');
        return;
    }
    const beforeApply = guardTranscription(source, file);
    pause();
    transcriptionCancelled = false;
    transcribing = true;
    const button = $('#generateCaptions');
    button.disabled = false;
    button.innerHTML = '<span class="spinner"></span> 준비 중 · 취소';
    const status = message => {
        transcriptionStatus = message;
        const el = $('#asrStatus');
        if (el) {
            el.hidden = false;
            el.textContent = message;
        }
    };
    try {
        status('오디오를 읽고 있습니다…');
        const decodeCtx = new AudioContext();
        let buffer;
        try {
            buffer = await decodeCtx.decodeAudioData(await file.arrayBuffer());
        }
        finally {
            await decodeCtx.close();
        }
        const length = Math.min(buffer.duration, 180), offline = new OfflineAudioContext(1, Math.ceil(length * 16000), 16000), src = offline.createBufferSource();
        src.buffer = buffer;
        src.connect(offline.destination);
        src.start();
        const pcm = (await offline.startRendering()).getChannelData(0);
        beforeApply();
        let peak = 0;
        for (let i = 0; i < pcm.length; i += 50)
            peak = Math.max(peak, Math.abs(pcm[i]));
        if (peak < .002)
            throw new Error('음성을 찾지 못했습니다. 소리가 있는 영상이나 오디오를 선택하세요.');
        status('음성 인식 모델을 준비합니다. 첫 실행은 다운로드에 시간이 걸릴 수 있습니다.');
        const result = await transcription.transcribe(pcm, language, status);
        let caps = (result.chunks || []).map(c => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? length, text: c.text.trim() }));
        // Check raw times before audio mapping can clamp them or discard reversed spans.
        for (const c of caps)
            if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start)
                throw new Error('인식된 자막의 시간 정보가 올바르지 않습니다. 기존 자막은 유지됩니다.');
        caps = caps.filter(c => c.text);
        if (!caps.length && result.text?.trim())
            caps.push({ start: 0, end: length, text: result.text.trim() });
        if (source === 'audio')
            caps = mapAudioCaptions(caps, state.audioOffset, duration());
        if (!caps.length)
            throw new Error('인식된 음성이 없습니다. 음질과 언어 설정을 확인하세요.');
        if (caps.length > MAX_CAPTIONS)
            throw new Error('자막은 10,000개 이하만 지원합니다.');
        const prepared = prepareCommand(state, 'captions.replace', { captions: caps });
        beforeApply();
        edit(() => state.captions = prepared.project.captions);
        toast(`${caps.length}개의 자막을 생성했습니다. 인식 결과를 확인해 주세요.`);
    }
    catch (e) {
        toast(e.message || '자막 생성에 실패했습니다. SRT 불러오기나 직접 입력을 사용할 수 있습니다.');
    }
    finally {
        transcribing = false;
        if (panel === 'captions') {
            const restoreFocus = document.activeElement?.id === 'generateCaptions';
            renderPanel();
            if (restoreFocus)
                $('#captionCreate summary').focus();
        }
    }
}
function supportedTypes() {
    if (typeof MediaRecorder === 'undefined')
        return [];
    return [{ mime: 'video/mp4;codecs=avc1.424028,mp4a.40.2', label: 'MP4 · H.264', ext: 'mp4' }, { mime: 'video/webm;codecs=vp9,opus', label: 'WebM · VP9', ext: 'webm' }, { mime: 'video/webm;codecs=vp8,opus', label: 'WebM · VP8', ext: 'webm' }, { mime: 'video/mp4', label: 'MP4', ext: 'mp4' }].filter(t => MediaRecorder.isTypeSupported(t.mime));
}
function exportDialog() {
    if (recoveryBlocked() || exporting)
        return;
    if (audioRecording.requesting || loadingMedia || audioRecording.current || transcribing) {
        toast('파일 로드, 녹음 또는 자막 인식을 먼저 완료해 주세요.');
        return;
    }
    pause();
    const types = supportedTypes();
    if (!types.length || !canvas.captureStream) {
        toast('이 브라우저는 영상 내보내기를 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어주세요.');
        return;
    }
    modalOpen('쇼츠를 완성할 시간', `<p class="modal-copy">타이틀, 자막, 구간별 문구, 움직임과 오디오를 하나의 영상으로 저장합니다.</p><div class="modal-field"><label for="exportFormat">파일 형식</label><select id="exportFormat">${types.map((t, i) => `<option value="${i}">${t.label}</option>`).join('')}</select></div><div class="modal-field"><label for="exportQuality">해상도</label><select id="exportQuality"><option value="720">720p · 빠른 저장</option><option value="1080" selected>1080p · 고화질</option></select></div><div class="modal-field"><span>영상 길이</span><strong>${fmt(duration() / state.speed)}</strong></div><div class="notice">영상 길이만큼 실시간으로 저장합니다. 이 탭을 켜두세요. 지원 형식은 브라우저에 따라 다릅니다.</div>`, '<div class="modal-foot"><button class="button" id="cancelExportDialog">취소</button><button class="button primary" id="startExport">영상 내보내기</button></div>');
    $('#cancelExportDialog').onclick = () => modal.close();
    $('#startExport').onclick = () => startExport(types[+$('#exportFormat').value], +$('#exportQuality').value);
}
async function startExport(type, quality) {
    if (recoveryBlocked() || exporting || audioRecording.current || audioRecording.requesting || loadingMedia || transcribing)
        return;
    pause();
    const request = videoExport.begin();
    try {
        exporting = true;
        exportCancelled = false;
        document.body.classList.add('exporting');
        await ensureAudio();
        if (request !== videoExport.request)
            return;
        await document.fonts.ready;
        if (request !== videoExport.request)
            return;
        if (recoveryBlocked()) {
            stopExport(true);
            return;
        }
        videoExport.createSurface(state.ratio, quality);
        seekTo(0);
        if (state.kind === 'video')
            await seekVideo(state.clips[0].start);
        if (request !== videoExport.request)
            return;
        draw();
        const recorder = videoExport.capture(request, type, quality, destination.stream, {
            onError: () => {
                stopExport(true);
                toast('영상 저장 중 오류가 발생했습니다. 더 낮은 해상도로 다시 시도하세요.');
            },
            onStop: blob => {
                pause();
                cleanupExport(request);
                if (!blob.size) {
                    toast('출력 파일이 비어 있습니다. 다시 시도해 주세요.');
                    return;
                }
                download(blob, `${state.name || 'moment-shorts'}.${type.ext}`);
                modal.innerHTML = `<div class="modal-head"><h2>당신의 쇼츠가 완성됐어요.</h2></div><p class="modal-copy">${esc(state.name)}<br>${quality}p · ${type.ext.toUpperCase()} · ${fmt(duration() / state.speed)}</p><div class="notice">다운로드한 파일을 재생해 영상과 자막을 확인한 뒤 YouTube에 업로드하세요.</div><div class="modal-foot"><button class="button primary" id="exportDone">편집으로 돌아가기</button></div>`;
                $('#exportDone').onclick = () => modal.close();
            },
        });
        modal.innerHTML = '<div class="modal-head"><h2>순간을 담는 중…</h2><strong id="exportPercent">0%</strong></div><p class="modal-copy">이 탭을 열어두면 완성된 영상이 다운로드됩니다.</p><div class="progress"><i id="exportProgress"></i></div><button class="button full" id="cancelRunningExport">내보내기 취소</button>';
        $('#cancelRunningExport').onclick = () => {
            if (request === videoExport.request)
                stopExport(true);
        };
        muted = false;
        renderInspector();
        recorder.start(250);
        await play();
    }
    catch (e) {
        if (request !== videoExport.request)
            return;
        stopExport(true);
        toast('내보내기를 시작하지 못했습니다. 브라우저와 영상 형식을 확인하세요.');
    }
}
function stopExport(cancelled) {
    if (!exporting)
        return;
    exportCancelled = cancelled;
    pause();
    const request = videoExport.request, recorder = videoExport.recorder;
    if (cancelled) {
        // Invalidate before stop: even synchronous or retained callbacks no longer own the UI/resources.
        cleanupExport(request);
        try {
            if (recorder && recorder.state !== 'inactive')
                recorder.stop();
        }
        catch {
        }
        modal.close();
        toast('내보내기를 취소했습니다.');
    }
    else if (recorder) {
        // An inactive recorder may still owe its final dataavailable and stop events.
        try {
            if (recorder.state !== 'inactive')
                recorder.stop();
        }
        catch {
            cleanupExport(request);
            modal.close();
            toast('영상 저장을 마무리하지 못했습니다. 다시 시도해 주세요.');
        }
    }
    else
        cleanupExport(request);
}
function cleanupExport(request) {
    videoExport.release(request);
}
function bind() {
    icons();
    $$('[data-panel]').forEach(b => b.onclick = () => switchPanel(b.dataset.panel));
    document.addEventListener('click', e => {
        const ratio = e.target.closest('[data-ratio]'), fit = e.target.closest('[data-fit]'), style = e.target.closest('[data-style]');
        if (ratio)
            setRatio(ratio.dataset.ratio);
        if (fit)
            edit(() => state.fit = fit.dataset.fit);
        if (style)
            edit(() => {
                state.style = style.dataset.style;
                state.captionItalic = state.style === 'impact';
                state.captionStroke = state.style === 'minimal' ? 2 : 3;
            }, panel === 'text');
    });
    $('#videoInput').onchange = e => e.target.files[0] && loadVideo(e.target.files[0]);
    $('#audioInput').onchange = e => e.target.files[0] && loadAudio(e.target.files[0]);
    $('#srtInput').onchange = e => e.target.files[0] && importSrt(e.target.files[0]);
    $('#projectInput').onchange = e => e.target.files[0] && importProjectSettings(e.target.files[0]);
    $('#projectName').onchange = e => edit(() => state.name = e.target.value.trim() || '제목 없는 쇼츠');
    $('#saveButton').onclick = () => saveProject(true);
    $('#playButton').onclick = () => playing ? pause() : play();
    $('#startButton').onclick = () => {
        pause();
        seekTo(0);
    };
    $('#seek').oninput = e => {
        pause();
        seekTo(+e.target.value);
    };
    $('#muteButton').onclick = () => {
        muted = !muted;
        $('#muteButton').innerHTML = icon(muted ? 'mute' : 'volume');
        $('#muteButton').setAttribute('aria-label', muted ? '미리보기 음소거 해제' : '미리보기 음소거');
        if (audioCtx)
            renderInspector();
    };
    $('#speed').onchange = e => runEditorCommand('project.update', { patch: { speed: +e.target.value } });
    inputHistory.bind($('#zoom'), () => state.zoom, value => {
        state.zoom = value;
        draw();
        renderInspector();
        scheduleSave();
    });
    inputHistory.bind($('#volume'), () => state.volume, value => {
        state.volume = value;
        renderInspector();
        scheduleSave();
    });
    $('#trimButton').onclick = () => trim($('#trimStart').valueAsNumber, $('#trimEnd').valueAsNumber);
    $('#splitButton').onclick = split;
    $('#deleteButton').onclick = () => {
        if (state.clips.length <= 1)
            return;
        pause();
        edit(() => {
            state.clips.splice(selected, 1);
            selected = Math.min(selected, state.clips.length - 1);
        });
        seekTo(0);
    };
    for (const [id, delta] of [['moveLeft', -1], ['moveRight', 1]])
        $('#' + id).onclick = () => {
            const dest = selected + delta;
            if (dest < 0 || dest >= state.clips.length)
                return;
            pause();
            edit(() => {
                const c = state.clips.splice(selected, 1)[0];
                state.clips.splice(dest, 0, c);
                selected = dest;
            });
            seekTo(0);
        };
    $('#undoButton').onclick = () => undo();
    $('#redoButton').onclick = () => undo(true);
    $('#videoTrack').onclick = e => {
        const clip = e.target.closest('[data-clip]');
        if (!clip)
            return;
        pause();
        selected = +clip.dataset.clip;
        const c = state.clips[selected], r = clip.getBoundingClientRect(), offset = state.clips.slice(0, selected).reduce((s, c) => s + c.end - c.start, 0);
        seekTo(offset + clamp((e.clientX - r.left) / r.width, 0, .999) * (c.end - c.start));
        renderInspector();
        renderTimeline();
        openInspector('clip');
        if (panel === 'settings')
            renderPanel();
    };
    $('#ruler').onclick = e => {
        pause();
        const r = e.currentTarget.getBoundingClientRect();
        seekTo((e.clientX - r.left) / r.width * duration());
    };
    $('#captionTrack').onclick = navigateCaption;
    $('#audioTrack').onclick = () => switchPanel('audio');
    $('#ratioShortcut').onclick = () => switchPanel('settings');
    $('#titleTrack').onclick = e => {
        const id = e.target.closest('[data-track-card]')?.dataset.trackCard;
        if (id) {
            selectedCard = id;
            effectTab = 'cards';
            const card = state.overlays.find(c => c.id === id);
            pause();
            if (card)
                seekTo(Math.min(card.end - .001, card.start + .2) * state.speed);
            switchPanel('effects');
        }
        else {
            textLayer = e.target.closest('[data-track-layer]')?.dataset.trackLayer || 'title';
            switchPanel('text');
        }
    };
    $('#safeButton').onclick = () => {
        const b = $('#safeButton');
        $('#safeGuide').hidden = !$('#safeGuide').hidden;
        b.setAttribute('aria-pressed', !$('#safeGuide').hidden);
    };
    $('#resetButton').onclick = confirmReset;
    $('#exportButton').onclick = exportDialog;
    $('#helpButton').onclick = showHelp;
    modal.addEventListener('cancel', e => {
        if (exporting)
            e.preventDefault();
    });
    let drag = null;
    canvas.onpointerdown = e => {
        if (exporting || restorePhase === 'restoring')
            return;
        pause();
        const scene = selectedSceneLayer(), mode = scene ? 'scene' : panel === 'text' && textLayer !== 'frame' ? textLayer : 'video';
        const l = scene || (mode === 'caption' ? { x: state.captionX, y: state.captionY } : state.design[mode]);
        if (mode !== 'video' && l?.enabled === false)
            return;
        drag = {
            x: e.clientX,
            y: e.clientY,
            px: mode === 'video' ? state.panX : l.x,
            py: mode === 'video' ? state.panY : l.y,
            mode,
            sceneId: scene?.id,
            project: state,
            changed: false
        };
        canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = e => {
        if (!drag)
            return;
        if (drag.project !== state) {
            drag = null;
            return;
        }
        const r = canvas.getBoundingClientRect(), x = drag.px + (e.clientX - drag.x) / r.width, y = drag.py + (e.clientY - drag.y) / r.height;
        const mode = drag.mode, target = mode === 'video' || mode === 'caption' ? state : mode === 'scene' ? state.overlays.find(c => c.id === drag.sceneId) : state.design[mode];
        if (!target)
            return;
        const xKey = mode === 'video' ? 'panX' : mode === 'caption' ? 'captionX' : 'x', yKey = mode === 'video' ? 'panY' : mode === 'caption' ? 'captionY' : 'y';
        const nextX = clamp(x, mode === 'video' ? -1 : .1, mode === 'video' ? 1 : .9), nextY = mode === 'video' ? clamp(y, -1, 1) : mode === 'scene' ? clamp(y, .08, .8) : mode === 'caption' ? clamp(y, .1, .9) : clamp(y, .06, .93);
        if (target[xKey] === nextX && target[yKey] === nextY)
            return;
        if (!drag.changed) {
            snapshot();
            drag.changed = true;
        }
        target[xKey] = nextX;
        target[yKey] = nextY;
        updateLayerGuide();
        requestDraw();
    };
    const endDrag = () => {
        if (!drag)
            return;
        const edited = drag.changed && drag.project === state;
        drag = null;
        if (!edited)
            return;
        changed();
        if (panel === 'text' || panel === 'effects')
            renderPanel();
    };
    canvas.onpointerup = endDrag;
    canvas.onpointercancel = endDrag;
    document.addEventListener('keydown', e => {
        if (/INPUT|TEXTAREA|SELECT|SUMMARY/.test(e.target.tagName) || modal.open || exporting)
            return;
        if (e.code === 'Space') {
            if (e.target.tagName === 'BUTTON')
                return;
            e.preventDefault();
            playing ? pause() : play();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo(e.shiftKey);
        }
        if (e.key === 'ArrowLeft') {
            pause();
            seekTo(current - 1);
        }
        if (e.key === 'ArrowRight') {
            pause();
            seekTo(current + 1);
        }
    });
    window.addEventListener('resize', resizePreview);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (exporting) {
                stopExport(true);
                toast('탭이 숨겨져 내보내기를 중단했습니다. 이 탭을 연 상태로 다시 시도하세요.');
            }
            else
                pause();
        }
    });
    window.addEventListener('beforeunload', e => {
        if (exporting || audioRecording.current || (restorePhase === 'failed' && JSON.stringify(state) !== recoveryBaseline)) {
            e.preventDefault();
            e.returnValue = true;
        }
    });
    video.addEventListener('seeked', requestDraw);
}
async function init() {
    bind();
    editorReady = false;
    restorePhase = 'restoring';
    restoreMessage = '프로젝트를 불러오는 중…';
    recoveryValid = false;
    clearTimeout(saveTimer);
    let recovered = null, cause = '저장된 프로젝트를 불러오지 못함';
    try {
        const raw = localStorage.getItem('moment-state-v1');
        if (raw !== null) {
            cause = '저장된 편집 설정을 읽을 수 없습니다';
            const saved = JSON.parse(raw);
            if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Array.isArray(saved.clips) || !saved.clips.length)
                throw new Error('Invalid saved project');
            recovered = readProjectDocument({
                format: 'moment-project',
                formatVersion: 1,
                project: { ...saved, schemaVersion: saved.schemaVersion ?? 1 } });
            state = recovered;
            timelineCache = null;
            cause = '저장된 미디어를 읽을 수 없습니다';
            [videoFile, audioFile] = await Promise.all([dbGet('video'), dbGet('audio')]);
            if (state.kind === 'video') {
                cause = '저장된 영상 파일을 찾을 수 없습니다';
                if (!videoFile)
                    throw new Error('Missing video');
                cause = '저장된 영상을 열 수 없습니다';
                await setVideoFile(videoFile);
            }
            if (state.audioName && !audioFile) {
                cause = '저장된 오디오 파일을 찾을 수 없습니다';
                throw new Error('Missing audio');
            }
            if (audioFile) {
                cause = '저장된 오디오를 열 수 없습니다';
                audioURL = URL.createObjectURL(audioFile);
                const loaded = waitForMedia(audio, 'loadeddata', cause);
                audio.src = audioURL;
                await loaded;
                if (!(audio.duration > 0))
                    throw new Error('Invalid audio duration');
            }
        }
        restorePhase = 'ready';
        saveStatus(raw === null ? '이 브라우저에 저장' : '저장된 프로젝트를 불러왔습니다');
    }
    catch (e) {
        state = recovered || initial();
        timelineCache = null;
        restorePhase = 'failed';
        recoveryValid = !!recovered;
        restoreMessage = cause + ' · 변경사항은 저장되지 않습니다. ' + (recoveryValid ? '새로고침 전에 사용 가이드에서 편집 설정을 내보내세요. 새로고침은 복원을 다시 시도합니다.' : '원래 설정을 내보낼 수 없습니다. 새로고침은 읽기를 다시 시도합니다.');
        recoveryBaseline = JSON.stringify(state);
        clearTimeout(saveTimer);
        pause();
        recoveryBlocked();
    }
    document.body.classList.toggle('restore-failed', restorePhase === 'failed');
    renderPanel();
    renderInspector();
    renderTimeline();
    resizePreview();
    switchPanel(panel);
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
