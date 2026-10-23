import { createTextFileWorkflow } from './text-file-workflow.mjs';
import { createMediaSources } from './media-sources.mjs';
import { createProjectPersistence } from './project-persistence.mjs';
import { createCaptionPanel } from './caption-panel.mjs';
import { createCaptionGeneration } from './caption-generation.mjs';
import { createInspectorView } from './inspector-view.mjs';
import { bindPreviewDrag, bindEditorKeyboard } from './editor-interactions.mjs';
import { createTemplatePreview } from './template-preview.mjs';
import { createVideoExport } from './video-export.mjs';
import { createAudioRecording } from './audio-recording.mjs';
import { createTranscriptionClient } from './transcription-client.mjs';
import { icon, esc, fmt } from './ui-format.mjs';
import { mediaPanelMarkup, audioPanelMarkup, settingsPanelMarkup } from './panel-markup.mjs';
import { createDemoProject, srtTimestamp, MAX_CLIPS } from './core/project.mjs';
import { prepareCommand } from './core/commands.mjs';
import { CommandError } from './core/validation.mjs';
import { createEditorService } from './integration/editor-service.mjs';
import { editedCaptions } from './captions.mjs';
import { createTimelineView } from './timeline-view.mjs';
import { createInputHistory } from './input-history.mjs';
import { defaultEnhancements, newCard, retimeOutputLayers, activeSceneLayers, sceneBounds } from './effects.mjs';
import { applyTemplate, visualPreset } from './template-catalog.mjs';
import { createTemplateWorkspace } from './template-workspace.mjs';
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
let state = initial(), current = 0, selected = 0, playing = false, panel = 'templates', textLayer = 'title', history = [], future = [], exporting = false, muted = false, transcribing = false, transcriptionStatus = '';
const video = $('#sourceVideo'), audio = $('#sourceAudio'), canvas = $('#preview'), ctx = canvas.getContext('2d'), sample = new Image(), modal = $('#modal');
let audioCtx, videoNode, audioNode, videoGain, audioGain, destination, exportCancelled = false, lastTick = 0;
let sampleRaster = null, lastSaveStatus = '', effectTab = 'cards', selectedCard = null, cardPlaybackEnd = null;
const composition = createCompositionRenderer(() => document.createElement('canvas'));
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
    toast: message => toast(message),
});
const captionPanel = createCaptionPanel({
    query: $, queryAll: $$,
    getProject: () => state,
    getDuration: () => duration(),
    sourceTime: () => locate(current).source,
    edit: (change, refresh) => edit(change, refresh),
    refresh: () => renderPanel(),
    toast: message => toast(message),
});
const projectStore = createProjectStore();
const sources = createMediaSources({ video, audio });
const persistence = createProjectPersistence({
    store: projectStore, sources,
    getProject: () => state,
    replaceProject: project => { state = project; timelineCache = null; },
    saveStatus: (text, ok) => saveStatus(text, ok),
    toast: message => toast(message),
    pause: () => pause(),
});
function recoveryBlocked(show = true) { return persistence.recoveryBlocked(show); }
function settingsUnavailable() { return persistence.settingsUnavailable(); }
function scheduleSave() { persistence.scheduleSave(); }
function saveProject(show = false) { return persistence.saveProject(show); }
function persistMedia() { persistence.persistMedia(); }

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
const inspectorView = createInspectorView($, $$);
const timelineView = createTimelineView($, () => performance.now());
let timelineCache = null, frameHandle = 0, paintHandle = 0, lastDrawTime = -Infinity, playRequest = 0, loadingMedia = false;
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
const inputHistory = createInputHistory(snapshot, () => exporting || persistence.restorePhase === 'restoring');
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
    if (exporting || persistence.restorePhase === 'restoring')
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
    const preserveTrim = ['project.update', 'title.update', 'captions.replace'].includes(command) && inspectorView.hasTrimTarget(state.clips[selected]);
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
const { importProjectSettings, downloadProjectSettings, importSrt, downloadSrt } = createTextFileWorkflow({
    getProject: () => state,
    execute: (...args) => editorService.execute(...args),
    query: $,
    closeModal: () => modal.close(),
    focusImportedCaption: () => { if (panel === 'captions') focusCaption(0); },
    settingsUnavailable: () => settingsUnavailable(),
    download: (blob, name) => download(blob, name),
    toast: message => toast(message),
});
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
    inspectorView.open(section);
}
function renderInspector() {
    inspectorView.render(state, selected, history.length, future.length);
    if (videoGain) {
        videoGain.gain.value = muted ? 0 : state.volume;
        audioGain.gain.value = muted ? 0 : state.audioVolume;
    }
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
    timelineView.renderLayers(state, duration());
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
function renderCaptionsPanel(target) {
    captionPanel.render(target, { transcribing, hasAudio: !!sources.audioFile, transcriptionStatus }, {
        design: () => {
            textLayer = 'caption';
            switchPanel('text');
        },
        generate: generateCaptions,
        download: downloadSrt,
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
    captionPanel.focus(index);
}
function renderPanel() {
    const target = $('#panelContent');
    if (panel === 'templates') {
        templateWorkspace.render(target);
    }
    else if (panel === 'effects') {
        renderEffects(target);
    }
    else if (panel === 'media') {
        target.innerHTML = mediaPanelMarkup(state, sources.thumbnail);
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
        target.innerHTML = audioPanelMarkup(state, !!sources.audioFile, sources.audioFile ? duration() : 0);
        $('#chooseAudio').onclick = () => $('#audioInput').click();
        $('#recordButton').onclick = toggleRecording;
        if (sources.audioFile) {
            $('#removeAudio').onclick = () => {
                if (recoveryBlocked() || audioRecording.current || audioRecording.requesting || loadingMedia)
                    return;
                pause();
                sources.audioFile = null;
                state.audioName = '';
                audio.removeAttribute('src');
                if (sources.audioURL)
                    URL.revokeObjectURL(sources.audioURL);
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
        ready: state.kind === 'demo' ? sample.complete : persistence.restorePhase === 'ready' && video.readyState >= 2,
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
    if (persistence.restorePhase !== 'ready' || !sources.audioFile)
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
    if (persistence.restorePhase === 'ready' && state.kind === 'video' && Number.isFinite(video.duration))
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
    const old = sources.videoFile, previousOutput = duration() / state.speed;
    toast('영상을 불러오는 중입니다…');
    try {
        await sources.setVideoFile(file);
        if (recoveryBlocked())
            return;
        sources.videoFile = file;
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
        sources.audioFile = null;
        audio.pause();
        audio.removeAttribute('src');
        if (sources.audioURL)
            URL.revokeObjectURL(sources.audioURL);
        sources.audioURL = '';
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
        sources.videoFile = old;
        if (old)
            await sources.setVideoFile(old).catch(() => {
            });
        else {
            if (sources.sourceURL)
                URL.revokeObjectURL(sources.sourceURL);
            sources.sourceURL = '';
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
        const loaded = sources.waitForMedia(probe, 'loadedmetadata', '지원하지 않는 오디오 형식입니다.');
        probe.src = nextURL;
        await loaded;
        if (recoveryBlocked() || (recording && audioRecording.current !== recording)) {
            URL.revokeObjectURL(nextURL);
            return;
        }
        pause();
        if (sources.audioURL)
            URL.revokeObjectURL(sources.audioURL);
        sources.audioURL = nextURL;
        audio.src = sources.audioURL;
        sources.audioFile = file;
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
    await audioRecording.start(() => persistence.restorePhase === 'ready' && state === project && panel === 'audio' && !loadingMedia && !exporting && !transcribing);
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
    if (persistence.restorePhase === 'ready')
        state.audioName = sources.audioFile?.name || '';
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
        sources.reset();
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
async function generateCaptions() {
    if (recoveryBlocked())
        return;
    if (transcribing) {
        captionGeneration.cancel();
        return;
    }
    if (audioRecording.current || audioRecording.requesting || loadingMedia || exporting) {
        toast('진행 중인 작업을 먼저 완료해 주세요.');
        return;
    }
    const source = $('#captionSource').value, language = $('#language').value, file = source === 'audio' ? sources.audioFile : sources.videoFile;
    if (!file) {
        toast(source === 'video' ? '샘플에는 음성이 없습니다. 음성이 있는 영상을 업로드하세요.' : '인식할 오디오를 먼저 추가하세요.');
        return;
    }
    if (state.duration > 180) {
        toast('자동 자막은 원본 길이 3분 이하를 지원합니다. 짧은 원본을 업로드하세요.');
        return;
    }
    try {
        await captionGeneration.generate(source, file, language, {
            start: () => {
                pause();
                transcribing = true;
                const button = $('#generateCaptions');
                button.disabled = false;
                button.innerHTML = '<span class="spinner"></span> 준비 중 · 취소';
            },
            status: message => {
                transcriptionStatus = message;
                const el = $('#asrStatus');
                if (el) {
                    el.hidden = false;
                    el.textContent = message;
                }
            },
            apply: (captions, count) => {
                edit(() => state.captions = captions);
                toast(`${count}개의 자막을 생성했습니다. 인식 결과를 확인해 주세요.`);
            },
        });
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
    bindPreviewDrag(canvas, {
        getProject: () => state,
        blocked: () => exporting || persistence.restorePhase === 'restoring',
        pause: () => pause(),
        selection: () => {
            const scene = selectedSceneLayer();
            return { scene, mode: scene ? 'scene' : panel === 'text' && textLayer !== 'frame' ? textLayer : 'video' };
        },
        snapshot: () => snapshot(),
        preview: () => {
            updateLayerGuide();
            requestDraw();
        },
        commit: () => {
            changed();
            if (panel === 'text' || panel === 'effects')
                renderPanel();
        },
    });
    bindEditorKeyboard(document, {
        blocked: () => modal.open || exporting,
        togglePlayback: () => playing ? pause() : play(),
        undo: redo => undo(redo),
        seekBy: delta => {
            pause();
            seekTo(current + delta);
        },
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
        if (exporting || audioRecording.current || (persistence.restorePhase === 'failed' && JSON.stringify(state) !== persistence.recoveryBaseline)) {
            e.preventDefault();
            e.returnValue = true;
        }
    });
    video.addEventListener('seeked', requestDraw);
}
async function init() {
    bind();
    editorReady = false;
    await persistence.restore();
    document.body.classList.toggle('restore-failed', persistence.restorePhase === 'failed');
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
