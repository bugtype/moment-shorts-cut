import { SUPPORTED_ASPECT_RATIOS } from './core/aspect-ratio.mjs';
import { t, text, mark, attrs } from './i18n.mjs';
import { icon, esc, fmt } from './ui-format.mjs';

// Pure markup: the app retains current state, event bindings and edit history.
export const CAPTION_PAGE_SIZE = 50;
export function captionsPanelMarkup({ captions, speakerLabels }, { toolsOpen, transcribing, hasAudio, transcriptionStatus, page = 0 }) {
    const start = Math.max(0, Math.min(Math.floor(page), Math.ceil(captions.length / CAPTION_PAGE_SIZE) - 1)) * CAPTION_PAGE_SIZE;
    const end = Math.min(captions.length, start + CAPTION_PAGE_SIZE);
    const rows = captions.slice(start, end).map((c, i) => captionRowMarkup(c, start + i, speakerLabels, start + i === captions.length - 1)).join('');
    return (
        `<section class="caption-workspace">` +
        `\n <h1 class="panel-heading">${text('panels.captionsCount', {count: captions.length})}</h1>` +
        `\n <div class="panel-actions">` +
        `<button class="button" id="addCaption">${text('panels.addCaption')}</button>` +
        `<select class="panel-select" id="captionExportFormat" ${attrs('aria-label', 'panels.captionExportFormat')}><option value="srt">SRT</option><option value="vtt">VTT</option><option value="txt" ${mark('panels.txtTranscript')}>${esc(t('panels.txtTranscript'))}</option><option value="review-txt" ${mark('review.option')}>${esc(t('review.option'))}</option></select>` +
        `<button class="button" id="downloadCaptions">${text('panels.save')}</button>` +
        `</div>` +
        `\n <div id="captionRows" role="region" ${attrs('aria-label', 'panels.captionList')} tabindex="0">${rows || `<p class="empty-text">${text('panels.captionEmpty')}</p>`}</div>` +
        `<nav class="panel-actions caption-pages" ${attrs('aria-label', 'panels.captionPages')} ${captions.length <= CAPTION_PAGE_SIZE ? 'hidden' : ''}>` +
        `<button class="button" id="previousCaptionPage" ${attrs('aria-label', 'panels.previousCaptionPage')} ${start === 0 ? 'disabled' : ''}>${text('panels.previous')}</button>` +
        `<span role="status" aria-live="polite">${captions.length ? start + 1 : 0}–${end} / ${captions.length}</span>` +
        `<button class="button" id="nextCaptionPage" ${attrs('aria-label', 'panels.nextCaptionPage')} ${end >= captions.length ? 'disabled' : ''}>${text('panels.next')}</button>` +
        `<div class="caption-page-jump" role="group" ${attrs('aria-label', 'panels.pageJump')}>` +
        `<input class="panel-input" id="captionPageNumber" type="number" min="1" max="${Math.max(1, Math.ceil(captions.length / CAPTION_PAGE_SIZE))}" step="1" value="${Math.floor(start / CAPTION_PAGE_SIZE) + 1}" ${attrs('aria-label', 'panels.pageNumber')}>` +
        `<span aria-hidden="true">/ ${Math.max(1, Math.ceil(captions.length / CAPTION_PAGE_SIZE))}</span>` +
        `<button class="button" id="goCaptionPage" ${attrs('aria-label', 'panels.goPage')}>${text('panels.go')}</button></div></nav>` +
        `\n <details class="caption-disclosure" id="captionCreate" ${!captions.length || transcribing ? 'open' : ''}>` +
        `\n  <summary>${text('panels.generateImport')}<span data-icon="chevron">` +
        `</span>` +
        `</summary>` +
        `\n  <div class="caption-disclosure-body">` +
        `<button class="button full" id="importSrt">${text('panels.importSrt')}</button>` +
        `\n  <label class="panel-label" for="captionSource">${text('panels.recognitionAudio')}</label>` +
        `<select class="panel-select" id="captionSource">` +
        `<option value="video" ${mark('panels.sourceVoice')}>${esc(t('panels.sourceVoice'))}</option>` +
        `<option value="audio" ${hasAudio ? '' : 'disabled'} ${mark('panels.addedAudio')}>${esc(t('panels.addedAudio'))}</option>` +
        `</select>` +
        `<label class="panel-label" for="language">${text('panels.speechLanguage')}</label>` +
        `<select class="panel-select" id="language">` +
        `<option value="korean">한국어</option>` +
        `<option value="english">English</option>` +
        `<option value="japanese">日本語</option>` +
        `<option value="chinese">中文</option>` +
        `</select>` +
        `<button class="button dark full" id="generateCaptions">${transcribing ? '<span class="spinner"></span> ' + text('panels.recognizingCancel') : icon('sparkle') + ' ' + text('panels.generateCaptions')}</button>` +
        `<div class="notice">${text('panels.asrNotice')}</div>` +
        `\n  <p id="asrStatus" role="status" aria-live="polite" ${transcribing ? '' : 'hidden'}>${transcriptionStatus?.messageKey ? text(transcriptionStatus.messageKey, transcriptionStatus.messageParams) : esc(transcriptionStatus)}</p>` +
        `</div>` +
        `\n </details>` +
        `\n <details class="caption-disclosure" id="captionTools" ${toolsOpen ? 'open' : ''}>` +
        `\n  <summary>${text('panels.captionTools')}<span data-icon="chevron">` +
        `</span>` +
        `</summary>` +
        `\n  <div class="caption-disclosure-body">` +
        `<button class="button" id="removeCaptionRange" ${captions.length ? '' : 'disabled'}>${text('panels.removeCaptionRange')}</button>` +
        `<button class="button" id="inspectCaptionOverlaps">${text('panels.captionOverlaps')}</button>` +
        `<button class="button" id="inspectCaptions">${text('panels.inspectCaptions')}</button>` +
        `<section ${attrs('aria-label', 'panels.findReplace')}>` +
        `<label class="panel-label" for="captionFind">${text('panels.find')}</label>` +
        `<textarea class="panel-input" id="captionFind" rows="2" maxlength="2000" autocomplete="off" spellcheck="false"></textarea>` +
        `<div class="panel-actions" role="group" ${attrs('aria-label', 'panels.matchNavigation')}>` +
        `<button class="button" id="previousCaptionMatch" ${attrs('aria-label', 'panels.previousMatch')} disabled>${text('panels.previous')}</button>` +
        `<output id="captionSearchStatus" role="status" aria-live="polite" aria-atomic="true">${text('panels.searchStatus', {current: 0, count: 0})}</output>` +
        `<button class="button" id="nextCaptionMatch" ${attrs('aria-label', 'panels.nextMatch')} disabled>${text('panels.next')}</button>` +
        `</div>` +
        `<label class="panel-label" for="captionReplacement">${text('panels.replacement')}</label>` +
        `<textarea class="panel-input" id="captionReplacement" rows="2" maxlength="2000" autocomplete="off" spellcheck="false"></textarea>` +
        `<button class="button full" id="replaceCaptionMatch" disabled>${text('panels.replaceMatch')}</button>` +
        `<button class="button full" id="replaceAllCaptions" aria-live="polite" disabled>${text('panels.replaceAll')}</button>` +
        `<button class="button full" id="replaceCaptionRange" disabled>${text('replaceRange.title')}</button>` +
        `</section>` +
        `<div class="panel-actions" role="group" ${attrs('aria-label', 'panels.shiftTiming')}>` +
        `<select id="captionShiftBasis" ${attrs('aria-label', 'panels.shiftBasis')}><option value="source" ${mark('panels.sourceTime')}>${esc(t('panels.sourceTime'))}</option><option value="timeline" ${mark('panels.timelineTime')}>${esc(t('panels.timelineTime'))}</option></select>` +
        `<input id="captionShiftDelta" type="number" step="any" value="0" ${attrs('aria-label', 'panels.shiftSeconds')}>` +
        `<button class="button" id="shiftCaptionTiming">${text('panels.shift')}</button></div>` +
        `<button class="button" id="assignSpeakerRange" ${captions.length ? '' : 'disabled'}>${text('panels.assignSpeakerRange')}</button>` +
        `<button class="button" id="shiftCaptionRange" ${captions.length ? '' : 'disabled'}>${text('panels.shiftCaptionRange')}</button>` +
        `<div class="caption-split-tool">` +
        `<select id="captionChunkSize" ${attrs('aria-label', 'panels.chunkLength')}>` +
        `<option value="12" ${mark('panels.chunkShort')}>${esc(t('panels.chunkShort'))}</option>` +
        `<option value="18" selected ${mark('panels.chunkNormal')}>${esc(t('panels.chunkNormal'))}</option>` +
        `<option value="24" ${mark('panels.chunkLong')}>${esc(t('panels.chunkLong'))}</option>` +
        `</select>` +
        `<button class="button compact" id="splitLongCaptions">${text('panels.splitLong')}</button>` +
        `</div>` +
        `<p class="tiny-note">${text('panels.splitNotice')}</p>` +
        `<button class="text-button" id="captionDesignShortcut">${text('panels.captionDesign')}</button>` +
        `\n  <p class="tiny-note">${text('panels.clockNotice')}</p>` +
        `</div>` +
        `\n </details>` +
        `</section>`
    );
}

