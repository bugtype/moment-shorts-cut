import {message, setAttr} from './i18n.mjs';
import { icon } from './ui-format.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Owns the preview clock, media-element synchronization, audio graph and canvas painting.
// Project state and UI actions stay in the app through the `app` accessors.
export function createPlayback(app, {
    requestFrame = callback => requestAnimationFrame(callback),
    cancelFrame = id => cancelAnimationFrame(id),
    createAudioContext = () => new AudioContext(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
    clock = () => performance.now(),
} = {}) {
    let audioCtx, videoNode, audioNode, videoGain, audioGain, monitorGain, destination;
    let audioGraphReady = false;
    let audioPlayRequest = 0;
    let loopPreview = false, pendingRestart = null;
    const canLoop = owner => loopPreview && app.editorReady && !app.exporting && !app.loadingMedia &&
        !app.transcribing && !app.document.hidden && !app.modal.open && app.mediaReady() &&
        !app.audioRecording.requesting && !app.audioRecording.current && (!owner ||
            (app.state === owner.project && app.sources.videoFile === owner.video && app.sources.audioFile === owner.audio &&
             app.state.speed === owner.speed && JSON.stringify(app.state.clips) === owner.clips));
    function setLoopPreview(value) {
        loopPreview = !!value;
        if (!loopPreview && pendingRestart) pause();
    }

    function paint(target, width, height, options) {
        const state = app.state, current = app.current;
        const pos = app.locate(current), clip = state.clips[pos.index];
        app.composition.draw(target, width, height, state, {
            source: state.kind === 'demo' ? (app.sampleRaster || app.sample) : app.video,
            sw: state.kind === 'demo' ? 540 : app.video.videoWidth,
            sh: state.kind === 'demo' ? 960 : app.video.videoHeight,
            ready: state.kind === 'demo' ? app.sample.complete : app.mediaReady() && app.video.readyState >= 2,
            sourceTime: pos.source,
            time: current / state.speed,
            total: app.duration() / state.speed,
            elapsed: (pos.source - clip.start) / state.speed,
            remaining: (clip.end - pos.source) / state.speed,
            progress: (pos.source - clip.start) / (clip.end - clip.start)
        }, options);
    }

    function draw() {
        if (app.exporting && app.videoExport.context) {
            paint(app.videoExport.context, app.videoExport.canvas.width, app.videoExport.canvas.height, app.videoExport.renderOptions);
            app.ctx.drawImage(app.videoExport.canvas, 0, 0, app.canvas.width, app.canvas.height);
        }
        else
            paint(app.ctx, app.canvas.width, app.canvas.height);
    }

    function requestDraw() {
        if (app.playing || app.paintHandle)
            return;
        app.paintHandle = requestFrame(() => {
            app.paintHandle = 0;
            app.draw();
        });
    }

    async function ensureAudio() {
        // Cold silent demos need no graph; partial setup and exports still do.
        if (!audioGraphReady && (audioCtx || app.state.kind !== 'demo' || app.sources.audioFile || app.exporting)) {
            // Retry only unfinished setup: a media element cannot acquire a second source node.
            audioCtx ||= createAudioContext();
            destination ||= audioCtx.createMediaStreamDestination();
            videoNode ||= audioCtx.createMediaElementSource(app.video);
            audioNode ||= audioCtx.createMediaElementSource(app.audio);
            videoGain ||= audioCtx.createGain();
            audioGain ||= audioCtx.createGain();
            monitorGain ||= audioCtx.createGain();
            // Set the mix and speaker mute before exposing any newly connected audio path.
            applyVolumes(app.muted);
            videoNode.connect(videoGain);
            audioNode.connect(audioGain);
            videoGain.connect(monitorGain);
            audioGain.connect(monitorGain);
            monitorGain.connect(audioCtx.destination);
            videoGain.connect(destination);
            audioGain.connect(destination);
            audioGraphReady = true;
        }
        applyVolumes(app.muted);
        await audioCtx?.resume();
        app.renderInspector();
    }

    function applyVolumes(muted) {
        if (videoGain) videoGain.gain.value = app.state.volume;
        if (audioGain) audioGain.gain.value = app.state.audioVolume;
        if (monitorGain) monitorGain.gain.value = muted ? 0 : 1;
    }

    function syncAudio(force = false) {
        if (!app.mediaReady() || !app.sources.audioFile)
            return;
        const t = app.current - app.state.audioOffset;
        if (t >= 0 && t < app.audio.duration) {
            if (force || Math.abs(app.audio.currentTime - t) > .25)
                app.audio.currentTime = t;
            if (app.playing && app.audio.paused) {
                const request = app.playRequest, audioRequest = ++audioPlayRequest;
                app.audio.play().catch(() => {
                    if (request !== app.playRequest || audioRequest !== audioPlayRequest ||
                        (app.exporting && !app.videoExport.renderOptions.includeAudio))
                        return;
                    stopAndReportPlaybackError();
                });
            }
        }
        else
            pauseAudio();
    }

    function pauseAudio() {
        // Seeking and offset waits can intentionally reject a pending native play.
        ++audioPlayRequest;
        app.audio.pause();
    }

    function seekTo(t, automatic = false) {
        if (pendingRestart && !automatic) pause();
        app.current = clamp(t, 0, app.duration());
        const pos = app.locate(app.current);
        if (app.mediaReady() && app.state.kind === 'video' && Number.isFinite(app.video.duration))
            app.video.currentTime = Math.min(app.video.duration - .001, pos.source);
        syncAudio(true);
        app.updateTime();
        app.updateLayerGuide();
        app.draw();
        if (app.panel === 'text' && !automatic)
            app.renderPanel();
    }

    function stopAndReportPlaybackError() {
        if (app.exporting)
            app.stopExport(true);
        else
            pause();
        app.toast(message('shell.playError'));
    }

    function stopForAudioError() {
        if (!app.sources.audioFile || !app.audio.error ||
            (app.exporting && !app.videoExport.renderOptions.includeAudio))
            return false;
        const end = app.exporting || app.cardPlaybackEnd == null ? app.duration() :
            Math.min(app.duration(), app.cardPlaybackEnd * app.state.speed);
        // A known failure with unavailable duration has no trustworthy natural tail.
        const length = app.audio.duration > 0 ? app.audio.duration : Infinity;
        if (!(Math.max(app.current, app.state.audioOffset) < Math.min(end, app.state.audioOffset + length)))
            return false;
        stopAndReportPlaybackError();
        return true;
    }

    async function play(automatic = null) {
        if (app.loadingMedia || app.mediaBlocked() || app.playing)
            return;
        if (!automatic) pendingRestart = null; // A manual Play now owns its own async request.
        const request = ++app.playRequest;
        const owns = () => request === app.playRequest && (!automatic || (pendingRestart === automatic && canLoop(automatic)));
        const stale = () => { if (automatic && request === app.playRequest) pause(); };
        try {
            if (!owns()) { stale(); return; }
            if (app.current >= app.duration() - .03) seekTo(0, !!automatic);
            if (stopForVideoError() || stopForAudioError()) return;
            await app.ensureAudio();
            if (!owns()) { stale(); return; }
            if (app.mediaBlocked()) {
                if (app.exporting) app.stopExport(true);
                else pause();
                return;
            }
            if (stopForVideoError()) return;
            if (app.state.kind === 'video') {
                const pos = app.locate(app.current);
                if (Math.abs(app.video.currentTime - pos.source) > .08 || (automatic && app.video.seeking))
                    await app.seekVideo(pos.source);
                if (!owns()) { stale(); return; }
                if (app.mediaBlocked()) {
                    if (app.exporting) app.stopExport(true);
                    else pause();
                    return;
                }
                if (stopForVideoError()) return;
                app.video.playbackRate = app.state.speed;
                await app.video.play();
            }
            if (!owns()) { stale(); return; }
            if (app.mediaBlocked()) {
                if (app.exporting) app.stopExport(true);
                else pause();
                return;
            }
            if (stopForVideoError() || stopForAudioError()) return;
            pendingRestart = null;
            app.playing = true;
            app.lastTick = clock();
            app.lastDrawTime = -Infinity;
            syncAudio(true);
            app.query('#playButton').innerHTML = icon('pause');
            setAttr(app.query('#playButton'), 'aria-label', 'shell.pause');
            if (app.frameHandle)
                cancelFrame(app.frameHandle);
            app.frameHandle = requestFrame(tick);
        }
        catch {
            if (!owns()) { stale(); return; }
            if (automatic) pause();
            if (app.exporting)
                app.stopExport(true);
            app.toast(message('shell.playError'));
        }
    }

    function pause() {
        pendingRestart = null;
        ++app.playRequest;
        app.playing = false;
        app.cardPlaybackEnd = null;
        if (app.frameHandle)
            cancelFrame(app.frameHandle);
        app.frameHandle = 0;
        app.video.pause();
        pauseAudio();
        app.query('#playButton').innerHTML = icon('play');
        setAttr(app.query('#playButton'), 'aria-label', 'shell.play');
    }

    function handleVideoError() {
        if (app.playing) stopForVideoError();
    }

    function stopForVideoError() {
        if (app.state.kind !== 'video' || !app.video.error)
            return false;
        stopAndReportPlaybackError();
        return true;
    }

    function tick(now) {
        app.frameHandle = 0;
        if (!app.playing)
            return;
        // Check remaining pre-speed overlap before a delayed frame can skip short audio.
        if (stopForAudioError()) return;
        if (!app.mediaReady()) { app.pause(); if (app.exporting) app.stopExport(true); return; }
        const state = app.state, current = app.current;
        const old = app.locate(current);
        if (state.kind === 'video') {
            if (!app.video.seeking) {
                const clip = state.clips[old.index];
                app.current = clamp(old.offset + app.video.currentTime - clip.start, old.offset, old.offset + clip.end - clip.start);
                if (app.video.currentTime >= clip.end - .015 || app.video.ended) {
                    if (old.index + 1 < state.clips.length) {
                        app.current = old.offset + clip.end - clip.start;
                        app.video.currentTime = state.clips[old.index + 1].start;
                        const request = app.playRequest;
                        app.video.play().catch(() => {
                            // A cancelled cut must not stop a newer preview or export.
                            if (request !== app.playRequest)
                                return;
                            stopAndReportPlaybackError();
                        });
                    }
                    else
                        app.current = app.duration();
                }
            }
        }
        else
            app.current = Math.min(app.duration(), app.current + (now - app.lastTick) / 1000 * state.speed);
        app.lastTick = now;
        if (state.kind === 'video' && (app.video.seeking || app.video.readyState < 3))
            pauseAudio();
        else
            syncAudio();
        app.updateTime(false);
        const frameInterval = 1000 / 30, elapsed = now - app.lastDrawTime;
        if ((state.kind === 'demo' || !app.video.seeking) && (elapsed >= frameInterval - .1 || app.current >= app.duration())) {
            app.draw();
            // Keep the cadence's remainder instead of losing it on every display refresh.
            app.lastDrawTime = Number.isFinite(app.lastDrawTime) ? app.lastDrawTime + Math.floor((elapsed + .1) / frameInterval) * frameInterval : now;
        }
        if (app.cardPlaybackEnd != null && app.current / state.speed >= app.cardPlaybackEnd) {
            pause();
            app.updateTime();
            return;
        }
        if (app.current >= app.duration() - .001) {
            const repeat = canLoop();
            pause();
            app.updateTime();
            if (app.exporting) app.stopExport(false);
            else if (repeat) {
                pendingRestart = { project: app.state, video: app.sources.videoFile, audio: app.sources.audioFile,
                    speed: app.state.speed, clips: JSON.stringify(app.state.clips) };
                // play catches seek/audio failures; every continuation rechecks this owner.
                void play(pendingRestart);
            }
        }
        else
            app.frameHandle = requestFrame(tick);
    }

    function seekVideo(time) {
        return new Promise((resolve, reject) => {
            const timeout = setTimer(() => {
                app.video.removeEventListener('seeked', done);
                reject(Object.assign(new Error(), message('shell.seekTimeout')));
            }, 10000);
            function done() {
                clearTimer(timeout);
                app.video.removeEventListener('seeked', done);
                resolve();
            }
            if (Math.abs(app.video.currentTime - time) < .001 && app.video.readyState >= 2 && !app.video.seeking) {
                clearTimer(timeout);
                resolve();
                return;
            }
            app.video.addEventListener('seeked', done, { once: true });
            app.video.currentTime = clamp(time, 0, Math.max(0, app.video.duration - .001));
        });
    }

    function resizePreview() {
        const state = app.state;
        const [w, h] = state.ratio.split(':').map(Number);
        const width = w / h >= 1 ? 960 : 540;
        if (app.canvas.width !== width)
            app.canvas.width = width;
        // Retain one unconditional reset of the bitmap and drawing context.
        app.canvas.height = Math.round(app.canvas.width * h / w);
        const wrap = app.query('#canvasWrap'), stage = app.query('#stage');
        wrap.style.aspectRatio = `${w}/${h}`;
        const maxH = stage.clientHeight - 53, maxW = stage.clientWidth - 50;
        wrap.style.height = `${Math.max(100, Math.min(maxH, maxW * h / w, 570))}px`;
        wrap.style.width = 'auto';
        draw();
        // A ratio change moves the preview edge the open sheet sits below.
        app.syncPanelSheet?.();
    }

    return {
        paint, draw, requestDraw, ensureAudio, applyVolumes, syncAudio, seekTo,
        play, pause, handleVideoError, tick, seekVideo, resizePreview,
        get destination() { return destination; },
        get loopPreview() { return loopPreview; }, setLoopPreview,
    };
}
