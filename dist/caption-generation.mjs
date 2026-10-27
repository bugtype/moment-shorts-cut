import { LocalizedError } from './core/validation.mjs';
import { message as msg } from './i18n.mjs';
import { mapAudioCaptions, MAX_CAPTIONS } from './captions.mjs';
import { prepareCommand } from './core/commands.mjs';

// The app serializes jobs and owns history/UI; this controller owns recognition.
export function createCaptionGeneration({ transcription, getProject, getFile, getDuration }, {
    createAudioContext = () => new AudioContext(),
    createOfflineContext = (...args) => new OfflineAudioContext(...args),
} = {}) {
    let cancelled = false;
    function guard(source, file) {
        const original = getProject(), captions = original.captions;
        const context = () => {
            const state = getProject();
            return JSON.stringify([state.captions, state.duration, source === 'audio' ? [state.audioOffset, getDuration()] : null]);
        };
        const contents = context();
        return () => {
            if (cancelled)
                throw new LocalizedError(msg('errors.transcriptionCancelled'));
            if (getProject() !== original || getProject().captions !== captions || file !== getFile(source) || context() !== contents)
                throw new LocalizedError(msg('errors.transcriptionConflict'));
        };
    }

    async function generate(source, file, language, { start, status, apply }) {
        const beforeApply = guard(source, file);
        cancelled = false;
        start();
        status(msg('errors.readingAudio'));
        const decodeCtx = createAudioContext();
        let buffer;
        try {
            const bytes = await file.arrayBuffer();
            beforeApply();
            buffer = await decodeCtx.decodeAudioData(bytes);
        }
        finally {
            await decodeCtx.close();
        }
        // Native reads/decodes already in flight cannot be aborted here. Reject
        // stale work before allocating and rendering the next expensive stage.
        beforeApply();
        const length = Math.min(buffer.duration, 180);
        const offline = createOfflineContext(1, Math.ceil(length * 16000), 16000);
        const src = offline.createBufferSource();
        src.buffer = buffer;
        src.connect(offline.destination);
        src.start();
        const pcm = (await offline.startRendering()).getChannelData(0);
        beforeApply();
        let peak = 0;
        // Striding can sample only zero crossings and mistake non-silent PCM for silence.
        for (let i = 0; i < pcm.length; i++) {
            peak = Math.max(peak, Math.abs(pcm[i]));
            if (peak >= .002) break;
        }
        if (peak < .002)
            throw new LocalizedError(msg('errors.noSpeechSource'));
        status(msg('errors.preparingModel'));
        const result = await transcription.transcribe(pcm, language, status);
        let caps = (result.chunks || []).map(c => ({
            start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? length, text: c.text.trim(),
        }));
        // Check raw times before audio mapping can clamp them or discard reversed spans.
        for (const c of caps)
            if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start)
                throw new LocalizedError(msg('errors.recognitionTiming'));
        caps = caps.filter(c => c.text);
        if (!caps.length && result.text?.trim())
            caps.push({ start: 0, end: length, text: result.text.trim() });
        if (source === 'audio')
            caps = mapAudioCaptions(caps, getProject().audioOffset, getDuration());
        if (!caps.length)
            throw new LocalizedError(msg('errors.noRecognition'));
        if (caps.length > MAX_CAPTIONS)
            throw new LocalizedError(msg('errors.captionLimit'));
        const prepared = prepareCommand(getProject(), 'captions.replace', { captions: caps });
        beforeApply();
        apply(prepared.project.captions, caps.length);
    }
    function cancel() {
        cancelled = true;
        transcription.cancel();
    }
    return { generate, cancel };
}
