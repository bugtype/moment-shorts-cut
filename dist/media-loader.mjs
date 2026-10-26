import { message as msg } from './i18n.mjs';
import { LocalizedError } from './core/validation.mjs';
import { validateProject } from './core/project.mjs';
import { retimeOutputLayers } from './effects.mjs';

// Owns guarded video/audio imports and recording hand-off. Project replacement and
// persistence remain explicit app callbacks so no partial media state is committed.
export function createMediaLoader(app, {
    createObjectURL = file => URL.createObjectURL(file),
    revokeObjectURL = url => URL.revokeObjectURL(url),
    createAudio = () => new Audio(),
} = {}) {
    async function loadVideo(file) {
        if (app.recoveryBlocked())
            return;
        if (app.loadingMedia || app.exporting || app.transcribing || app.audioRecording.requesting || app.audioRecording.current) {
            app.toast(msg('errors.busy'));
            return;
        }
        if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
            app.toast(msg('errors.chooseVideo'));
            return;
        }
        if (file.size > 500 * 1024 * 1024) {
            app.toast(msg('errors.videoBytes'));
            return;
        }
        app.loadingMedia = true;
        app.pause();
        const old = app.sources.videoFile, oldThumbnail = app.sources.thumbnail;
        const previousOutput = app.duration() / app.state.speed;
        app.toast(msg('errors.loadingVideo'));
        try {
            await app.sources.setVideoFile(file);
            if (app.recoveryBlocked())
                return;
            const next = {
                ...app.initial(),
                ...app.visualSettings(),
                kind: 'video',
                name: file.name.replace(/\.[^.]+$/, ''),
                fileName: file.name,
                duration: app.video.duration,
                clips: [{ start: 0, end: app.video.duration }],
                captions: []
            };
            retimeOutputLayers(next, previousOutput, next.duration);
            validateProject(next);
            app.sources.videoFile = file;
            app.state = next;
            app.current = 0;
            app.selected = 0;
            app.sources.audioFile = null;
            app.audio.pause();
            app.audio.removeAttribute('src');
            if (app.sources.audioURL)
                revokeObjectURL(app.sources.audioURL);
            app.sources.audioURL = '';
            app.history = [];
            app.future = [];
            app.inputHistory.reset();
            app.persistMedia();
            app.changed();
            app.renderPanel();
            app.resizePreview();
            app.toast(msg('errors.videoLoaded'));
        }
        catch (e) {
            app.sources.videoFile = old;
            if (old)
                await app.sources.setVideoFile(old).catch(() => {
                });
            else {
                if (app.sources.sourceURL)
                    revokeObjectURL(app.sources.sourceURL);
                app.sources.sourceURL = '';
                app.video.removeAttribute('src');
            }
            app.sources.thumbnail = oldThumbnail;
            app.toast(e.code === 'INVALID_ARGUMENT' && e.path === 'project.duration'
                ? msg('errors.videoDurationLimit') : e.messageKey ? e : e.message);
        }
        finally {
            app.loadingMedia = false;
        }
        app.query('#videoInput').value = '';
    }

    async function loadAudio(file, recording = null) {
        if (app.recoveryBlocked())
            return;
        if (app.loadingMedia || app.exporting || app.transcribing || app.audioRecording.requesting || (app.audioRecording.current && app.audioRecording.current !== recording))
            return;
        if (file.size > 100 * 1024 * 1024) {
            app.toast(msg('errors.audioBytes'));
            return;
        }
        app.loadingMedia = true;
        let nextURL, probe;
        try {
            nextURL = createObjectURL(file);
            probe = createAudio();
            const loaded = app.sources.waitForMedia(probe, 'loadedmetadata', msg('errors.audioFormat'));
            probe.src = nextURL;
            await loaded;
            if (app.recoveryBlocked() || (recording && app.audioRecording.current !== recording)) {
                revokeObjectURL(nextURL);
                return;
            }
            // Match normal restore without rejecting indefinite-duration recordings.
            if (!(probe.duration > 0))
                throw new LocalizedError(msg('errors.audioFormat'));
            app.pause();
            if (app.sources.audioURL)
                revokeObjectURL(app.sources.audioURL);
            app.sources.audioURL = nextURL;
            app.audio.src = app.sources.audioURL;
            app.sources.audioFile = file;
            app.state.audioName = file.name;
            app.state.audioOffset = 0;
            app.persistMedia();
            app.changed();
            // Added audio does not change these controls or own their input drafts.
            if (!['text', 'effects', 'templates', 'settings'].includes(app.panel))
                app.renderPanel();
            app.toast(msg('errors.audioLoaded'));
        }
        catch (e) {
            if (nextURL)
                revokeObjectURL(nextURL);
            app.toast(e.messageKey ? e : e.message);
        }
        finally {
            app.loadingMedia = false;
            probe?.removeAttribute('src');
            probe?.load();
        }
        app.query('#audioInput').value = '';
    }

    async function toggleRecording() {
        if (app.recoveryBlocked())
            return;
        const recording = app.audioRecording;
        if (recording.current?.state === 'recording') {
            recording.stop();
            return;
        }
        if (recording.current || app.loadingMedia || app.exporting || app.transcribing || recording.requesting)
            return;
        const project = app.state;
        await recording.start(() => app.persistence.restorePhase === 'ready' && app.state === project && app.panel === 'audio' && !app.loadingMedia && !app.exporting && !app.transcribing);
    }

    return { loadVideo, loadAudio, toggleRecording };
}
