import { message as msg, text, setText } from './i18n.mjs';
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
            app.toast(msg('errors.busy'));
            return;
        }
        const source = app.query('#captionSource').value, language = app.query('#language').value;
        const file = source === 'audio' ? app.sources.audioFile : app.sources.videoFile;
        if (!file) {
            app.toast(source === 'video' ? msg('errors.demoNoSpeech') : msg('errors.addRecognitionAudio'));
            return;
        }
        if (app.state.duration > 180) {
            app.toast(msg('errors.recognitionDuration'));
            return;
        }
        try {
            await app.captionGeneration.generate(source, file, language, {
                start: () => {
                    app.pause();
                    app.transcribing = true;
                    const button = app.query('#generateCaptions');
                    button.disabled = false;
                    button.innerHTML = '<span class="spinner"></span> '+text('errors.preparingCancel');
                },
                status: message => {
                    app.transcriptionStatus = message;
                    const element = app.query('#asrStatus');
                    if (element) {
                        element.hidden = false;
                        if (message?.messageKey) setText(element, message.messageKey, message.messageParams);
                        else {
                            element.removeAttribute('data-i18n');
                            element.removeAttribute('data-i18n-params');
                            element.textContent = message;
                        }
                    }
                },
                apply: (captions, count) => {
                    app.edit(() => app.state.captions = captions);
                    app.toast(msg('errors.captionsGenerated',{count}));
                },
            });
        }
        catch (error) {
            app.toast((error.messageKey ? error : error.message) || msg('errors.captionGenerationFailed'));
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
