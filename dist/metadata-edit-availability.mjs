// Shared admission check for the metadata dialogs; each dialog retains its ownership checks.
export function metadataEditBlocked(app) {
    return !app.editorReady || app.exporting || app.loadingMedia || app.transcribing ||
        app.audioRecording.requesting || app.audioRecording.current ||
        (app.persistence.restorePhase !== 'ready' &&
            !(app.persistence.restorePhase === 'failed' && app.persistence.recoveryValid));
}
