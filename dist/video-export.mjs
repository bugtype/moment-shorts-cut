// Owns export generations and native resources; preparation, playback and UI stay in the app.
export function createVideoExport({ createCanvas, createRecorder, onRelease }) {
    let request = 0, canvas = null, context = null, stream = null, recorder = null;
    let renderOptions = Object.freeze({ includeCaptions: true, includeAudio: true });
    const owns = token => token === request;

    function begin({ includeCaptions = true, includeAudio = true } = {}) {
        renderOptions = Object.freeze({ includeCaptions: includeCaptions !== false, includeAudio: includeAudio !== false });
        return ++request;
    }

    function createSurface(ratio, quality) {
        const [rw, rh] = ratio.split(':').map(Number);
        canvas = createCanvas();
        canvas.width = rw > rh ? Math.round(quality * rw / rh) : quality;
        canvas.height = rh > rw ? Math.round(quality * rh / rw) : quality;
        context = canvas.getContext('2d');
    }

    function capture(token, type, quality, audioStream, { onError, onStop }) {
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
        stream = null;
        context = null;
        canvas = null;
    }

    return {
        begin,
        owns,
        createSurface,
        capture,
        release,
        get renderOptions() { return renderOptions; },
        get request() { return request; },
        get recorder() { return recorder; },
        get canvas() { return canvas; },
        get context() { return context; },
    };
}
