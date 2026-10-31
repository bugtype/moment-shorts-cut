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
        const width = video.videoWidth, height = video.videoHeight;
        const scale = Math.min(320 / width, 180 / height);
        const sized = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 &&
            Number.isFinite(scale) && scale > 0;
        thumb.width = sized ? Math.max(1, Math.round(width * scale)) : 320;
        thumb.height = sized ? Math.max(1, Math.round(height * scale)) : 180;
        thumb.getContext('2d').drawImage(video, 0, 0, thumb.width, thumb.height);
        sources.thumbnail = thumb.toDataURL('image/jpeg', .7);
    }

    async function restore(project, readMedia, stage) {
        stage(msg('errors.storedMedia'));
        [sources.videoFile, sources.audioFile] = await Promise.all([readMedia('video'), readMedia('audio')]);
        if (project.kind === 'video') {
            stage(msg('errors.storedVideoMissing'));
            if (!sources.videoFile)
                throw new Error('Missing video');
        }
        if (project.audioName && !sources.audioFile) {
            stage(msg('errors.storedAudioMissing'));
            throw new Error('Missing audio');
        }
        // Media and settings use separate stores; a partial save can leave different projects.
        if ((project.kind === 'video' ? sources.videoFile.name !== project.fileName : sources.videoFile) ||
            (project.audioName ? sources.audioFile.name !== project.audioName : sources.audioFile)) {
            stage(msg('errors.storedMediaMismatch'));
            throw new Error('Stored media does not match saved settings');
        }
        if (project.kind === 'video') {
            stage(msg('errors.storedVideoOpen'));
            await sources.setVideoFile(sources.videoFile);
            // Imported metadata can differ; every authored cut still needs actual source media.
            if (project.clips.some(clip => clip.end > video.duration)) {
                stage(msg('errors.storedMediaMismatch'));
                throw new Error('Stored video duration does not match saved settings');
            }
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
        // Removing src alone does not reset the retired native media resource.
        try { video.load(); } catch { /* Keep the remaining cleanup independent. */ }
        try { audio.load(); } catch { /* Preserve registry and URL cleanup. */ }
        if (sources.sourceURL)
            revokeURL(sources.sourceURL);
        if (sources.audioURL)
            revokeURL(sources.audioURL);
        sources.sourceURL = '';
        sources.audioURL = '';
    }
    return sources;
}
