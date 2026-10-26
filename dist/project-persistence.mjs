import { message as msg, formatError } from './i18n.mjs';
import { createDemoProject, readProjectDocument } from './core/project.mjs';

// Session-only guard: failed restores must never overwrite the stored project/media.
export function createProjectPersistence({ store, sources, getProject, replaceProject, saveStatus, toast, pause }, {
    readSettings = key => localStorage.getItem(key),
    writeSettings = (key, value) => localStorage.setItem(key, value),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
} = {}) {
    let restoreNotice = msg('errors.restoring');
    const persistence = {
        restorePhase: 'restoring',
        get restoreMessage() { return formatError(restoreNotice); },
        set restoreMessage(value) { restoreNotice = value; },
        recoveryValid: false, recoveryBaseline: '', saveTimer: undefined, pendingSave: Promise.resolve(),
        recoveryBlocked, settingsUnavailable, scheduleSave, saveProject, persistMedia, restore,
    };
    function recoveryBlocked(show = true) {
        if (persistence.restorePhase === 'ready')
            return false;
        saveStatus(restoreNotice, false);
        if (show)
            toast(restoreNotice);
        return true;
    }
    function settingsUnavailable() {
        if (persistence.restorePhase === 'ready' || (persistence.restorePhase === 'failed' && persistence.recoveryValid))
            return false;
        recoveryBlocked();
        return true;
    }
    function scheduleSave() {
        clearTimer(persistence.saveTimer);
        if (recoveryBlocked(false))
            return;
        saveStatus(msg('errors.saving'));
        persistence.saveTimer = setTimer(() => saveProject(), 500);
    }
    async function saveProject(show = false) {
        clearTimer(persistence.saveTimer);
        if (recoveryBlocked(show))
            return;
        try {
            if (show && (sources.videoFile || sources.audioFile))
                persistMedia();
            let saving;
            do {
                saving = persistence.pendingSave;
                await saving;
                if (recoveryBlocked(show))
                    return;
            } while (saving !== persistence.pendingSave);
            writeSettings('moment-state-v1', JSON.stringify(getProject()));
            // Keep metadata autosave, but never repopulate invalidated media implicitly.
            if (store.hasStoredMedia?.(sources.videoFile, sources.audioFile) === false) {
                saveStatus(msg('errors.checkStorage'), false);
                if (show)
                    toast(msg('errors.checkStorage'));
                return;
            }
            saveStatus(msg('errors.saved'));
            if (show)
                toast(msg('errors.savedNotice'));
        }
        catch (e) {
            if (recoveryBlocked(show))
                return;
            saveStatus(msg('errors.checkStorage'), false);
            if (show)
                toast(msg('errors.storageBlocked'));
        }
    }
    function persistMedia() {
        if (recoveryBlocked(false))
            return;
        persistence.pendingSave = store.setMedia(sources.videoFile, sources.audioFile);
        persistence.pendingSave.catch(() => {
            if (!recoveryBlocked(false))
                saveStatus(msg('errors.mediaSave'), false);
        });
    }
    async function restore() {
        persistence.restorePhase = 'restoring';
        persistence.restoreMessage = msg('errors.restoring');
        persistence.recoveryValid = false;
        clearTimer(persistence.saveTimer);
        let recovered = null, cause = msg('errors.restoreFailed');
        try {
            const raw = readSettings('moment-state-v1');
            if (raw !== null) {
                cause = msg('errors.settingsRead');
                const saved = JSON.parse(raw);
                if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Array.isArray(saved.clips) || !saved.clips.length)
                    throw new Error('Invalid saved project');
                recovered = readProjectDocument({
                    format: 'moment-project',
                    formatVersion: 1,
                    project: { ...saved, schemaVersion: saved.schemaVersion ?? 1 } });
                replaceProject(recovered);
                await sources.restore(getProject(), key => store.get(key), message => { cause = message; });
            }
            persistence.restorePhase = 'ready';
            saveStatus(raw === null ? msg('errors.saveInBrowser') : msg('errors.projectRestored'));
        }
        catch (e) {
            replaceProject(recovered || createDemoProject());
            persistence.restorePhase = 'failed';
            persistence.recoveryValid = !!recovered;
            persistence.restoreMessage = msg(persistence.recoveryValid ? 'errors.restoreWithBackup' : 'errors.restoreWithoutBackup', {cause});
            persistence.recoveryBaseline = JSON.stringify(getProject());
            clearTimer(persistence.saveTimer);
            pause();
            recoveryBlocked();
        }
    }
    return persistence;
}
