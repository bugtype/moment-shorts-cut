const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Called with the editor's lifetime bindings; each canvas owns one drag transaction.
export function bindPreviewDrag(canvas, { getProject, blocked, pause, selection, snapshot, preview, commit }) {
    let drag = null;
    canvas.onpointerdown = e => {
        if (blocked() || drag)
            return;
        pause();
        const { scene, mode } = selection(), state = getProject();
        const l = scene || (mode === 'caption' ? { x: state.captionX, y: state.captionY } : state.design[mode]);
        if (mode !== 'video' && l?.enabled === false)
            return;
        drag = {
            pointerId: e.pointerId,
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
        if (!drag || e.pointerId !== drag.pointerId)
            return;
        const state = getProject();
        if (drag.project !== state) {
            drag = null;
            return;
        }
        const r = canvas.getBoundingClientRect();
        const x = drag.px + (e.clientX - drag.x) / r.width;
        const y = drag.py + (e.clientY - drag.y) / r.height;
        const mode = drag.mode;
        const target = mode === 'video' || mode === 'caption' ? state
            : mode === 'scene' ? state.overlays.find(c => c.id === drag.sceneId)
            : state.design[mode];
        if (!target)
            return;
        const xKey = mode === 'video' ? 'panX' : mode === 'caption' ? 'captionX' : 'x';
        const yKey = mode === 'video' ? 'panY' : mode === 'caption' ? 'captionY' : 'y';
        const nextX = clamp(x, mode === 'video' ? -1 : .1, mode === 'video' ? 1 : .9);
        const nextY = mode === 'video' ? clamp(y, -1, 1)
            : mode === 'scene' ? clamp(y, .08, .8)
            : mode === 'caption' ? clamp(y, .1, .9) : clamp(y, .06, .93);
        if (target[xKey] === nextX && target[yKey] === nextY)
            return;
        if (!drag.changed) {
            snapshot();
            drag.changed = true;
        }
        target[xKey] = nextX;
        target[yKey] = nextY;
        preview();
    };
    const endDrag = e => {
        if (!drag || e.pointerId !== drag.pointerId)
            return;
        const edited = drag.changed && drag.project === getProject();
        drag = null;
        if (!edited)
            return;
        commit();
    };
    canvas.onpointerup = endDrag;
    canvas.onpointercancel = endDrag;
    canvas.onlostpointercapture = endDrag;
}

export function bindEditorKeyboard(document, { blocked, togglePlayback, undo, seekBy }) {
    document.addEventListener('keydown', e => {
        if (/INPUT|TEXTAREA|SELECT|SUMMARY/.test(e.target.tagName) || blocked())
            return;
        if (e.code === 'Space') {
            if (e.target.tagName === 'BUTTON')
                return;
            e.preventDefault();
            togglePlayback();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo(e.shiftKey);
        }
        if (e.key === 'ArrowLeft') {
            seekBy(-1);
        }
        if (e.key === 'ArrowRight') {
            seekBy(1);
        }
    });
}
