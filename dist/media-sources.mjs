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
                reject(new Error(message));
            };
            const timer = setTimer(() => {
                cleanup();
                reject(new Error('파일을 읽는 데 시간이 초과되었습니다. 더 작은 파일로 다시 시도하세요.'));
            }, 20000);
            element.addEventListener(event, loaded, { once: true });
            element.addEventListener('error', failed, { once: true });
        });
    }
    async function setVideoFile(file) {
        if (sources.sourceURL)
            revokeURL(sources.sourceURL);
        sources.sourceURL = createURL(file);
        const loaded = waitForMedia(video, 'loadeddata', '브라우저에서 지원하지 않는 영상입니다. H.264 MP4 또는 WebM을 사용해 주세요.');
        video.src = sources.sourceURL;
        await loaded;
        if (!Number.isFinite(video.duration) || video.duration <= 0)
            throw new Error('영상 길이를 읽을 수 없습니다.');
        const thumb = createCanvas();
        thumb.width = 320;
        thumb.height = 180;
        thumb.getContext('2d').drawImage(video, 0, 0, 320, 180);
        sources.thumbnail = thumb.toDataURL('image/jpeg', .7);
    }

    async function restore(project, readMedia, stage) {
        stage('저장된 미디어를 읽을 수 없습니다');
        [sources.videoFile, sources.audioFile] = await Promise.all([readMedia('video'), readMedia('audio')]);
        if (project.kind === 'video') {
            stage('저장된 영상 파일을 찾을 수 없습니다');
            if (!sources.videoFile)
                throw new Error('Missing video');
            stage('저장된 영상을 열 수 없습니다');
            await sources.setVideoFile(sources.videoFile);
        }
        if (project.audioName && !sources.audioFile) {
            stage('저장된 오디오 파일을 찾을 수 없습니다');
            throw new Error('Missing audio');
        }
        if (sources.audioFile) {
            const message = '저장된 오디오를 열 수 없습니다';
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
