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
            axis: e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey ? 'pending' : null,
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
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (drag.axis === 'pending') {
            if (dx === 0 && dy === 0) return;
            // Choose the physical direction once; aspect ratio must not bias it.
            drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        }
        const x = drag.px + dx / r.width;
        const y = drag.py + dy / r.height;
        const mode = drag.mode;
        const target = mode === 'video' || mode === 'caption' ? state
            : mode === 'scene' ? state.overlays.find(c => c.id === drag.sceneId)
            : state.design[mode];
        if (!target)
            return;
        const xKey = mode === 'video' ? 'panX' : mode === 'caption' ? 'captionX' : 'x';
        const yKey = mode === 'video' ? 'panY' : mode === 'caption' ? 'captionY' : 'y';
        const nextX = drag.axis === 'y' ? drag.px : clamp(x, mode === 'video' ? -1 : .1, mode === 'video' ? 1 : .9);
        const nextY = drag.axis === 'x' ? drag.py : mode === 'video' ? clamp(y, -1, 1)
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

export function bindEditorKeyboard(document, { blocked, togglePlayback, undo, seekBy, stepOutput, navigateCut, stepBlocked = () => false }) {
    document.addEventListener('keydown', e => {
        const target = e.target;
        // Native editing and composition own their keys before any editor shortcut.
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229 ||
            /INPUT|TEXTAREA|SELECT|SUMMARY/.test(target?.tagName) || target?.isContentEditable ||
            target?.closest?.('input, textarea, select, summary, [contenteditable]:not([contenteditable="false"])')) return;
        const modified = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
        if (e.key === '[' || e.key === ']') {
            if (modified || blocked() || stepBlocked()) return;
            if (navigateCut?.(e.key === '[' ? -1 : 1)) e.preventDefault();
            return;
        }
        if (e.key === ',' || e.key === '.') {
            if (modified || blocked() || stepBlocked()) return;
            if (stepOutput) {
                e.preventDefault();
                stepOutput(e.key === ',' ? -1 : 1);
            }
            return;
        }
        if (blocked())
            return;
        if (e.code === 'Space') {
            if (modified || target?.tagName === 'BUTTON')
                return;
            e.preventDefault();
            togglePlayback();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo(e.shiftKey);
        }
        // Tabs own horizontal navigation, including events their IME/modifier guards ignore.
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
            (e.target?.getAttribute?.('role') === 'tab' || e.target?.closest?.('[role="tab"]'))) return;
        if (e.key === 'ArrowLeft' && !modified) {
            seekBy(-1);
        }
        if (e.key === 'ArrowRight' && !modified) {
            seekBy(1);
        }
    });
}

// Pinching the tracks changes zoom around the fingers' midpoint, so the time
// under them stays put while the lane grows or shrinks.
export function bindTimelinePinch(timelineBody, { zoomLevels, getTracksRect, getZoom, setZoom, render }) {
    const touchDistance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    let pinch = null;
    timelineBody.addEventListener('touchstart', event => {
        if (event.touches.length !== 2) {
            pinch = null;
            return;
        }
        const area = getTracksRect();
        const mid = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        pinch = {
            distance: touchDistance(event.touches),
            zoom: getZoom(),
            at: area.width > 0 ? Math.max(0, Math.min(1, (mid - area.left) / area.width)) : 0,
        };
    }, { passive: true });
    timelineBody.addEventListener('touchmove', event => {
        if (!pinch || event.touches.length !== 2)
            return;
        event.preventDefault();
        const scale = touchDistance(event.touches) / Math.max(1, pinch.distance);
        const start = zoomLevels.indexOf(pinch.zoom);
        const next = zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, start + Math.round(Math.log2(scale))))];
        if (next === getZoom())
            return;
        setZoom(next);
        render();
        const area = getTracksRect();
        const mid = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        // The client rect is already shifted by scrolling; apply only the anchor delta.
        timelineBody.scrollLeft = Math.max(0, timelineBody.scrollLeft + pinch.at * area.width - (mid - area.left));
    }, { passive: false });
    ['touchend', 'touchcancel'].forEach(name => timelineBody.addEventListener(name, event => {
        if (event.touches.length < 2)
            pinch = null;
    }));
}
