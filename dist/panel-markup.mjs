import { icon, esc, fmt } from './ui-format.mjs';

// Pure markup: the app retains current state, event bindings and edit history.
export const CAPTION_PAGE_SIZE = 50;
export function captionsPanelMarkup({ captions, speakerLabels }, { toolsOpen, transcribing, hasAudio, transcriptionStatus, page = 0 }) {
    const start = Math.max(0, Math.min(Math.floor(page), Math.ceil(captions.length / CAPTION_PAGE_SIZE) - 1)) * CAPTION_PAGE_SIZE;
    const end = Math.min(captions.length, start + CAPTION_PAGE_SIZE);
    const rows = captions.slice(start, end).map((c, i) => captionRowMarkup(c, start + i, speakerLabels)).join('');
    return (
        `<section class="caption-workspace">` +
        `\n <h1 class="panel-heading">자막 ${captions.length}개</h1>` +
        `\n <div class="panel-actions">` +
        `<button class="button" id="addCaption">+ 직접 추가</button>` +
        `<button class="button" id="downloadSrt">SRT 저장</button>` +
        `<button class="button" id="downloadVtt">VTT 저장</button>` +
        `</div>` +
        `\n <div id="captionRows" role="region" aria-label="자막 목록" tabindex="0">${rows || '<p class="empty-text">자동으로 만들거나<br>첫 자막을 직접 추가해 보세요.</p>'}</div>` +
        `<nav class="panel-actions caption-pages" aria-label="자막 페이지" ${captions.length <= CAPTION_PAGE_SIZE ? 'hidden' : ''}>` +
        `<button class="button" id="previousCaptionPage" aria-label="이전 자막 페이지" ${start === 0 ? 'disabled' : ''}>이전</button>` +
        `<span role="status" aria-live="polite">${captions.length ? start + 1 : 0}–${end} / ${captions.length}</span>` +
        `<button class="button" id="nextCaptionPage" aria-label="다음 자막 페이지" ${end >= captions.length ? 'disabled' : ''}>다음</button></nav>` +
        `\n <details class="caption-disclosure" id="captionCreate" ${!captions.length || transcribing ? 'open' : ''}>` +
        `\n  <summary>자동 생성 · 불러오기<span data-icon="chevron">` +
        `</span>` +
        `</summary>` +
        `\n  <div class="caption-disclosure-body">` +
        `<button class="button full" id="importSrt">SRT 불러오기</button>` +
        `\n  <label class="panel-label" for="captionSource">인식할 오디오</label>` +
        `<select class="panel-select" id="captionSource">` +
        `<option value="video">원본 영상의 음성</option>` +
        `<option value="audio" ${hasAudio ? '' : 'disabled'}>추가한 오디오 / 녹음</option>` +
        `</select>` +
        `<label class="panel-label" for="language">음성 언어</label>` +
        `<select class="panel-select" id="language">` +
        `<option value="korean">한국어</option>` +
        `<option value="english">English</option>` +
        `<option value="japanese">日本語</option>` +
        `<option value="chinese">中文</option>` +
        `</select>` +
        `<button class="button dark full" id="generateCaptions">${transcribing ? '<span class="spinner"></span> 인식 중 · 취소' : icon('sparkle') + ' 자동 자막 생성'}</button>` +
        `<div class="notice">첫 실행 시 음성 인식 모델을 다운로드합니다. 인터넷 연결이 필요하며, 음성 인식은 기기에서 처리됩니다. 최대 3분의 원본을 지원합니다.</div>` +
        `\n  <p id="asrStatus" role="status" aria-live="polite" ${transcribing ? '' : 'hidden'}>${esc(transcriptionStatus)}</p>` +
        `</div>` +
        `\n </details>` +
        `\n <details class="caption-disclosure" id="captionTools" ${toolsOpen ? 'open' : ''}>` +
        `\n  <summary>자막 도구<span data-icon="chevron">` +
        `</span>` +
        `</summary>` +
        `\n  <div class="caption-disclosure-body">` +
        `<section aria-label="자막 찾기 및 바꾸기">` +
        `<label class="panel-label" for="captionFind">찾을 내용</label>` +
        `<input class="panel-input" id="captionFind" type="text" maxlength="2000" autocomplete="off" spellcheck="false">` +
        `<div class="panel-actions" role="group" aria-label="검색된 자막 이동">` +
        `<button class="button" id="previousCaptionMatch" aria-label="이전 검색 자막" disabled>이전</button>` +
        `<output id="captionSearchStatus" role="status" aria-live="polite" aria-atomic="true">자막 0 / 0</output>` +
        `<button class="button" id="nextCaptionMatch" aria-label="다음 검색 자막" disabled>다음</button>` +
        `</div>` +
        `<label class="panel-label" for="captionReplacement">바꿀 내용</label>` +
        `<input class="panel-input" id="captionReplacement" type="text" maxlength="2000" autocomplete="off" spellcheck="false">` +
        `<button class="button full" id="replaceAllCaptions" aria-live="polite" disabled>모두 바꾸기</button>` +
        `</section>` +
        `<div class="caption-split-tool">` +
        `<select id="captionChunkSize" aria-label="자막 분할 길이">` +
        `<option value="12">짧게 · 12자</option>` +
        `<option value="18" selected>보통 · 18자</option>` +
        `<option value="24">길게 · 24자</option>` +
        `</select>` +
        `<button class="button compact" id="splitLongCaptions">긴 자막 나누기</button>` +
        `</div>` +
        `<p class="tiny-note">분할 시간은 글자 수로 추정합니다. 음성을 듣고 조절해 주세요.</p>` +
        `<button class="text-button" id="captionDesignShortcut">강조어 · 화자 색상 설정 →</button>` +
        `\n  <p class="tiny-note">원본 음성은 원본 시간, 추가 오디오는 편집 타임라인 시간 기준입니다. 모두 배속 적용 전 초 단위입니다.</p>` +
        `</div>` +
        `\n </details>` +
        `</section>`
    );
}

