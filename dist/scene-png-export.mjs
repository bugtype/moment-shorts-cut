import { message } from './i18n.mjs';
import { validateProject } from './core/project.mjs';
import { outputDimensions } from './core/aspect-ratio.mjs';

// Repaint the paused composition at export dimensions; never copy preview pixels.
export function createScenePngExport(app, {
    createCanvas = () => app.document.createElement('canvas'),
    fontsLoaded = () => app.document.fonts?.status === 'loaded',
} = {}) {
    let generation = 0, releasePending = () => {};
    const available = () => app.editorReady && !app.exporting && !app.loadingMedia &&
        !app.transcribing && !app.audioRecording.requesting && !app.audioRecording.current &&
        app.mediaReady() && fontsLoaded();
    const mediaState = () => [
        app.sources.videoFile, app.sources.audioFile, app.sources.sourceURL, app.sources.audioURL,
        app.video.src, app.video.currentSrc, app.video.currentTime, app.video.videoWidth, app.video.videoHeight,
        app.audio.src, app.audio.currentSrc, app.audio.currentTime, app.sampleRaster, app.sample,
    ];
    const nativeReady = () =>
        (app.state.kind !== 'video' || (!app.video.seeking &&
            app.video.readyState >= 2 && !app.video.error && app.video.videoWidth > 0 && app.video.videoHeight > 0)) &&
        (!app.sources.audioFile || (!app.audio.seeking && app.audio.readyState >= 2 && !app.audio.error)) &&
        (app.state.kind !== 'demo' || app.sample.complete);

    const pausedReady = () => nativeReady() && !app.playing && app.video.paused && app.audio.paused;

    function save(quality) {
        const request = ++generation;
        releasePending();
        let canvas, released = false, current = () => request === generation;
        const release = () => {
            if (released) return;
            released = true;
            if (canvas) {
                // Release only this request's surface, including encoder failures.
                try { canvas.width = 0; } catch { /* Best-effort native cleanup. */ }
                try { canvas.height = 0; } catch { /* Preserve the primary error. */ }
                canvas = null;
            }
        };
        releasePending = release;
        try {
            if (![720, 1080].includes(quality) || (!available() || !nativeReady())) {
                app.toast(message('shell.scenePngUnavailable'));
                release();
                return false;
            }
            const project = app.state, signature = JSON.stringify(project);
            validateProject(project);
            const identity = () => [app.sources.videoFile, app.sources.audioFile, app.sources.sourceURL, app.sources.audioURL,
                app.video.src, app.video.currentSrc, app.audio.src, app.audio.currentSrc, app.sampleRaster, app.sample];
            const files = identity();
            const sameProject = () => app.state === project && JSON.stringify(app.state) === signature &&
                identity().every((value, index) => value === files[index]);
            app.pause(); // Also invalidates any pending playback start through playRequest.
            if (!sameProject()) { release(); return false; }
            const media = mediaState(), time = app.current;
            const sameContext = () => app.state === project && JSON.stringify(app.state) === signature &&
                app.current === time && mediaState().every((value, index) => value === media[index]);
            const playRequest = app.playRequest;
            current = () => {
                try {
                    return request === generation && available() && sameContext() &&
                        app.playRequest === playRequest && pausedReady();
                } catch { return false; }
            };
            if (!current()) {
                app.toast(message('shell.scenePngUnavailable'));
                release();
                return false;
            }
            const { width, height } = outputDimensions(project.ratio, quality);
            const filename = `${project.name || 'moment'}.scene-${width}x${height}.png`;
            canvas = createCanvas();
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context || typeof canvas.toBlob !== 'function') throw new Error('PNG encoding unavailable');
            app.playback.paint(context, width, height);
            if (!current()) { release(); return false; }
            canvas.toBlob(blob => {
                if (released) return;
                try {
                    if (!current()) return;
                    if (!blob || blob.size <= 0 || blob.type !== 'image/png') throw new Error('Invalid PNG');
                    app.download(blob, filename);
                } catch {
                    if (request === generation && current()) app.toast(message('shell.scenePngError'));
                } finally { release(); }
            }, 'image/png');
            return true;
        } catch {
            if (request === generation) app.toast(message('shell.scenePngError'));
            release();
            return false;
        }
    }
    return { save };
}
