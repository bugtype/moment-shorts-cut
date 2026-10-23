import { createDemoProject, readProjectDocument } from './core/project.mjs';

// Session-only guard: failed restores must never overwrite the stored project/media.
export function createProjectPersistence({ store, sources, getProject, replaceProject, saveStatus, toast, pause }, {
    readSettings = key => localStorage.getItem(key),
    writeSettings = (key, value) => localStorage.setItem(key, value),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
} = {}) {
    const persistence = {
        restorePhase: 'restoring', restoreMessage: '프로젝트를 불러오는 중…',
        recoveryValid: false, recoveryBaseline: '', saveTimer: undefined, pendingSave: Promise.resolve(),
        recoveryBlocked, settingsUnavailable, scheduleSave, saveProject, persistMedia, restore,
    };
    function recoveryBlocked(show = true) {
        if (persistence.restorePhase === 'ready')
            return false;
        saveStatus(persistence.restoreMessage, false);
        if (show)
            toast(persistence.restoreMessage);
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
        saveStatus('저장 중…');
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
            saveStatus('이 브라우저에 저장됨');
            if (show)
                toast('프로젝트를 이 브라우저에 저장했습니다.');
        }
        catch (e) {
            if (recoveryBlocked(show))
                return;
            saveStatus('저장 공간을 확인하세요', false);
            if (show)
                toast('저장 공간이 부족하거나 브라우저 저장이 차단되었습니다.');
        }
    }
    function persistMedia() {
        if (recoveryBlocked(false))
            return;
        persistence.pendingSave = store.setMedia(sources.videoFile, sources.audioFile);
        persistence.pendingSave.catch(() => {
            if (!recoveryBlocked(false))
                saveStatus('미디어 저장 실패', false);
        });
    }
    async function restore() {
        persistence.restorePhase = 'restoring';
        persistence.restoreMessage = '프로젝트를 불러오는 중…';
        persistence.recoveryValid = false;
        clearTimer(persistence.saveTimer);
        let recovered = null, cause = '저장된 프로젝트를 불러오지 못함';
        try {
            const raw = readSettings('moment-state-v1');
            if (raw !== null) {
                cause = '저장된 편집 설정을 읽을 수 없습니다';
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
            saveStatus(raw === null ? '이 브라우저에 저장' : '저장된 프로젝트를 불러왔습니다');
        }
        catch (e) {
            replaceProject(recovered || createDemoProject());
            persistence.restorePhase = 'failed';
            persistence.recoveryValid = !!recovered;
            persistence.restoreMessage = cause + ' · 변경사항은 저장되지 않습니다. ' + (persistence.recoveryValid
                ? '새로고침 전에 사용 가이드에서 편집 설정을 내보내세요. 새로고침은 복원을 다시 시도합니다.'
                : '원래 설정을 내보낼 수 없습니다. 새로고침은 읽기를 다시 시도합니다.');
            persistence.recoveryBaseline = JSON.stringify(getProject());
            clearTimer(persistence.saveTimer);
            pause();
            recoveryBlocked();
        }
    }
    return persistence;
}
