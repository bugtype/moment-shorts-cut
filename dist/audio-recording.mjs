import { message as msg } from './i18n.mjs';
// Owns microphone/recorder resources; the app serializes starts and validates their context.
export function createAudioRecording({ prepare, onProgress, onReady, onError, onIdle, onStateChange }, {
    acquireStream = () => navigator.mediaDevices.getUserMedia({ audio: true }),
    createRecorder = stream => new MediaRecorder(stream),
    createFile = (chunks, name, options) => new File(chunks, name, options),
    setTimer = (callback, delay) => setInterval(callback, delay),
    clearTimer = timer => clearInterval(timer),
} = {}) {
    let current = null, requesting = false, activeTimer, elapsed = 0;
    // Presentation observes state; it must not interrupt native resource cleanup.
    const notifyState = () => { try { onStateChange?.(); } catch {} };

    function stop() {
        if (current?.state !== 'recording')
            return;
        try {
            current.stop();
            clearTimer(activeTimer);
            notifyState();
        }
        catch {
            current.onerror?.();
        }
    }

    async function start(acceptStream) {
        requesting = true;
        let stream, recorder, timer, finished = false, released = false;
        const release = () => {
            if (released)
                return;
            released = true;
            clearTimer(timer);
            stream?.getTracks().forEach(track => track.stop());
            if (recorder)
                recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
        };
        const fail = message => {
            if (finished || (recorder && current !== recorder))
                return;
            finished = true;
            release();
            if (current === recorder)
                current = null;
            try {
                if (recorder && recorder.state !== 'inactive')
                    recorder.stop();
            }
            catch {
            }
            onIdle();
            onError(message);
        };
        try {
            prepare();
            notifyState();
            stream = await acquireStream();
            if (!acceptStream()) {
                release();
                return;
            }
            recorder = createRecorder(stream);
            current = recorder;
            const chunks = [];
            elapsed = 0;
            recorder.ondataavailable = event => {
                if (!finished && current === recorder && event.data.size)
                    chunks.push(event.data);
            };
            recorder.onerror = () => fail(msg('errors.recordingFailed'));
            recorder.onstop = async () => {
                if (finished || current !== recorder)
                    return;
                finished = true;
                release();
                notifyState();
                try {
                    if (!chunks.length) {
                        onError(msg('errors.recordingEmpty'));
                        return;
                    }
                    const mime = recorder.mimeType;
                    // Name Ogg audio by its container without guessing a codec or changing bytes.
                    const extension = mime.split(';', 1)[0].trim().toLowerCase() === 'audio/ogg'
                        ? 'oga' : mime.includes('mp4') ? 'm4a' : 'webm';
                    const file = createFile(chunks, `내 목소리.${extension}`, { type: mime });
                    await onReady(file, recorder);
                }
                catch {
                    onError(msg('errors.recordingConnect'));
                }
                finally {
                    if (current === recorder) {
                        current = null;
                        onIdle();
                    }
                }
            };
            recorder.start();
            onProgress(0);
            activeTimer = timer = setTimer(() => {
                if (finished || current !== recorder || recorder.state !== 'recording')
                    return;
                elapsed++;
                onProgress(elapsed);
                if (elapsed >= 180)
                    stop();
            }, 1000);
        }
        catch {
            fail(msg('errors.microphone'));
        }
        finally {
            requesting = false;
            notifyState();
        }
    }
    return {
        get current() { return current; },
        get requesting() { return requesting; },
        get elapsed() { return current ? elapsed : 0; },
        start,
        stop,
    };
}
