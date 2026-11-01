import { outputDimensions } from './core/aspect-ratio.mjs';

// Owns export generations and native resources; preparation, playback and UI stay in the app.
export function createVideoExport({ createCanvas, createRecorder, onRelease }) {
    let request = 0, canvas = null, context = null, stream = null, recorder = null, pausedCapture = null;
    let renderOptions = Object.freeze({ includeCaptions: true, includeAudio: true });
    const owns = token => token === request;

    function begin({ includeCaptions = true, includeAudio = true } = {}) {
        renderOptions = Object.freeze({ includeCaptions: includeCaptions !== false, includeAudio: includeAudio !== false });
        return ++request;
    }

    function createSurface(ratio, quality) {
        const { width, height } = outputDimensions(ratio, quality);
        canvas = createCanvas();
        canvas.width = width;
        canvas.height = height;
        context = canvas.getContext('2d');
        if (!context || context.isContextLost?.()) throw new Error('Video rendering context unavailable');
    }

    function capture(token, type, quality, audioStream, { onError, onStop }) {
        // Seeking may yield after allocation; verify the surface before acquiring tracks.
        if (!context || context.isContextLost?.()) throw new Error('Video rendering context unavailable');
        stream = canvas.captureStream(30);
        if (renderOptions.includeAudio)
            audioStream.getAudioTracks().forEach(track => stream.addTrack(track.clone()));
        const chunks = [], active = recorder = createRecorder(stream, {
            mimeType: type.mime,
            videoBitsPerSecond: quality === 1080 ? 8000000 : 4500000,
            audioBitsPerSecond: 128000,
        });
        active.ondataavailable = event => {
            if (owns(token) && event.data.size)
                chunks.push(event.data);
        };
        active.onerror = () => {
            if (owns(token))
                onError();
        };
        active.onstop = () => {
            if (owns(token))
                onStop(new Blob(chunks, { type: active.mimeType }));
        };
        return active;
    }

    // Only a pause owned by this export may be resumed after an asynchronous cut.
    function pauseCapture(token) {
        if (!owns(token) || !recorder || recorder.state === 'inactive') return false;
        if (pausedCapture === recorder && recorder.state === 'paused') return true;
        if (recorder.state !== 'recording') return false;
        const active = recorder;
        active.pause();
        if (!owns(token) || recorder !== active) return false;
        pausedCapture = active;
        return true;
    }

    function resumeCapture(token) {
        if (!owns(token) || !recorder || pausedCapture !== recorder || recorder.state !== 'paused') return false;
        const active = recorder;
        active.resume();
        if (!owns(token) || recorder !== active) return false;
        pausedCapture = null;
        return true;
    }

    function release(token) {
        if (!owns(token))
            return;
        ++request;
        renderOptions = Object.freeze({ includeCaptions: true, includeAudio: true });
        onRelease();
        if (recorder)
            recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
        stream?.getTracks().forEach(track => track.stop());
        recorder = null;
        pausedCapture = null;
        stream = null;
        context = null;
        canvas = null;
    }

    return {
        begin,
        owns,
        createSurface,
        capture,
        pauseCapture,
        resumeCapture,
        release,
        get renderOptions() { return renderOptions; },
        get request() { return request; },
        get recorder() { return recorder; },
        get canvas() { return canvas; },
        get context() { return context; },
    };
}