export function mediaPanelMarkup({ kind, duration, fileName }, thumbnail) {
    return (
        `<section class="asset-workspace" aria-labelledby="mediaPanelHeading">` +
        `<h1 class="panel-heading" id="mediaPanelHeading">미디어</h1>` +
        `<section class="asset-section" aria-label="프로젝트 영상">` +
        `<button class="asset-card full" id="assetSelect">` +
        `<span class="asset-thumb">` +
        `<img src="${thumbnail || './sample.svg'}" alt="${kind === 'demo' ? '바닷가 산책 샘플 일러스트' : '업로드한 영상 썸네일'}">` +
        `<span class="duration">${fmt(duration)}</span>` +
        `</span>` +
        `<span class="asset-info">${icon('video')}<span>` +
        `<strong>${esc(fileName)}</strong>` +
        `<small>${kind === 'demo' ? '모션 그래픽 · 샘플 자막 포함' : '내 기기 · 원본 영상'}</small>` +
        `</span></span></button>` +
        `<button class="sample-link" id="loadDemo">${icon('reset')} 샘플 프로젝트 열기</button>` +
        `</section>` +
        `<section class="asset-section" aria-label="영상 불러오기">` +
        `<div class="dropzone" id="dropzone">` +
        `<span class="upload-circle">${icon('upload')}</span>` +
        `<strong>영상을 여기에 놓아주세요</strong>` +
        `<button class="button dark" id="chooseVideo" aria-describedby="videoFormats">영상 선택</button>` +
        `</div>` +
        `<p class="formats" id="videoFormats">MP4, MOV, WebM · 최대 500 MB<br>브라우저에서 재생 가능한 코덱 지원</p>` +
        `</section></section>`
    );
}

export function audioPanelMarkup({ audioName, audioOffset, audioVolume, speed }, hasAudio, timelineDuration) {
    const connection = hasAudio
        ? `<section class="asset-section" aria-label="추가 오디오 설정">${audioConnectionMarkup({ audioName, audioOffset, audioVolume, speed }, timelineDuration)}</section>`
        : '';
    return (
        `<section class="asset-workspace" aria-labelledby="audioPanelHeading">` +
        `<h1 class="panel-heading" id="audioPanelHeading">오디오</h1>` +
        connection +
        `<section class="asset-section" aria-label="오디오 불러오기 및 녹음">` +
        `<div class="asset-actions">` +
        `<button class="button dark full" id="chooseAudio">${icon('upload')} ${hasAudio ? '오디오 교체' : '오디오 선택'}</button>` +
        `<button class="button full" id="recordButton" aria-describedby="recordingNotice">${icon('mic')} 마이크로 직접 녹음</button>` +
        `</div>` +
        `<p class="notice" id="recordingNotice">녹음에는 마이크 권한이 필요합니다. 녹음 및 업로드한 소리는 원본 음성과 함께 내보내기에 포함됩니다.</p>` +
        `</section></section>`
    );
}

