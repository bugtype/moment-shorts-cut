import { LocalizedError } from './core/validation.mjs';
import { message as msg } from './i18n.mjs';
export function createMediaSources({ video, audio }, {
    createURL = file => URL.createObjectURL(file),
    revokeURL = url => URL.revokeObjectURL(url),
    createCanvas = () => document.createElement('canvas'),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
} = {}) {
    const sources = {
        videoFile: null, audioFile: null, sourceURL: '', audioURL: '', thumbnail: '',
        waitForMedia, setVideoFile, restore, reset,
    };
    function waitForMedia(element, event, message) {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimer(timer);
                element.removeEventListener(event, loaded);
                element.removeEventListener('error', failed);
            };
            const loaded = () => {
                cleanup();
                resolve();
            }, failed = () => {
                cleanup();
                reject(new LocalizedError(message));
            };
            const timer = setTimer(() => {
                cleanup();
                reject(new LocalizedError(msg('errors.fileTimeout')));
            }, 20000);
            element.addEventListener(event, loaded, { once: true });
            element.addEventListener('error', failed, { once: true });
        });
    }
    async function setVideoFile(file) {
        if (sources.sourceURL)
            revokeURL(sources.sourceURL);
        sources.sourceURL = createURL(file);
        const loaded = waitForMedia(video, 'loadeddata', msg('errors.videoFormat'));
        video.src = sources.sourceURL;
        await loaded;
        if (!Number.isFinite(video.duration) || video.duration <= 0)
            throw new LocalizedError(msg('errors.videoDurationRead'));
        const thumb = createCanvas();
        thumb.width = 320;
        thumb.height = 180;
        thumb.getContext('2d').drawImage(video, 0, 0, 320, 180);
        sources.thumbnail = thumb.toDataURL('image/jpeg', .7);
    }

    async function restore(project, readMedia, stage) {
        stage(msg('errors.storedMedia'));
        [sources.videoFile, sources.audioFile] = await Promise.all([readMedia('video'), readMedia('audio')]);
        if (project.kind === 'video') {
            stage(msg('errors.storedVideoMissing'));
            if (!sources.videoFile)
                throw new Error('Missing video');
            stage(msg('errors.storedVideoOpen'));
            await sources.setVideoFile(sources.videoFile);
        }
        if (project.audioName && !sources.audioFile) {
            stage(msg('errors.storedAudioMissing'));
            throw new Error('Missing audio');
        }
        if (sources.audioFile) {
            const message = msg('errors.storedAudioOpen');
            stage(message);
            sources.audioURL = createURL(sources.audioFile);
            const loaded = sources.waitForMedia(audio, 'loadeddata', message);
            audio.src = sources.audioURL;
            await loaded;
            if (!(audio.duration > 0))
                throw new Error('Invalid audio duration');
        }
    }
    function reset() {
        sources.videoFile = null;
        sources.audioFile = null;
        sources.thumbnail = '';
        video.removeAttribute('src');
        audio.removeAttribute('src');
        if (sources.sourceURL)
            revokeURL(sources.sourceURL);
        if (sources.audioURL)
            revokeURL(sources.audioURL);
        sources.sourceURL = '';
        sources.audioURL = '';
    }
    return sources;
}
