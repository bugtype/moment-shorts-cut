import { message } from './i18n.mjs';

// Session-only recovery capability. This owner never writes project or storage state.
export function createSessionMedia({ getProject, persistence, sources, video, audio, blocked = () => false }, {
    createVideo = () => document.createElement('video'),
    createAudio = () => document.createElement('audio'),
    createURL = file => URL.createObjectURL(file), revokeURL = url => URL.revokeObjectURL(url),
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer),
} = {}) {
    let generation = 0, active = null, capability = null;
    const contract = project => JSON.stringify([project.kind, project.fileName, project.duration, project.audioName]);
    const error = (code, key) => ({ code, ...message(`shell.sessionMedia${key}`) });
    function mediaReady() {
        if (persistence.restorePhase === 'ready') return true;
        const ready = persistence.restorePhase === 'failed' && persistence.recoveryValid && !!capability &&
            capability.contract === contract(getProject()) &&
            capability.videoFile === sources.videoFile && capability.audioFile === sources.audioFile &&
            capability.videoURL === sources.sourceURL && capability.audioURL === sources.audioURL &&
            (video.getAttribute('src') || '') === capability.videoURL &&
            (audio.getAttribute('src') || '') === capability.audioURL;
        if (!ready) capability = null;
        // Authorization survives normal seek/buffering. Publication already checked
        // loadeddata; playback/paint retain their own transient readiness checks.
        const authorized = (element, url) => (!url || (element.src === url && !element.error &&
            (element.currentSrc === undefined || element.currentSrc === url)));
        return ready && authorized(video, capability.videoURL) && authorized(audio, capability.audioURL);
    }
    function mediaBlocked(show = true) {
        if (mediaReady()) return false;
        persistence.recoveryBlocked(show);
        return true;
    }
    function releaseProbe(probe) {
        if (!probe) return;
        try { probe.removeAttribute('src'); probe.load?.(); } catch { /* Detached probe cleanup. */ }
    }
    function restoreElement(element, src) {
        try {
            if (src == null) element.removeAttribute('src'); else element.src = src;
            element.load?.();
        } catch { /* Keep recovery blocked if the old native source cannot be restored. */ }
    }
    function dispose(request, rollback) {
        request.waiters.forEach(reject => reject(error('CANCELLED', 'Cancelled')));
        request.waiters.clear();
        if (rollback && request.attaching) {
            if (request.attached.get(video) === video.getAttribute('src')) restoreElement(video, request.previousVideo);
            if (request.attached.get(audio) === audio.getAttribute('src')) restoreElement(audio, request.previousAudio);
        }
        request.probes.forEach(releaseProbe);
        request.probes.length = 0;
        request.urls.forEach(url => { try { revokeURL(url); } catch { /* Best effort URL cleanup. */ } });
        request.urls.clear();
    }
    function cancel() {
        generation++;
        if (active) { const request = active; active = null; dispose(request, true); }
    }
    function invalidate() { cancel(); capability = null; }
    function waitFor(request, element, src) {
        return new Promise((resolve, reject) => {
            let timer, settled = false;
            const finish = failure => {
                if (settled) return;
                settled = true;
                clearTimer(timer);
                element.removeEventListener('loadeddata', loaded);
                element.removeEventListener('error', failed);
                request.waiters.delete(abort);
                failure ? reject(failure) : resolve();
            };
            const loaded = () => {
                if (element.error) { finish(error('MEDIA_ERROR', 'Failed')); return; }
                if (element.src !== src || (element.currentSrc !== undefined && element.currentSrc !== src) ||
                    (element.readyState !== undefined && element.readyState < 2)) return;
                finish();
            }, failed = () => {
                if (element.src === src) finish(error('MEDIA_ERROR', 'Failed'));
            };
            const abort = failure => finish(failure);
            request.waiters.add(abort);
            element.addEventListener('loadeddata', loaded);
            element.addEventListener('error', failed);
            timer = setTimer(() => finish(error('TIMEOUT', 'Failed')), 20000);
            try { element.src = src; } catch { finish(error('MEDIA_ERROR', 'Failed')); }
        });
    }
    function compatible(project, v, a) {
        if (project.kind === 'video' && (!Number.isFinite(v.duration) || v.duration <= 0 ||
            Math.abs(v.duration - project.duration) > .05 || v.duration < project.duration ||
            project.clips.some(clip => clip.end > v.duration))) throw error('INVALID_MEDIA', 'Duration');
        if (project.audioName && (!Number.isFinite(a.duration) || a.duration <= 0))
            throw error('INVALID_MEDIA', 'Duration');
    }
    async function connect(files, { confirmed = false } = {}) {
        cancel();
        capability = null;
        if (confirmed !== true) return { ok: false, error: error('CONFIRMATION_REQUIRED', 'Confirmation') };
        if (persistence.restorePhase !== 'failed' || !persistence.recoveryValid)
            return { ok: false, error: error('RECOVERY_REQUIRED', 'Unavailable') };
        if (blocked()) return { ok: false, error: error('BUSY', 'Busy') };
        const project = getProject(), signature = JSON.stringify(project);
        const registry = [sources.videoFile, sources.audioFile, sources.sourceURL, sources.audioURL];
        const request = { id: generation, urls: new Set(), probes: [], waiters: new Set(), attaching: false, attached: new Map(),
            previousVideo: video.getAttribute('src'), previousAudio: audio.getAttribute('src') };
        active = request;
        const owns = () => active === request && generation === request.id;
        const check = () => {
            if (!owns()) throw error('CANCELLED', 'Cancelled');
            if (blocked() || persistence.restorePhase !== 'failed' || !persistence.recoveryValid ||
                getProject() !== project || JSON.stringify(getProject()) !== signature ||
                [sources.videoFile, sources.audioFile, sources.sourceURL, sources.audioURL].some((value, index) => value !== registry[index]))
                throw error('CONFLICT', 'Stale');
        };
        try {
            if (!files || typeof files !== 'object' || Array.isArray(files) ||
                Object.keys(files).some(key => !['video', 'audio'].includes(key)) ||
                (project.kind !== 'video' && files.video != null) || (!project.audioName && files.audio != null))
                throw error('INVALID_MEDIA', 'Failed');
            const vf = project.kind === 'video' ? files?.video : null;
            const af = project.audioName ? files?.audio : null;
            if (project.kind === 'video' && (!vf || !Number.isFinite(vf.size) || vf.size < 0 || vf.size > 500 * 1024 * 1024)) throw error('INVALID_MEDIA', 'Video');
            if (project.audioName && (!af || !Number.isFinite(af.size) || af.size < 0 || af.size > 100 * 1024 * 1024)) throw error('INVALID_MEDIA', 'Audio');
            if ((vf && vf.name !== project.fileName) || (af && af.name !== project.audioName)) throw error('INVALID_MEDIA', 'Name');
            const staged = [];
            for (const [file, create, element] of [[vf, createVideo, video], [af, createAudio, audio]]) {
                if (!file) continue;
                const url = createURL(file); request.urls.add(url);
                const probe = create(); request.probes.push(probe);
                staged.push({file, url, probe, element});
            }
            await Promise.all(staged.map(item => waitFor(request, item.probe, item.url)));
            check();
            if (staged.some(item => item.probe.error)) throw error('MEDIA_ERROR', 'Failed');
            compatible(project, staged.find(item => item.element === video)?.probe, staged.find(item => item.element === audio)?.probe);
            request.attaching = true;
            staged.forEach(item => request.attached.set(item.element, item.url));
            await Promise.all(staged.map(item => waitFor(request, item.element, item.url)));
            check();
            for (const item of staged) {
                if (item.element.error || item.element.src !== item.url ||
                    (item.element.currentSrc !== undefined && item.element.currentSrc !== item.url) ||
                    (item.element.readyState !== undefined && item.element.readyState < 2))
                    throw error('CONFLICT', 'Stale');
            }
            compatible(project, video, audio);
            const oldURLs = [sources.sourceURL, sources.audioURL];
            if (!vf) video.removeAttribute('src');
            if (!af) audio.removeAttribute('src');
            sources.videoFile = vf; sources.audioFile = af;
            sources.sourceURL = staged.find(item => item.element === video)?.url || '';
            sources.audioURL = staged.find(item => item.element === audio)?.url || '';
            capability = { contract: contract(project), videoFile: vf, audioFile: af,
                videoURL: sources.sourceURL, audioURL: sources.audioURL };
            request.urls.clear(); // Ownership transferred to the existing media source owner.
            active = null;
            dispose(request, false);
            oldURLs.filter(Boolean).forEach(url => { try { revokeURL(url); } catch { /* Old source cleanup. */ } });
            return { ok: true };
        } catch (failure) {
            if (owns()) { active = null; dispose(request, true); }
            return { ok: false, error: failure?.code ? failure : error('MEDIA_ERROR', 'Failed') };
        }
    }
    return { mediaReady, mediaBlocked, connect, cancel, invalidate };
}