export function settingsPanelMarkup({ ratio, fit, zoom, captionSize, captionY, volume }, clip) {
    return (
        `<h1 class="panel-heading">편집 설정</h1>` +
        `<div class="settings-mirror">` +
        `<section class="settings-group" aria-label="화면 비율과 구도">` +
        `<div class="section-label">화면 비율</div>` +
        `<div class="ratio-grid">${['9:16', '1:1', '16:9'].map(r => (
            `<button class="ratio-option ${ratio === r ? 'active' : ''}" data-ratio="${r}" aria-pressed="${ratio === r}">` +
            `<strong>${r}</strong>` +
            `<small>${r === '9:16' ? '쇼츠' : r === '1:1' ? '피드' : '가로'}</small>` +
            `</button>`
        )).join('')}</div>` +
        `<div class="field-label">화면 채우기</div>` +
        `<div class="segmented">` +
        `<button data-fit="cover" class="${fit === 'cover' ? 'active' : ''}" aria-pressed="${fit === 'cover'}">채우기</button>` +
        `<button data-fit="contain" class="${fit === 'contain' ? 'active' : ''}" aria-pressed="${fit === 'contain'}">전체 보기</button>` +
        `</div>` +
        `<label class="panel-label" for="mobileZoom">확대</label>` +
        `<input id="mobileZoom" type="range" min="1" max="3" step=".01" value="${zoom}" style="width:100%">` +
        `<p class="tiny-note">미리보기를 드래그해 위치를 조절하세요.</p>` +
        `<button class="button full" id="resetPosition">${icon('reset')} 화면 위치 초기화</button>` +
        `</section>` +
        `<section class="settings-group" aria-label="자막 크기와 위치">` +
        `<label class="panel-label" for="captionSize">자막 크기</label>` +
        `<input id="captionSize" type="range" min="18" max="52" value="${captionSize}" style="width:100%">` +
        `<label class="panel-label" for="captionY">자막 세로 위치</label>` +
        `<input id="captionY" type="range" min=".15" max=".9" step=".01" value="${captionY}" style="width:100%">` +
        `</section>` +
        `<section class="settings-group" aria-label="선택 클립 구간">` +
        `<div class="section-label">선택 클립 자르기</div>` +
        `<div class="time-fields">` +
        `<label>시작 (초)<input id="panelTrimStart" type="number" min="0" step=".1" value="${clip.start}">` +
        `</label>` +
        `<label>끝 (초)<input id="panelTrimEnd" type="number" min="0" step=".1" value="${clip.end}">` +
        `</label>` +
        `</div>` +
        `<button class="button full" id="panelTrimApply">구간 적용</button>` +
        `</section>` +
        `<section class="settings-group" aria-label="원본 오디오">` +
        `<label class="panel-label" for="panelVolume">원본 볼륨</label>` +
        `<input id="panelVolume" type="range" min="0" max="1" step=".01" value="${volume}" style="width:100%">` +
        `</section></div>`
    );
}

function captionRowMarkup(c, i, speakerLabels) {
    return `<div class="caption-row">` +
        `<small class="caption-clock">${c.basis === 'timeline' ? '추가 오디오 · 편집 타임라인' : '원본 영상 시간'}</small>` +
        `<div class="caption-row-head">` +
        `<input type="number" min="0" step="0.1" value="${c.start.toFixed(1)}" data-caption-start="${i}" aria-label="자막 ${i + 1} 시작 초">` +
        `<span class="muted">–</span>` +
        `<input type="number" min="0" step="0.1" value="${c.end.toFixed(1)}" data-caption-end="${i}" aria-label="자막 ${i + 1} 끝 초">` +
        `<button class="icon-button" data-delete-caption="${i}" aria-label="자막 ${i + 1} 삭제">${icon('trash')}</button>` +
        `</div>` +
        `<textarea data-caption-text="${i}" aria-label="자막 ${i + 1} 내용">${esc(c.text)}</textarea>` +
        `<div class="caption-extra">` +
        `<input data-caption-keywords="${i}" value="${esc(c.keywords || '')}" maxlength="150" placeholder="강조 단어, 쉼표로 구분" aria-label="자막 ${i + 1} 강조 단어">` +
        `<select data-caption-speaker="${i}" aria-label="자막 ${i + 1} 화자">` +
        `<option value="">화자 없음</option>${speakerLabels.map((name, n) =>
            `<option value="${n}" ${String(c.speaker) === String(n) ? 'selected' : ''}>${esc(name)}</option>`
        ).join('')}</select>` +
        `</div>${c.timing === 'estimated' ? '<small class="estimated-timing">시간 추정 · 음성과 확인 필요</small>' : ''}</div>`;
}

function audioConnectionMarkup({ audioName, audioOffset, audioVolume, speed }, timelineDuration) {
    return `<div class="audio-file">${icon('audio')} ${esc(audioName)}<button class="text-button" id="removeAudio">연결 해제</button>` +
        `</div>` +
        `<label class="panel-label" for="audioOffset">시작 위치 (출력 영상 기준 초)</label>` +
        `<input class="panel-input" id="audioOffset" type="number" min="0" max="${timelineDuration / speed}" step="0.1" value="${audioOffset / speed}">` +
        `<label class="slider-label">오디오 볼륨 <output id="audioVolumeOutput">${Math.round(audioVolume * 100)}%</output>` +
        `</label>` +
        `<input id="audioVolume" type="range" min="0" max="1" step="0.01" value="${audioVolume}" style="width:100%" aria-label="추가 오디오 볼륨">`;
}
