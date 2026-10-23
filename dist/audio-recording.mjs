// Owns microphone/recorder resources; the app serializes starts and validates their context.
export function createAudioRecording({ prepare, onProgress, onReady, onError, onIdle }, {
    acquireStream = () => navigator.mediaDevices.getUserMedia({ audio: true }),
    createRecorder = stream => new MediaRecorder(stream),
    createFile = (chunks, name, options) => new File(chunks, name, options),
    setTimer = (callback, delay) => setInterval(callback, delay),
    clearTimer = timer => clearInterval(timer),
} = {}) {
    let current = null, requesting = false, activeTimer;

    function stop() {
        if (current?.state !== 'recording')
            return;
        try {
            current.stop();
            clearTimer(activeTimer);
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
            stream = await acquireStream();
            if (!acceptStream()) {
                release();
                return;
            }
            recorder = createRecorder(stream);
            current = recorder;
            const chunks = [];
            let seconds = 0;
            recorder.ondataavailable = event => {
                if (!finished && current === recorder && event.data.size)
                    chunks.push(event.data);
            };
            recorder.onerror = () => fail('녹음 중 오류가 발생했습니다. 마이크와 브라우저 설정을 확인하세요.');
            recorder.onstop = async () => {
                if (finished || current !== recorder)
                    return;
                finished = true;
                release();
                try {
                    if (!chunks.length) {
                        onError('녹음된 소리가 없습니다. 다시 녹음해 주세요.');
                        return;
                    }
                    const mime = recorder.mimeType;
                    const file = createFile(chunks, `내 목소리.${mime.includes('mp4') ? 'm4a' : 'webm'}`, { type: mime });
                    await onReady(file, recorder);
                }
                catch {
                    onError('녹음된 오디오를 연결하지 못했습니다. 다시 시도해 주세요.');
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
                seconds++;
                onProgress(seconds);
                if (seconds >= 180) {
                    clearTimer(timer);
                    try {
                        recorder.stop();
                    }
                    catch {
                        recorder.onerror?.();
                    }
                }
            }, 1000);
        }
        catch {
            fail('마이크를 사용할 수 없습니다. 브라우저에서 마이크 권한을 허용해 주세요.');
        }
        finally {
            requesting = false;
        }
    }
    return {
        get current() { return current; },
        get requesting() { return requesting; },
        start,
        stop,
    };
}
