// Recognition orchestration for the caption panel. Worker lifecycle and provider
// validation stay in caption-generation/transcription-client; this only maps the
// current project and panel status onto those services.
export function createCaptionFlow(app) {
    async function generateCaptions() {
        if (app.recoveryBlocked())
            return;
        if (app.transcribing) {
            app.captionGeneration.cancel();
            return;
        }
        if (app.audioRecording.current || app.audioRecording.requesting || app.loadingMedia || app.exporting) {
            app.toast('진행 중인 작업을 먼저 완료해 주세요.');
            return;
        }
        const source = app.query('#captionSource').value, language = app.query('#language').value;
        const file = source === 'audio' ? app.sources.audioFile : app.sources.videoFile;
        if (!file) {
            app.toast(source === 'video' ? '샘플에는 음성이 없습니다. 음성이 있는 영상을 업로드하세요.' : '인식할 오디오를 먼저 추가하세요.');
            return;
        }
        if (app.state.duration > 180) {
            app.toast('자동 자막은 원본 길이 3분 이하를 지원합니다. 짧은 원본을 업로드하세요.');
            return;
        }
        try {
            await app.captionGeneration.generate(source, file, language, {
                start: () => {
                    app.pause();
                    app.transcribing = true;
                    const button = app.query('#generateCaptions');
                    button.disabled = false;
                    button.innerHTML = '<span class="spinner"></span> 준비 중 · 취소';
                },
                status: message => {
                    app.transcriptionStatus = message;
                    const element = app.query('#asrStatus');
                    if (element) {
                        element.hidden = false;
                        element.textContent = message;
                    }
                },
                apply: (captions, count) => {
                    app.edit(() => app.state.captions = captions);
                    app.toast(`${count}개의 자막을 생성했습니다. 인식 결과를 확인해 주세요.`);
                },
            });
        }
        catch (error) {
            app.toast(error.message || '자막 생성에 실패했습니다. SRT 불러오기나 직접 입력을 사용할 수 있습니다.');
        }
        finally {
            app.transcribing = false;
            if (app.panel === 'captions') {
                const restoreFocus = app.document.activeElement?.id === 'generateCaptions';
                app.renderPanel();
                if (restoreFocus)
                    app.query('#captionCreate summary').focus();
            }
        }
    }
    return { generateCaptions };
}
