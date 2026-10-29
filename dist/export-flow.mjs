import {t, text, mark, message, setText} from './i18n.mjs';
import { esc, fmt } from './ui-format.mjs';

// Owns the export dialog and lifecycle. Recording, encoding and resource release
// remain delegated to the video-export service; playback stays in the app.
export function createExportFlow(app, {
    isTypeSupported = mime => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime),
    hasMediaRecorder = () => typeof MediaRecorder !== 'undefined',
    body = () => document.body,
    fontsReady = () => document.fonts.ready,
} = {}) {
    const { query: $, videoExport, toast, modal } = app;

    let dialogGeneration = 0, completed = null;

    // One immutable finished-file snapshot, not a cache of current project edits.
    // Handlers retain only ownership tokens; clearing this cell releases our Blob reference.
    function showCompleted(result) {
        const generation = ++dialogGeneration;
        completed = result;
        result = null;
        const { name, quality, extension, duration } = completed;
        modal.innerHTML = `<div class="modal-head"><h2 id="modalTitle">${text("shell.exportDone")}</h2></div><p class="modal-copy">${esc(name)}<br>${quality}p · ${extension.toUpperCase()} · ${fmt(duration)}</p><div class="notice" id="exportDownloadStatus" role="status">${text("shell.exportReview")}</div><div class="modal-foot"><button class="button" id="exportDone">${text("shell.backToEditor")}</button><button class="button primary" id="downloadExportAgain">${text("shell.exportDownloadAgain")}</button></div>`;
        const retry = $('#downloadExportAgain');
        const owns = () => generation === dialogGeneration && completed && modal.open && $('#downloadExportAgain') === retry;
        const release = () => { if (generation === dialogGeneration) completed = null; };
        const attempt = () => {
            let status = 'shell.exportReview';
            try {
                app.download(completed.blob, completed.filename);
            }
            catch {
                // A cleanup failure can happen after click: never automatically retry
                // or imply that no file reached the browser's Downloads list.
                status = 'shell.exportDownloadFailed';
            }
            setText($('#exportDownloadStatus'), status);
        };
        modal.onreplace = release;
        modal.onclose = () => { if (!modal.open) release(); };
        $('#exportDone').onclick = () => { if (owns()) { release(); modal.close(); } };
        retry.onclick = event => {
            if (owns() && !event?.isComposing && event?.keyCode !== 229) attempt();
        };
        attempt();
    }

    function supportedTypes() {
        if (!hasMediaRecorder())
            return [];
        return [
            { mime: 'video/mp4;codecs=avc1.424028,mp4a.40.2', label: 'MP4 · H.264', ext: 'mp4' },
            { mime: 'video/webm;codecs=vp9,opus', label: 'WebM · VP9', ext: 'webm' },
            { mime: 'video/webm;codecs=vp8,opus', label: 'WebM · VP8', ext: 'webm' },
            { mime: 'video/mp4', label: 'MP4', ext: 'mp4' },
        ].filter(type => isTypeSupported(type.mime));
    }

    function exportDialog() {
        if (app.mediaBlocked() || app.exporting)
            return;
        if (app.audioRecording.requesting || app.loadingMedia || app.audioRecording.current || app.transcribing) {
            toast(message("shell.exportBusy"));
            return;
        }
        app.pause();
        const types = supportedTypes();
        if (!types.length || !app.canvas.captureStream) {
            toast(message("shell.exportUnsupported"));
            return;
        }
        completed = null;
        const generation = ++dialogGeneration;
        app.modalOpen(message("shell.exportTitle"), `<p class="modal-copy">${text("shell.exportDescription")}</p><div class="modal-field"><label for="exportFormat">${text("shell.fileFormat")}</label><select id="exportFormat">${types.map((t, i) => `<option value="${i}">${t.label}</option>`).join('')}</select></div><div class="modal-field"><label for="exportQuality">${text("shell.resolution")}</label><select id="exportQuality"><option value="720" ${mark("shell.quality720")}>${t("shell.quality720")}</option><option value="1080" selected ${mark("shell.quality1080")}>${t("shell.quality1080")}</option></select></div><div class="modal-field"><label><input type="checkbox" id="exportIncludeCaptions" checked> ${text("shell.exportIncludeCaptions")}</label></div><div class="modal-field"><label><input type="checkbox" id="exportIncludeAudio" checked> ${text("shell.exportIncludeAudio")}</label></div><div class="modal-field"><span>${text("shell.videoLength")}</span><strong>${fmt(app.duration() / app.state.speed)}</strong></div><div class="notice">${text("shell.exportNotice")}</div>`, `<div class="modal-foot"><button class="button" id="cancelExportDialog">${text("shell.cancel")}</button><button class="button primary" id="startExport">${text("shell.exportVideo")}</button></div>`);
        const start = $('#startExport'), include = $('#exportIncludeCaptions'), audio = $('#exportIncludeAudio');
        include.checked = audio.checked = true;
        const current = () => generation === dialogGeneration && modal.open && $('#startExport') === start;
        $('#cancelExportDialog').onclick = () => { if (current()) { ++dialogGeneration; modal.close(); } };
        start.onclick = event => {
            if (!current() || event?.isComposing || event?.keyCode === 229) return;
            return startExport(types[+$('#exportFormat').value], +$('#exportQuality').value, { includeCaptions: include.checked, includeAudio: audio.checked });
        };
    }

    async function startExport(type, quality, options = {}) {
        if (app.mediaBlocked() || app.exporting || app.audioRecording.current || app.audioRecording.requesting || app.loadingMedia || app.transcribing)
            return;
        ++dialogGeneration;
        completed = null;
        app.pause();
        const request = videoExport.begin(options);
        try {
            app.exporting = true;
            const details = { name: app.state.name, filename: `${app.state.name || 'moment-shorts'}.${type.ext}`,
                quality, extension: type.ext, duration: app.duration() / app.state.speed };
            app.exportCancelled = false;
            body().classList.add('exporting');
            // Preparation can wait on audio, fonts or seeking. Keep cancellation reachable
            // before those native promises settle; late continuations lose this request.
            const cancel = () => {
                if (request === videoExport.request)
                    stopExport(true);
            };
            modal.innerHTML = `<div class="modal-head"><h2 id="modalTitle">${text("shell.exportPreparing")}</h2></div><button class="button full" id="cancelRunningExport">${text("shell.exportCancel")}</button>`;
            $('#cancelRunningExport').onclick = cancel;
            await app.ensureAudio();
            if (request !== videoExport.request)
                return;
            await fontsReady();
            if (request !== videoExport.request)
                return;
            if (app.mediaBlocked()) {
                stopExport(true);
                return;
            }
            videoExport.createSurface(app.state.ratio, quality);
            app.seekTo(0);
            if (app.state.kind === 'video')
                await app.seekVideo(app.state.clips[0].start);
            if (request !== videoExport.request)
                return;
            if (app.mediaBlocked()) { stopExport(true); return; }
            app.draw();
            const recorder = videoExport.capture(request, type, quality, app.playback.destination.stream, {
                onError: () => {
                    stopExport(true);
                    toast(message("shell.exportError"));
                },
                onStop: blob => {
                    app.pause();
                    cleanupExport(request);
                    if (!blob.size) {
                        modal.close();
                        toast(message("shell.exportEmpty"));
                        return;
                    }
                    showCompleted({ ...details, blob });
                },
            });
            modal.innerHTML = `<div class="modal-head"><h2 id="modalTitle">${text("shell.exportRunning")}</h2><strong id="exportPercent">0%</strong></div><p class="modal-copy">${text("shell.exportKeepOpen")}</p><div class="progress" id="exportProgressStatus" role="progressbar" aria-labelledby="modalTitle" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="exportProgress"></i></div><button class="button full" id="cancelRunningExport">${text("shell.exportCancel")}</button>`;
            $('#cancelRunningExport').onclick = cancel;
            recorder.start(250);
            await app.play();
        }
        catch {
            if (request !== videoExport.request)
                return;
            stopExport(true);
            toast(message("shell.exportStartFailed"));
        }
    }

    function stopExport(cancelled) {
        if (!app.exporting)
            return;
        app.exportCancelled = cancelled;
        app.pause();
        const request = videoExport.request, recorder = videoExport.recorder;
        if (cancelled) {
            // Invalidate before stop: even synchronous or retained callbacks no longer own the UI/resources.
            cleanupExport(request);
            try {
                if (recorder && recorder.state !== 'inactive')
                    recorder.stop();
            }
            catch {
            }
            modal.close();
            toast(message("shell.exportCancelled"));
        }
        else if (recorder) {
            // An inactive recorder may still owe its final dataavailable and stop events.
            try {
                if (recorder.state !== 'inactive')
                    recorder.stop();
            }
            catch {
                cleanupExport(request);
                modal.close();
                toast(message("shell.exportFinishFailed"));
            }
        }
        else
            cleanupExport(request);
    }

    function cleanupExport(request) {
        videoExport.release(request);
    }

    return { supportedTypes, exportDialog, startExport, stopExport, cleanupExport };
}
