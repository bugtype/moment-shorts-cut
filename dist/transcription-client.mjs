// One client owns a reusable worker. The caller serializes jobs and validates results.
export function createTranscriptionClient(createWorker) {
    let recognitionWorker = null, pendingTranscriptionReject = null;
    function transcribe(pcm, language, status) {
        if (!recognitionWorker)
            recognitionWorker = createWorker();
        const worker = recognitionWorker;
        return new Promise((resolve, reject) => {
            let pending = true;
            const finish = (error, result) => {
                if (!pending)
                    return;
                pending = false;
                pendingTranscriptionReject = null;
                worker.onmessage = null;
                error ? reject(error) : resolve(result);
            };
            const retire = error => {
                if (recognitionWorker !== worker || worker.onerror !== onError)
                    return;
                recognitionWorker = null;
                worker.terminate();
                finish(error);
            };
            const onError = () => retire(new Error('음성 인식 모듈에 연결하지 못했습니다. 인터넷 연결을 확인하거나 SRT를 불러오세요.'));
            pendingTranscriptionReject = error => finish(error);
            worker.onmessage = e => {
                if (!pending || recognitionWorker !== worker)
                    return;
                if (e.data.type === 'progress')
                    status(e.data.message);
                if (e.data.type === 'result')
                    finish(null, e.data.result);
                if (e.data.type === 'error')
                    finish(new Error(e.data.message));
            };
            // Keep observing idle failures; a new job replaces this handler before reuse.
            worker.onerror = onError;
            try {
                worker.postMessage({ audio: pcm, language }, [pcm.buffer]);
            }
            catch (error) {
                retire(error);
            }
        });
    }

    function cancel() {
        recognitionWorker?.terminate();
        recognitionWorker = null;
        pendingTranscriptionReject?.(new Error('자동 자막 생성을 취소했습니다.'));
    }
    return { transcribe, cancel };
}