export function mediaPanelMarkup({ kind, duration, fileName }, thumbnail) {
    return (
        `<section class="asset-workspace" aria-labelledby="mediaPanelHeading">` +
        `<h1 class="panel-heading" id="mediaPanelHeading">${text('panels.media')}</h1>` +
        `<section class="asset-section" ${attrs('aria-label', 'panels.projectVideo')}>` +
        `<button class="asset-card full" id="assetSelect">` +
        `<span class="asset-thumb">` +
        `<img src="${thumbnail || './sample.svg'}" ${attrs('alt', kind === 'demo' ? 'panels.sampleAlt' : 'panels.videoThumbnail')}>` +
        `<span class="duration">${fmt(duration)}</span>` +
        `</span>` +
        `<span class="asset-info">${icon('video')}<span>` +
        `<strong>${esc(fileName)}</strong>` +
        `<small>${kind === 'demo' ? text('panels.sampleDescription') : text('panels.sourceDescription')}</small>` +
        `</span></span></button>` +
        `<button class="sample-link" id="loadDemo">${icon('reset')} ${text('panels.openDemo')}</button>` +
        `</section>` +
        `<section class="asset-section" ${attrs('aria-label', 'panels.importVideo')}>` +
        `<div class="dropzone" id="dropzone">` +
        `<span class="upload-circle">${icon('upload')}</span>` +
        `<strong>${text('panels.dropVideo')}</strong>` +
        `<button class="button dark" id="chooseVideo" aria-describedby="videoFormats">${text('panels.chooseVideo')}</button>` +
        `</div>` +
        `<p class="formats" id="videoFormats">${text('panels.videoFormats')}<br>${text('panels.videoCodecs')}</p>` +
        `</section></section>`
    );
}

