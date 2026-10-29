import { outputDimensions } from './core/aspect-ratio.mjs';
import { syncSpeedControl } from './speed-dialog.mjs';
import { decimalTime } from './ui-format.mjs';
import { setText, setAttr } from './i18n.mjs';
import { MAX_CLIPS } from './core/project.mjs';
export function createInspectorView($, $$) {
    let inspectorTrimContext = null;
    let inspectorNameContext = null;
    let composingName = null;
    function open(section) {
        for (const name of ['frame', 'clip', 'caption'])
            $('#' + name + 'Settings').open = name === section;
    }

    function render(state, selected, canUndo, canRedo) {
        for (const [id, key] of [['mobileZoom', 'zoom'], ['panelVolume', 'volume'], ['audioSourceVolume', 'volume'], ['audioVolume', 'audioVolume']]) {
            const control = $('#' + id), value = String(state[key]);
            if (control && control.value !== value)
                control.value = value;
        }
        for (const [id, key] of [['audioSourceVolumeOutput', 'volume'], ['audioVolumeOutput', 'audioVolume']]) {
            const output = $('#' + id);
            if (output) output.textContent = `${Math.round(state[key] * 100)}%`;
        }
        const c = state.clips[selected] || state.clips[0];
        if (inspectorTrimContext?.clip !== c || inspectorTrimContext.index !== selected
            || inspectorTrimContext.start !== c.start || inspectorTrimContext.end !== c.end) {
            $('#trimStart').value = Number.isInteger(c.start) ? c.start.toFixed(1) : decimalTime(c.start);
            $('#trimEnd').value = Number.isInteger(c.end) ? c.end.toFixed(1) : decimalTime(c.end);
            inspectorTrimContext = { clip: c, index: selected, start: c.start, end: c.end };
        }
        const nameInput = $('#projectName');
        // A status refresh does not own the header's uncommitted name draft.
        if (inspectorNameContext?.project !== state || inspectorNameContext.name !== state.name || inspectorNameContext.input !== nameInput) {
            composingName = null;
            if (nameInput.value !== state.name) nameInput.value = state.name;
            inspectorNameContext = {project:state, name:state.name, input:nameInput, displayed:nameInput.value};
        }
        $('#ratioLabel').textContent = state.ratio;
        setAttr($('#ratioShortcut'), 'aria-label', 'panels.ratioCurrent', {ratio:state.ratio});
        const output = outputDimensions(state.ratio, 1080);
        $('#previewSize').textContent = `${output.width} × ${output.height}`;
        for (const key of ['ratio', 'fit', 'style']) {
            $$(`[data-${key}]`).forEach(button => {
                const active = button.dataset[key] === state[key];
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', active);
            });
        }
        $('#zoom').value = state.zoom;
        $('#zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
        $('#volume').value = state.volume;
        $('#volumeValue').textContent = `${Math.round(state.volume * 100)}%`;
        syncSpeedControl($('#speed'), $('#currentSpeedOption'), state.speed);
        setText($('#clipIndex'), 'panels.clipIndex', {index:selected + 1});
        $('#undoButton').disabled = !canUndo;
        $('#redoButton').disabled = !canRedo;
        $('#duplicateClipButton').disabled = state.clips.length >= MAX_CLIPS;
        $('#removeClipRangeButton').disabled = state.clips.length <= 1;
        $('#deleteButton').disabled = state.clips.length <= 1;
        $('#moveLeft').disabled = selected <= 0;
        $('#moveRight').disabled = selected >= state.clips.length - 1;
        $('#sampleBadge').hidden = state.kind !== 'demo';
    }

    return {
        open, render,
        hasTrimTarget: clip => inspectorTrimContext?.clip === clip,
        retargetTrim: clip => { inspectorTrimContext.clip = clip; },
        setNameComposing(input, composing) {
            if (input !== $('#projectName') || inspectorNameContext?.input !== input) return;
            if (composing) composingName = input;
            else if (composingName === input) composingName = null;
        },
        hasPendingName(state) {
            const context = inspectorNameContext;
            return !!(context?.project === state && context.name === state.name && context.input === $('#projectName') &&
                (composingName === context.input || context.input.value !== context.displayed));
        },
    };
}
