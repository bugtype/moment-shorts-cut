import { syncSpeedControl } from './speed-dialog.mjs';
import { decimalTime } from './ui-format.mjs';
import { setText, setAttr } from './i18n.mjs';
import { MAX_CLIPS } from './core/project.mjs';
export function createInspectorView($, $$) {
    let inspectorTrimContext = null;
    function open(section) {
        for (const name of ['frame', 'clip', 'caption'])
            $('#' + name + 'Settings').open = name === section;
    }

    function render(state, selected, canUndo, canRedo) {
        for (const [id, key] of [['mobileZoom', 'zoom'], ['panelVolume', 'volume']]) {
            const control = $('#' + id), value = String(state[key]);
            if (control && control.value !== value)
                control.value = value;
        }
        const c = state.clips[selected] || state.clips[0];
        if (inspectorTrimContext?.clip !== c || inspectorTrimContext.index !== selected
            || inspectorTrimContext.start !== c.start || inspectorTrimContext.end !== c.end) {
            $('#trimStart').value = Number.isInteger(c.start) ? c.start.toFixed(1) : decimalTime(c.start);
            $('#trimEnd').value = Number.isInteger(c.end) ? c.end.toFixed(1) : decimalTime(c.end);
            inspectorTrimContext = { clip: c, index: selected, start: c.start, end: c.end };
        }
        $('#projectName').value = state.name;
        $('#ratioLabel').textContent = state.ratio;
        setAttr($('#ratioShortcut'), 'aria-label', 'panels.ratioCurrent', {ratio:state.ratio});
        $('#previewSize').textContent = state.ratio === '9:16' ? '1080 × 1920' : state.ratio === '1:1' ? '1080 × 1080' : '1920 × 1080';
        for (const key of ['ratio', 'fit']) {
            $$(`[data-${key}]`).forEach(button => {
                const active = button.dataset[key] === state[key];
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', active);
            });
        }
        $$('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === state.style));
        $('#zoom').value = state.zoom;
        $('#zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
        $('#volume').value = state.volume;
        $('#volumeValue').textContent = `${Math.round(state.volume * 100)}%`;
        syncSpeedControl($('#speed'), $('#currentSpeedOption'), state.speed);
        setText($('#clipIndex'), 'panels.clipIndex', {index:selected + 1});
        $('#undoButton').disabled = !canUndo;
        $('#redoButton').disabled = !canRedo;
        $('#duplicateClipButton').disabled = state.clips.length >= MAX_CLIPS;
        $('#deleteButton').disabled = state.clips.length <= 1;
        $('#moveLeft').disabled = selected <= 0;
        $('#moveRight').disabled = selected >= state.clips.length - 1;
        $('#sampleBadge').hidden = state.kind !== 'demo';
    }

    return {
        open, render,
        hasTrimTarget: clip => inspectorTrimContext?.clip === clip,
        retargetTrim: clip => { inspectorTrimContext.clip = clip; },
    };
}