export function audioPanelMarkup({ kind, volume, audioName, audioOffset, audioVolume, speed }, hasAudio, timelineDuration) {
    const connection = hasAudio
        ? `<section class="asset-section" ${attrs('aria-label', 'panels.addedAudioSettings')}>${audioConnectionMarkup({ audioName, audioOffset, audioVolume, speed }, timelineDuration)}</section>`
        : '';
    return (
        `<section class="asset-workspace" aria-labelledby="audioPanelHeading">` +
        `<h1 class="panel-heading" id="audioPanelHeading">${text('panels.audio')}</h1>` +
        (kind === 'video' ? `<section class="asset-section" ${attrs('aria-label', 'audioMix.source')}>` +
            `<label class="slider-label" for="audioSourceVolume">${text('audioMix.source')} <output id="audioSourceVolumeOutput">${Math.round(volume * 100)}%</output></label>` +
            `<input id="audioSourceVolume" type="range" min="0" max="1" step="0.01" value="${volume}" style="width:100%" ${attrs('aria-label', 'audioMix.source')}></section>` : '') +
        connection +
        `<section class="asset-section" ${attrs('aria-label', 'panels.importRecordAudio')}>` +
        `<div class="asset-actions">` +
        `<button class="button dark full" id="chooseAudio">${icon('upload')} ${hasAudio ? text('panels.replaceAudio') : text('panels.chooseAudio')}</button>` +
        `<button class="button full" id="recordButton" aria-describedby="recordingNotice">${icon('mic')} ${text('panels.recordMicrophone')}</button>` +
        `</div>` +
        `<p class="notice" id="recordingNotice">${text('panels.recordingNotice')}</p>` +
        `</section></section>`
    );
}

