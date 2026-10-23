import { captionOccurrences } from './captions.mjs';
import { esc, fmt } from './ui-format.mjs';

const markup = new WeakMap();
export function updateTimelineMarkup(track, html) {
  if (markup.get(track) === html) return;
  track.innerHTML = html;
  markup.set(track, html);
}

export function renderCaptionTrack(track, occurrences, duration, speed) {
  const previous = new Map([...track.children].map(node => [node.dataset.captionKey, node]));
  occurrences.forEach((caption, index) => {
    const key = `${caption.captionIndex}:${caption.clipIndex ?? 'audio'}`;
    const button = previous.get(key) || track.ownerDocument.createElement('button');
    previous.delete(key);
    button.className = 'caption-block';
    button.dataset.captionKey = key;
    button.dataset.captionIndex = String(caption.captionIndex);
    button.dataset.captionTime = String(caption.start);
    button.setAttribute('aria-label', `자막 ${caption.captionIndex + 1}, ${(caption.start / speed).toFixed(1)}초: ${caption.text}`);
    button.textContent = caption.text;
    button.style.left = `${caption.start / duration * 100}%`;
    button.style.width = `${(caption.end - caption.start) / duration * 100}%`;
    // Keep the pointer/keyboard target alive while a field commits on blur.
    if (track.children[index] !== button) track.insertBefore(button, track.children[index] || null);
  });
  for (const button of previous.values()) button.remove();
}

// Replace all occurrence targets on failure; never leave a partial or stale lane.
export function renderCaptionTrackError(track, message) {
  const focused = [...track.children].includes(track.ownerDocument.activeElement);
  for (const node of [...track.children]) node.remove();
  const error = track.ownerDocument.createElement('span');
  error.className = 'caption-track-error';
  error.setAttribute('role', 'status');
  error.textContent = message;
  track.insertBefore(error, null);
  if (focused) {
    track.setAttribute('tabindex', '-1');
    track.focus({preventScroll:true});
  }
}

