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
        $('#undoButton').disabled = !canUndo;
        $('#redoButton').disabled = !canRedo;
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
