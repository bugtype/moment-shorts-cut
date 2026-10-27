import { LocalizedError } from './core/validation.mjs';
import { message as msg } from './i18n.mjs';
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
            const onError = () => retire(new LocalizedError(msg('errors.workerConnection')));
            pendingTranscriptionReject = error => finish(error);
            worker.onmessage = e => {
                if (!pending || recognitionWorker !== worker)
                    return;
                if (e.data.type === 'progress')
                    status(e.data.messageKey ? msg(e.data.messageKey,e.data.messageParams) : e.data.message);
                if (e.data.type === 'result')
                    finish(null, e.data.result);
                if (e.data.type === 'error') {
                    const error = e.data.messageKey ? new LocalizedError(e.data) : new Error(e.data.message);
                    if (e.data.fatal === true) retire(error);
                    else finish(error);
                }
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
        pendingTranscriptionReject?.(new LocalizedError(msg('errors.transcriptionCancelled')));
    }
    return { transcribe, cancel };
}
