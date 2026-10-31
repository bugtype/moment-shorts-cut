// A comparison owns a paused raw frame and detached project, never editor state.
export function createTemplateScene(app) {
    const project = app.state, signature = JSON.stringify(project), time = app.current;
    const nativeSource = [app.video.src, app.video.currentSrc, app.audio.src, app.audio.currentSrc], raster = app.sampleRaster;
    const selected = app.selected, media = [app.sources.videoFile, app.sources.audioFile];
    const valid = () => app.state === project && JSON.stringify(app.state) === signature &&
        app.current === time && app.selected === selected &&
        app.sources.videoFile === media[0] && app.sources.audioFile === media[1] && app.sampleRaster === raster &&
        [app.video.src, app.video.currentSrc, app.audio.src, app.audio.currentSrc].every((value, index) => value === nativeSource[index]);
    const busy = () => !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        app.audioRecording.requesting || app.audioRecording.current;
    const canApply = () => valid() && !busy() && (app.persistence.restorePhase === 'ready' ||
        (app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid));
    const canCapture = () => valid() && !busy() && app.mediaReady() &&
        (project.kind === 'demo' ? app.sample.complete && !!app.sampleRaster : app.video.readyState >= 2 && !app.video.seeking);
    function capture() {
        if (!canCapture()) return null;
        const source = project.kind === 'demo' ? (app.sampleRaster || app.sample) : app.video;
        const sw = project.kind === 'demo' ? 540 : app.video.videoWidth;
        const sh = project.kind === 'demo' ? 960 : app.video.videoHeight;
        if (!(sw > 0 && sh > 0)) return null;
        const frame = app.document.createElement('canvas'), scale = Math.min(1, 1920 / Math.max(sw, sh));
        let intact = true;
        const lost = () => { intact = false; };
        const release = () => {
            intact = false;
            frame.removeEventListener?.('contextlost', lost);
            frame.width = frame.height = 0;
        };
        try {
            // Restoring this canvas cannot restore its one-time captured pixels.
            frame.addEventListener?.('contextlost', lost);
            frame.width = Math.max(1, Math.round(sw * scale)); frame.height = Math.max(1, Math.round(sh * scale));
            frame.getContext('2d').drawImage(source, 0, 0, frame.width, frame.height);
            const position = app.locate(time), clip = project.clips[position.index];
            return {
                project: structuredClone(project),
                media: { source: frame, sw: frame.width, sh: frame.height, ready: true,
                    sourceTime: position.source, time: time / project.speed, total: app.duration() / project.speed,
                    elapsed: (position.source - clip.start) / project.speed,
                    remaining: (clip.end - position.source) / project.speed,
                    progress: (position.source - clip.start) / (clip.end - clip.start) },
                valid: () => intact,
                release,
            };
        } catch (error) {
            release();
            throw error;
        }
    }
    return { valid, canApply, canCapture, capture };
}
