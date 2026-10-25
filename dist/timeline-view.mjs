import {text, attrs, setText, setAttr, formatError} from './i18n.mjs';
import { captionOccurrences } from './captions.mjs';
import { esc, fmt } from './ui-format.mjs';

// Cut navigation uses edited seconds before speed, independent of source order.
// Null means there is no strictly earlier/later boundary: do not interrupt playback.
export function adjacentCut(clips, current, direction) {
  if (!Number.isFinite(current) || ![-1, 1].includes(direction)) return null;
  const boundaries = [0];
  for (const clip of clips) {
    const length = clip.end - clip.start;
    if (!Number.isFinite(length) || length <= 0) return null;
    boundaries.push(boundaries.at(-1) + length);
  }
  const candidates = direction < 0 ? boundaries.reverse() : boundaries;
  return candidates.find(boundary => {
    const tolerance = Number.EPSILON * Math.max(Math.abs(current), Math.abs(boundary)) * 8;
    return direction * (boundary - current) > tolerance;
  }) ?? null;
}

const markup = new WeakMap();
export function updateTimelineMarkup(track, html) {
  if (markup.get(track) === html) return;
  track.innerHTML = html;
  markup.set(track, html);
}

function updateLayerTrack(track, html, blocks) {
  if (markup.get(track) === html) return;
  // Keep both the button and its localized prefix alive across a field commit.
  // Structural changes, nonfinite geometry and unusual text keep the HTML path.
  const sameShape = blocks.length > 0 && track.childElementCount === blocks.length &&
    track.childNodes.length === blocks.length && blocks.every(block =>
      Number.isFinite(block.left) && Number.isFinite(block.width) && !/[\r\0]/.test(block.content));
  const buttons = sameShape ? [...track.children] : [];
  const reusable = sameShape && blocks.every((block, index) => {
    const button = buttons[index], key = block.layer ? 'trackLayer' : 'trackCard';
    if (button.tagName !== 'BUTTON' || button.dataset[key] !== (block.layer || block.id) ||
        Object.hasOwn(button.dataset, block.layer ? 'trackCard' : 'trackLayer') ||
        button.childNodes.length !== (block.layer ? 2 : 1) || button.lastChild.nodeType !== 3) return false;
    if (!block.layer) return true;
    const prefix = button.firstChild;
    return prefix.tagName === 'SPAN' && prefix.getAttribute('data-i18n') === block.label &&
      prefix.getAttribute('data-i18n-params') === '{}' && prefix.childNodes.length === 1 &&
      prefix.firstChild.nodeType === 3;
  });
  if (!reusable) {
    updateTimelineMarkup(track, html);
    return;
  }
  blocks.forEach((block, index) => {
    const button = buttons[index];
    button.style.left = `${block.left}%`;
    button.style.width = `${block.width}%`;
    if (block.layer) setText(button.firstChild, block.label);
    button.lastChild.data = (block.layer ? ' · ' : '') + block.content;
  });
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
    setAttr(button, 'aria-label', 'shell.captionA11y', {index: caption.captionIndex + 1, seconds: (caption.start / speed).toFixed(1), caption: caption.text});
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
  if (message?.messageKey) setText(error, message.messageKey, message.messageParams);
  else error.textContent = formatError(message);
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
            setAttr(button, 'aria-label', 'shell.zoomTimelineA11y', {zoom});
            setAttr(button, 'title', 'shell.zoomTimeline', {levels: ZOOM_LEVELS.join('× → ') + '×'});
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
        const toggle = $('#timelineToggle'), label = collapsed ? 'shell.expandTimeline' : 'shell.collapseTimeline';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        setAttr(toggle, 'aria-label', label);
        setAttr(toggle, 'title', label);
    }
    function renderCaptions(state, len) {
        try {
            renderCaptionTrack($('#captionTrack'), captionOccurrences(state.captions, state.clips), len, state.speed);
        }
        catch (error) {
            if (error.code !== 'CAPTION_OUTPUT_LIMIT')
                throw error;
            renderCaptionTrackError($('#captionTrack'), error);
        }
    }

    function renderLayers(state, len) {
        const total = len / state.speed, d = state.design;
        const blocks = [];
        let html = [['title', d.title, 'shell.title'], ['credit', d.credit, 'shell.credit']]
            .filter(([, layer]) => layer.enabled).map(([key, layer, label]) => {
                const start = clamp(layer.start, 0, total);
                const end = clamp(layer.end ?? total, start, total);
                const left = start / total * 100, width = (end - start) / total * 100;
                const content = key === 'title' ? layer.lines.filter(Boolean).join(' / ') : layer.text;
                blocks.push({layer: key, label, content, left, width});
                return `<button class="title-track-block ${key}" data-track-layer="${key}" ` +
                    `style="left:${left}%;width:${width}%">` +
                    `${text(label)} · ${esc(content)}</button>`;
            }).join('');
        html += (state.overlays || []).filter(card => card.start < total).map(card => {
            const left = clamp(card.start / total * 100, 0, 100);
            const width = clamp((Math.min(total, card.end) - card.start) / total * 100, 0, 100);
            const content = `${card.label} · ${card.text}`;
            blocks.push({id: card.id, content, left, width});
            return `<button class="title-track-block scene" data-track-card="${esc(card.id)}" ` +
                `style="left:${left}%;width:${width}%">${esc(card.label)} · ${esc(card.text)}</button>`;
        }).join('');
        updateLayerTrack($('#titleTrack'), html || `<span class="empty-layer-track">${text('shell.addLayers')}</span>`, blocks);
    }

    function render(state, len, { selected, thumbnail, hasAudio }) {
        renderLayers(state, len);
        $('#seek').max = len;
        const background = thumbnail ? `background-image:url('${thumbnail}');background-size:auto 100%;` : '';
        const clips = state.clips.map((clip, index) =>
            `<button class="clip" data-clip="${index}" ` +
            `style="flex:${clip.end - clip.start};${background}" ` +
            `${attrs("title", "shell.clipRange", {index: index + 1, start: fmt(clip.start), end: fmt(clip.end)})}>` +
            `<span>${index === 0 ? esc(state.fileName) : text('shell.clip', {index: index + 1})}</span></button>`
        ).join('');
        const videoTrack = $('#videoTrack');
        updateTimelineMarkup(videoTrack, clips);
        // Selection alone must not replace the button receiving native activation.
        for (const button of videoTrack.querySelectorAll('[data-clip]'))
            button.classList.toggle('active', +button.dataset.clip === selected);
        renderCaptions(state, len);
        const total = len / state.speed;
        // Aim for a label roughly every 90px; zooming then reveals finer marks,
        // including sub-second steps once a whole second becomes too coarse.
        const width = $('#tracksArea').clientWidth || 600;
        const target = clamp(Math.round(width / 90), 4, 12);
        let step = [.1, .2, .5, 1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600].find(value => total / value <= target);
        if (!step) {
            // Long/repeated clips still need only a viewport-sized set of labels.
            // Extend the ladder in whole-minute 1/2/5 decades, never one mark per 600s.
            const minutes = total / target / 60;
            const magnitude = 10 ** Math.floor(Math.log10(minutes));
            step = [1, 2, 5, 10].find(factor => factor * magnitude >= minutes) * magnitude * 60;
        }
        const decimals = (String(step).split('.')[1] || '').length;
        const rulerLabel = at => {
            if (!decimals) return fmt(at);
            const frac = at.toFixed(decimals).split('.')[1].replace(/0+$/, '');
            return frac ? `${fmt(Math.floor(at + 1e-9))}.${frac}` : fmt(at);
        };
        const marks = [];
        const count = Math.floor(total / step + 1e-9);
        for (let i = 0; i < count; i++)
            marks.push(i * step);
        // Only a round multiple earns the closing label; a floored label at the
        // right edge would claim a time the project does not actually end on.
        if (total > 0 && Math.abs(total - count * step) < 1e-6)
            marks.push(count * step);
        if (!marks.length)
            marks.push(0);
        // Minor ticks subdivide each label by a whole-number factor so they mark
        // real times instead of an arbitrary grid, and thin out when space is tight.
        const spacing = total > 0 ? width * step / total : 0;
        const subdivisions = [10, 5, 4, 2].find(n => spacing / n >= 24) || 1;
        $('#ruler').style.setProperty('--ruler-tick', `${total > 0 ? step / subdivisions / total * 100 : 100}%`);
        $('#ruler').innerHTML = marks.map(at =>
            `<span style="left:${total > 0 ? Number((at / total * 100).toFixed(4)) : 0}%">${rulerLabel(at)}</span>`
        ).join('');
        $('#audioTrack').classList.toggle('has-audio', hasAudio);
        setText($('#audioTrack'), hasAudio ? 'shell.audioFrom' : 'shell.addAudio', {name: state.audioName, seconds: (state.audioOffset / state.speed).toFixed(1)});
    }

    function updateTime(state, current, duration, exporting, force = true) {
        const now = clock();
        if (!force && now - lastUiTime < 100)
            return;
        lastUiTime = now;
        const len = duration(), label = `${fmt(current / state.speed)} <span>/ ${fmt(len / state.speed)}</span>`;
        if (label !== lastTimeLabel) {
            $('#timeDisplay').innerHTML = label;
            setAttr($('#timeDisplay'), 'aria-label', 'shell.seekA11y', {current: fmt(current / state.speed), total: fmt(len / state.speed)});
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
    return { render, renderLayers, updateTime, setCollapsed, isCollapsed: () => collapsed, setZoom, cycleZoom, getZoom: () => zoom, zoomLevels: () => [...ZOOM_LEVELS] };
}