export function settingsPanelMarkup({ ratio, fit, zoom, captionSize, captionY, volume }, clip, loopPreview = false) {
    return (
        `<h1 class="panel-heading">${text('panels.settings')}</h1>` +
        `<div class="settings-mirror">` +
        `<section class="settings-group" ${attrs('aria-label', 'panels.frameComposition')}>` +
        `<div class="section-label">${text('panels.aspectRatio')}</div>` +
        `<div class="ratio-grid" role="group" ${attrs('aria-label', 'panels.aspectRatio')}>${SUPPORTED_ASPECT_RATIOS.map(r => (
            `<button class="ratio-option ${ratio === r ? 'active' : ''}" data-ratio="${r}" aria-pressed="${ratio === r}">` +
            `<i class="ratio-shape ${{'9:16':'portrait','4:5':'feed-portrait','1:1':'square','16:9':'landscape'}[r]}" aria-hidden="true"></i><strong>${r}</strong>` +
            `</button>`
        )).join('')}</div>` +
        `<div class="field-label">${text('panels.frameFit')}</div>` +
        `<div class="segmented">` +
        `<button data-fit="cover" class="${fit === 'cover' ? 'active' : ''}" aria-pressed="${fit === 'cover'}">${text('panels.cover')}</button>` +
        `<button data-fit="contain" class="${fit === 'contain' ? 'active' : ''}" aria-pressed="${fit === 'contain'}">${text('panels.contain')}</button>` +
        `</div>` +
        `<label class="panel-label" for="mobileZoom">${text('panels.zoom')}</label>` +
        `<input id="mobileZoom" type="range" min="1" max="3" step=".01" value="${zoom}" style="width:100%">` +
        `<button class="button" id="keepPanelGaps">${text('panels.keepGaps')}</button>` +
        `<button class="button" id="openPanelFraming">${text('panels.framing')}</button>` +
        `<label class="preview-guide-option"><input id="thirdsGridPanel" type="checkbox" aria-controls="thirdsGuide">${text('guides.thirds')}</label>` +
        `<p class="tiny-note">${text('panels.dragFrame')}</p>` +
        `<div class="panel-actions"><button class="button" id="savePreviewPng">${text('shell.savePreviewPng')}</button><button class="button" id="openScenePng">${text('scenePng.title')}</button></div>` +
        `<button class="button full" id="resetPosition">${icon('reset')} ${text('panels.resetPosition')}</button>` +
        `</section>` +
        `<section class="settings-group" ${attrs('aria-label', 'panels.captionSizePosition')}>` +
        `<label class="panel-label" for="captionSize">${text('panels.captionSize')}</label>` +
        `<input id="captionSize" type="range" min="18" max="52" value="${captionSize}" style="width:100%">` +
        `<label class="panel-label" for="captionY">${text('panels.captionY')}</label>` +
        `<input id="captionY" type="range" min=".15" max=".9" step=".01" value="${captionY}" style="width:100%">` +
        `</section>` +
        `<section class="settings-group" ${attrs('aria-label', 'panels.selectedClipRange')}>` +
        `<div class="section-label">${text('panels.trimClip')}</div>` +
        `<div class="time-fields">` +
        `<div class="trim-draft-field"><div class="trim-field-heading"><label for="panelTrimStart">${text('panels.startSeconds')}</label><button type="button" class="icon-button trim-playhead" id="panelTrimStartPlayhead" ${attrs('aria-label', 'panels.trimStartPlayhead')} ${attrs('title', 'panels.trimStartPlayhead')} data-icon="playhead"></button></div><input id="panelTrimStart" type="number" min="0" step="any" value="${clip.start}"></div>` +
        `<div class="trim-draft-field"><div class="trim-field-heading"><label for="panelTrimEnd">${text('panels.endSeconds')}</label><button type="button" class="icon-button trim-playhead" id="panelTrimEndPlayhead" ${attrs('aria-label', 'panels.trimEndPlayhead')} ${attrs('title', 'panels.trimEndPlayhead')} data-icon="playhead"></button></div><input id="panelTrimEnd" type="number" min="0" step="any" value="${clip.end}"></div>` +
        `</div>` +
        `<button class="button full subtle" id="panelMoveClip">${text('panels.moveClip')}</button>` +
        `<button class="button full subtle" id="panelRemoveClipRange">${text('panels.removeClipRange')}</button>` +
        `<button class="button full" id="panelTrimApply">${text('panels.applyRange')}</button>` +
        `</section>` +
        `<section class="settings-group" ${attrs('aria-label', 'panels.sourceAudio')}>` +
        `<label class="panel-label" for="panelVolume">${text('panels.sourceVolume')}</label>` +
        `<input id="panelVolume" type="range" min="0" max="1" step=".01" value="${volume}" style="width:100%">` +
        `</section><section class="settings-group"><label class="design-check"><input id="loopPreview" type="checkbox" ${loopPreview ? 'checked' : ''}>${text('panels.loopPreview')}</label></section></div>`
    );
}

