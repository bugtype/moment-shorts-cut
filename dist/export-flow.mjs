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
        if (app.recoveryBlocked() || app.exporting)
            return;
        if (app.audioRecording.requesting || app.loadingMedia || app.audioRecording.current || app.transcribing) {
            toast('파일 로드, 녹음 또는 자막 인식을 먼저 완료해 주세요.');
            return;
        }
        app.pause();
        const types = supportedTypes();
        if (!types.length || !app.canvas.captureStream) {
            toast('이 브라우저는 영상 내보내기를 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어주세요.');
            return;
        }
        app.modalOpen('쇼츠를 완성할 시간', `<p class="modal-copy">타이틀, 자막, 구간별 문구, 움직임과 오디오를 하나의 영상으로 저장합니다.</p><div class="modal-field"><label for="exportFormat">파일 형식</label><select id="exportFormat">${types.map((t, i) => `<option value="${i}">${t.label}</option>`).join('')}</select></div><div class="modal-field"><label for="exportQuality">해상도</label><select id="exportQuality"><option value="720">720p · 빠른 저장</option><option value="1080" selected>1080p · 고화질</option></select></div><div class="modal-field"><span>영상 길이</span><strong>${fmt(app.duration() / app.state.speed)}</strong></div><div class="notice">영상 길이만큼 실시간으로 저장합니다. 이 탭을 켜두세요. 지원 형식은 브라우저에 따라 다릅니다.</div>`, '<div class="modal-foot"><button class="button" id="cancelExportDialog">취소</button><button class="button primary" id="startExport">영상 내보내기</button></div>');
        $('#cancelExportDialog').onclick = () => modal.close();
        $('#startExport').onclick = () => startExport(types[+$('#exportFormat').value], +$('#exportQuality').value);
    }

    async function startExport(type, quality) {
        if (app.recoveryBlocked() || app.exporting || app.audioRecording.current || app.audioRecording.requesting || app.loadingMedia || app.transcribing)
            return;
        app.pause();
        const request = videoExport.begin();
        try {
            app.exporting = true;
            app.exportCancelled = false;
            body().classList.add('exporting');
            await app.ensureAudio();
            if (request !== videoExport.request)
                return;
            await fontsReady();
            if (request !== videoExport.request)
                return;
            if (app.recoveryBlocked()) {
                stopExport(true);
                return;
            }
            videoExport.createSurface(app.state.ratio, quality);
            app.seekTo(0);
            if (app.state.kind === 'video')
                await app.seekVideo(app.state.clips[0].start);
            if (request !== videoExport.request)
                return;
            app.draw();
            const recorder = videoExport.capture(request, type, quality, app.playback.destination.stream, {
                onError: () => {
                    stopExport(true);
                    toast('영상 저장 중 오류가 발생했습니다. 더 낮은 해상도로 다시 시도하세요.');
                },
                onStop: blob => {
                    app.pause();
                    cleanupExport(request);
                    if (!blob.size) {
                        toast('출력 파일이 비어 있습니다. 다시 시도해 주세요.');
                        return;
                    }
                    app.download(blob, `${app.state.name || 'moment-shorts'}.${type.ext}`);
                    modal.innerHTML = `<div class="modal-head"><h2>당신의 쇼츠가 완성됐어요.</h2></div><p class="modal-copy">${esc(app.state.name)}<br>${quality}p · ${type.ext.toUpperCase()} · ${fmt(app.duration() / app.state.speed)}</p><div class="notice">다운로드한 파일을 재생해 영상과 자막을 확인한 뒤 YouTube에 업로드하세요.</div><div class="modal-foot"><button class="button primary" id="exportDone">편집으로 돌아가기</button></div>`;
                    $('#exportDone').onclick = () => modal.close();
                },
            });
            modal.innerHTML = '<div class="modal-head"><h2>순간을 담는 중…</h2><strong id="exportPercent">0%</strong></div><p class="modal-copy">이 탭을 열어두면 완성된 영상이 다운로드됩니다.</p><div class="progress"><i id="exportProgress"></i></div><button class="button full" id="cancelRunningExport">내보내기 취소</button>';
            $('#cancelRunningExport').onclick = () => {
                if (request === videoExport.request)
                    stopExport(true);
            };
            app.muted = false;
            app.renderInspector();
            recorder.start(250);
            await app.play();
        }
        catch {
            if (request !== videoExport.request)
                return;
            stopExport(true);
            toast('내보내기를 시작하지 못했습니다. 브라우저와 영상 형식을 확인하세요.');
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
            toast('내보내기를 취소했습니다.');
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
                toast('영상 저장을 마무리하지 못했습니다. 다시 시도해 주세요.');
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
