import { MAX_CLIPS } from './core/project.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Timeline and session editing commands. Validation and history stay shared so
// trim, split, undo and reset never bypass the project command boundary.
export function createEditingActions(app) {
    function trim(start, end) {
        const state = app.state;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > state.duration || end - start < .1) {
            app.toast('시작·끝을 확인하세요. 클립은 0.1초 이상이어야 합니다.');
            return;
        }
        const clips = structuredClone(state.clips);
        clips[app.selected] = { start, end };
        if (!app.runEditorCommand('timeline.replace', { clips }))
            return;
        app.seekTo(state.clips.slice(0, app.selected).reduce((sum, clip) => sum + clip.end - clip.start, 0));
        if (app.panel === 'settings')
            app.renderPanel();
    }

    function split() {
        const state = app.state;
        if (state.clips.length >= MAX_CLIPS) {
            app.toast('클립은 1,000개 이하만 지원합니다. 클립을 삭제한 뒤 다시 분할하세요.');
            return;
        }
        const pos = app.locate(app.current), clip = state.clips[pos.index];
        if (pos.source - clip.start < .1 || clip.end - pos.source < .1) {
            app.toast('클립의 시작과 끝에서 0.1초 이상 떨어진 위치를 선택하세요.');
            return;
        }
        app.pause();
        app.edit(() => {
            state.clips.splice(pos.index, 1, { start: clip.start, end: pos.source }, { start: pos.source, end: clip.end });
            app.selected = pos.index + 1;
        });
        app.openInspector('clip');
        app.toast('재생 위치에서 클립을 분할했습니다.');
    }

    function undo(redo = false) {
        app.inputHistory.reset();
        const from = redo ? app.future : app.history, to = redo ? app.history : app.future;
        if (!from.length)
            return;
        app.pause();
        to.push(JSON.stringify(app.state));
        app.state = JSON.parse(from.pop());
        app.timelineCache = null;
        if (app.persistence.restorePhase === 'ready')
            app.state.audioName = app.sources.audioFile?.name || '';
        app.selected = clamp(app.selected, 0, app.state.clips.length - 1);
        app.current = Math.min(app.current, app.duration());
        app.changed();
        app.resizePreview();
        app.renderPanel();
        app.seekTo(app.current);
    }

    function confirmReset() {
        if (app.recoveryBlocked())
            return;
        if (app.transcribing || app.audioRecording.requesting || app.audioRecording.current) {
            app.toast('진행 중인 작업을 먼저 완료해 주세요.');
            return;
        }
        app.modalOpen('새로운 순간을 시작할까요?', '<p class="modal-copy">이 브라우저에 저장된 현재 프로젝트가 샘플 프로젝트로 교체됩니다. 필요한 영상은 먼저 내보내 주세요.</p>', '<div class="modal-foot"><button class="button" id="cancelReset">취소</button><button class="button primary" id="confirmReset">새 작업 시작</button></div>');
        app.query('#cancelReset').onclick = () => app.modal.close();
        app.query('#confirmReset').onclick = () => {
            if (app.recoveryBlocked() || app.audioRecording.current || app.audioRecording.requesting)
                return;
            app.pause();
            app.state = app.initial();
            app.timelineCache = null;
            app.sources.reset();
            app.current = 0;
            app.selected = 0;
            app.history = [];
            app.future = [];
            app.inputHistory.reset();
            app.persistMedia();
            app.changed();
            app.renderPanel();
            app.resizePreview();
            app.modal.close();
        };
    }

    return { trim, split, undo, confirmReset };
}