function captionRowMarkup(c, i, speakerLabels, last) {
    return `<div class="caption-row">` +
        `<small class="caption-clock">${c.basis === 'timeline' ? text('panels.captionTimeline') : text('panels.captionSource')}</small>` +
        `<div class="caption-row-head">` +
        `<input type="number" min="0" step="0.1" value="${c.start.toFixed(1)}" data-caption-start="${i}" ${attrs('aria-label', 'panels.cueStart', {index: i + 1})}>` +
        `<span class="muted">–</span>` +
        `<input type="number" min="0" step="0.1" value="${c.end.toFixed(1)}" data-caption-end="${i}" ${attrs('aria-label', 'panels.cueEnd', {index: i + 1})}>` +
        `</div>` +
        `<textarea data-caption-text="${i}" ${attrs('aria-label', 'panels.cueText', {index: i + 1})}>${esc(c.text)}</textarea>` +
        `<div class="caption-row-actions" role="group" ${attrs('aria-label', 'panels.cueEdit', {index: i + 1})}>` +
        `<button class="text-button" data-view-caption="${i}" ${attrs('aria-label', 'panels.viewCaption', {index: i + 1})}>${text('panels.viewInVideo')}</button>` +
        `<button class="text-button" data-split-caption="${i}" ${attrs('aria-label', 'panels.cueSplit', {index: i + 1})} ${attrs('title', 'panels.splitAtCursor')}>${text('panels.split')}</button>` +
        `<button class="text-button" data-merge-caption="${i}" ${attrs('aria-label', 'panels.cueMerge', {index: i + 1})} ${attrs('title', 'panels.mergeNext')} ${last ? 'disabled' : ''}>${text('panels.merge')}</button>` +
        `<button class="icon-button" data-delete-caption="${i}" ${attrs('aria-label', 'panels.cueDelete', {index: i + 1})}>${icon('trash')}</button>` +
        `</div>` +
        `<div class="caption-extra">` +
        `<input data-caption-keywords="${i}" value="${esc(c.keywords || '')}" maxlength="150" ${attrs('placeholder', 'panels.keywordsPlaceholder')} ${attrs('aria-label', 'panels.cueKeywords', {index: i + 1})}>` +
        `<select data-caption-speaker="${i}" ${attrs('aria-label', 'panels.cueSpeaker', {index: i + 1})}>` +
        `<option value="" ${mark('panels.noSpeaker')}>${esc(t('panels.noSpeaker'))}</option>${speakerLabels.map((name, n) =>
            `<option value="${n}" ${String(c.speaker) === String(n) ? 'selected' : ''}>${esc(name)}</option>`
        ).join('')}</select>` +
        `</div>${c.timing === 'estimated' ? `<small class="estimated-timing">${text('panels.estimatedTiming')}</small>` : ''}</div>`;
}

function audioConnectionMarkup({ audioName, audioOffset, audioVolume, speed }, timelineDuration) {
    return `<div class="audio-file">${icon('audio')} ${esc(audioName)}<div class="panel-actions"><button class="text-button" id="downloadOriginalAudio">${text('panels.downloadOriginalAudio')}</button><button class="text-button" id="removeAudio">${text('panels.disconnect')}</button></div>` +
        `</div>` +
        `<label class="panel-label" for="audioOffset">${text('panels.audioStart')}</label>` +
        `<input class="panel-input" id="audioOffset" type="number" min="0" max="${timelineDuration / speed}" step="0.1" value="${audioOffset / speed}">` +
        `<label class="slider-label" for="audioVolume">${text('panels.addedAudioVolume')} <output id="audioVolumeOutput">${Math.round(audioVolume * 100)}%</output>` +
        `</label>` +
        `<input id="audioVolume" type="range" min="0" max="1" step="0.01" value="${audioVolume}" style="width:100%" ${attrs('aria-label', 'panels.addedAudioVolume')}>`;
}
