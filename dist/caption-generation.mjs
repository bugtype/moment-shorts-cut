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
                throw new Error('자동 자막 생성을 취소했습니다.');
            if (getProject() !== original || getProject().captions !== captions || file !== getFile(source) || context() !== contents)
                throw new Error('원본·자막·시간 기준이 변경되어 인식 결과를 적용하지 않았습니다. 다시 생성하세요.');
        };
    }

    async function generate(source, file, language, { start, status, apply }) {
        const beforeApply = guard(source, file);
        cancelled = false;
        start();
        status('오디오를 읽고 있습니다…');
        const decodeCtx = createAudioContext();
        let buffer;
        try {
            buffer = await decodeCtx.decodeAudioData(await file.arrayBuffer());
        }
        finally {
            await decodeCtx.close();
        }
        const length = Math.min(buffer.duration, 180);
        const offline = createOfflineContext(1, Math.ceil(length * 16000), 16000);
        const src = offline.createBufferSource();
        src.buffer = buffer;
        src.connect(offline.destination);
        src.start();
        const pcm = (await offline.startRendering()).getChannelData(0);
        beforeApply();
        let peak = 0;
        for (let i = 0; i < pcm.length; i += 50)
            peak = Math.max(peak, Math.abs(pcm[i]));
        if (peak < .002)
            throw new Error('음성을 찾지 못했습니다. 소리가 있는 영상이나 오디오를 선택하세요.');
        status('음성 인식 모델을 준비합니다. 첫 실행은 다운로드에 시간이 걸릴 수 있습니다.');
        const result = await transcription.transcribe(pcm, language, status);
        let caps = (result.chunks || []).map(c => ({
            start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? length, text: c.text.trim(),
        }));
        // Check raw times before audio mapping can clamp them or discard reversed spans.
        for (const c of caps)
            if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start)
                throw new Error('인식된 자막의 시간 정보가 올바르지 않습니다. 기존 자막은 유지됩니다.');
        caps = caps.filter(c => c.text);
        if (!caps.length && result.text?.trim())
            caps.push({ start: 0, end: length, text: result.text.trim() });
        if (source === 'audio')
            caps = mapAudioCaptions(caps, getProject().audioOffset, getDuration());
        if (!caps.length)
            throw new Error('인식된 음성이 없습니다. 음질과 언어 설정을 확인하세요.');
        if (caps.length > MAX_CAPTIONS)
            throw new Error('자막은 10,000개 이하만 지원합니다.');
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