// The app owns editing and playback; this view only caches and updates DOM presentation.
export function createTimelineView($, clock = () => performance.now()) {
    let lastUiTime = 0, lastTimeLabel = '', collapsed = false;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const ZOOM_LEVELS = [1, 2, 4, 8], LABEL_WIDTH = 73;
    let zoom = 1, lastCurrent = 0, lastLen = 0;
    // Zoom is presentation only: the tracks keep their true percentages while the
    // lane grows past the viewport, so clips and captions regain readable width.
    function setZoom(next) {
        const value = Number(next);
        if (!Number.isFinite(value)) return zoom;
        zoom = clamp(Math.round(value), ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
        $('#timelineBody').style.setProperty('--timeline-zoom', String(zoom));
        const label = $('#timelineZoomLabel');
        if (label) label.textContent = `${zoom}×`;
        const button = $('#timelineZoom');
        if (button) {
            button.setAttribute('aria-label', `타임라인 확대, 현재 ${zoom}배`);
            button.title = `타임라인 확대 (${ZOOM_LEVELS.join('× → ')}×)`;
        }
        return zoom;
    }
    function cycleZoom() {
        return setZoom(ZOOM_LEVELS[(ZOOM_LEVELS.indexOf(zoom) + 1) % ZOOM_LEVELS.length]);
    }
    // Sticky labels cover the first column, so only the remainder is visible track.
    function keepPlayheadVisible() {
        const body = $('#timelineBody'), area = $('#tracksArea');
        if (!body || !area || !lastLen) return;
        const view = body.clientWidth - LABEL_WIDTH;
        if (view <= 0) return;
        const x = lastCurrent / lastLen * area.clientWidth;
        const margin = Math.min(24, view / 3);
        let left = body.scrollLeft || 0;
        if (x < left + margin) left = Math.max(0, x - margin);
        else if (x > left + view - margin) left = Math.max(0, x - view + margin);
        const content = Number.isFinite(body.scrollWidth) && body.scrollWidth > 0 ? body.scrollWidth : area.clientWidth + LABEL_WIDTH;
        body.scrollLeft = Math.min(left, Math.max(0, content - body.clientWidth));
    }
    // Collapsing hands the timeline's height back to the preview. The state lives
    // here so the control, its accessible name and the layout stay in sync.
    function setCollapsed(next) {
        collapsed = !!next;
        $('#timeline').classList.toggle('collapsed', collapsed);
        const toggle = $('#timelineToggle'), label = collapsed ? '타임라인 펼치기' : '타임라인 접기';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
    }
    function renderCaptions(state, len) {
        try {
            renderCaptionTrack($('#captionTrack'), captionOccurrences(state.captions, state.clips), len, state.speed);
        }
        catch (error) {
            if (error.code !== 'CAPTION_OUTPUT_LIMIT')
                throw error;
            renderCaptionTrackError($('#captionTrack'), error.message);
        }
    }

    function renderLayers(state, len) {
        const total = len / state.speed, d = state.design;
        let html = [['title', d.title, '타이틀'], ['credit', d.credit, '크레딧']]
            .filter(([, layer]) => layer.enabled).map(([key, layer, label]) => {
                const start = clamp(layer.start, 0, total);
                const end = clamp(layer.end ?? total, start, total);
                return `<button class="title-track-block ${key}" data-track-layer="${key}" ` +
                    `style="left:${start / total * 100}%;width:${(end - start) / total * 100}%">` +
                    `${label} · ${esc(key === 'title' ? layer.lines.filter(Boolean).join(' / ') : layer.text)}</button>`;
            }).join('');
        html += (state.overlays || []).filter(card => card.start < total).map(card => {
            const left = clamp(card.start / total * 100, 0, 100);
            const width = clamp((Math.min(total, card.end) - card.start) / total * 100, 0, 100);
            return `<button class="title-track-block scene" data-track-card="${esc(card.id)}" ` +
                `style="left:${left}%;width:${width}%">${esc(card.label)} · ${esc(card.text)}</button>`;
        }).join('');
        updateTimelineMarkup($('#titleTrack'), html || '<span class="empty-layer-track">+ 타이틀 · 장면 카드를 추가하세요</span>');
    }

    function render(state, len, { selected, thumbnail, hasAudio }) {
        renderLayers(state, len);
        $('#seek').max = len;
        const background = thumbnail ? `background-image:url('${thumbnail}');background-size:auto 100%;` : '';
        const clips = state.clips.map((clip, index) =>
            `<button class="clip ${index === selected ? 'active' : ''}" data-clip="${index}" ` +
            `style="flex:${clip.end - clip.start};${background}" ` +
            `title="클립 ${index + 1}: ${fmt(clip.start)}–${fmt(clip.end)}">` +
            `<span>${index === 0 ? esc(state.fileName) : '클립 ' + (index + 1)}</span></button>`
        ).join('');
        updateTimelineMarkup($('#videoTrack'), clips);
        renderCaptions(state, len);
        const total = len / state.speed;
        // Aim for a label roughly every 90px; zooming then reveals finer marks.
        const width = $('#tracksArea').clientWidth || 600;
        const target = clamp(Math.round(width / 90), 4, 12);
        const step = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600].find(value => total / value <= target) || 600;
        const marks = [];
        for (let at = 0; at < total - 1e-6; at += step)
            marks.push(at);
        if (total > 0)
            marks.push(total);
        $('#ruler').innerHTML = marks.map(at =>
            `<span style="left:${total > 0 ? at / total * 100 : 0}%">${fmt(at)}</span>`
        ).join('');
        $('#audioTrack').classList.toggle('has-audio', hasAudio);
        $('#audioTrack').textContent = hasAudio ? `♫ ${state.audioName} · ${(state.audioOffset / state.speed).toFixed(1)}초부터` : '+ 오디오를 추가해 보세요';
    }

    function updateTime(state, current, duration, exporting, force = true) {
        const now = clock();
        if (!force && now - lastUiTime < 100)
            return;
        lastUiTime = now;
        const len = duration(), label = `${fmt(current / state.speed)} <span>/ ${fmt(len / state.speed)}</span>`;
        if (label !== lastTimeLabel) {
            $('#timeDisplay').innerHTML = label;
            lastTimeLabel = label;
        }
        $('#seek').value = current;
        lastCurrent = current;
        lastLen = len;
        $('#playhead').style.transform = `translateX(${len ? current / len * $('#tracksArea').clientWidth : 0}px)`;
        if (zoom > 1)
            keepPlayheadVisible();
        if (exporting) {
            const progress = Math.round(current / len * 100), bar = $('#exportProgress'), label = $('#exportPercent');
            if (bar)
                bar.style.width = progress + '%';
            if (label)
                label.textContent = progress + '%';
        }
    }
    return { render, renderLayers, updateTime, setCollapsed, isCollapsed: () => collapsed, setZoom, cycleZoom, getZoom: () => zoom };
}
