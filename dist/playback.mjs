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
    let audioCtx, videoNode, audioNode, videoGain, audioGain, destination;
    let audioGraphReady = false;

    function paint(target, width, height) {
        const state = app.state, current = app.current;
        const pos = app.locate(current), clip = state.clips[pos.index];
        app.composition.draw(target, width, height, state, {
            source: state.kind === 'demo' ? (app.sampleRaster || app.sample) : app.video,
            sw: state.kind === 'demo' ? 540 : app.video.videoWidth,
            sh: state.kind === 'demo' ? 960 : app.video.videoHeight,
            ready: state.kind === 'demo' ? app.sample.complete : app.persistence.restorePhase === 'ready' && app.video.readyState >= 2,
            sourceTime: pos.source,
            time: current / state.speed,
            total: app.duration() / state.speed,
            elapsed: (pos.source - clip.start) / state.speed,
            remaining: (clip.end - pos.source) / state.speed,
            progress: (pos.source - clip.start) / (clip.end - clip.start)
        });
    }

    function draw() {
        if (app.exporting && app.videoExport.context) {
            paint(app.videoExport.context, app.videoExport.canvas.width, app.videoExport.canvas.height);
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
        if (!audioGraphReady) {
            // Retry only unfinished setup: a media element cannot acquire a second source node.
            audioCtx ||= createAudioContext();
            destination ||= audioCtx.createMediaStreamDestination();
            videoNode ||= audioCtx.createMediaElementSource(app.video);
            audioNode ||= audioCtx.createMediaElementSource(app.audio);
            videoGain ||= audioCtx.createGain();
            audioGain ||= audioCtx.createGain();
            videoNode.connect(videoGain);
            audioNode.connect(audioGain);
            videoGain.connect(audioCtx.destination);
            audioGain.connect(audioCtx.destination);
            videoGain.connect(destination);
            audioGain.connect(destination);
            audioGraphReady = true;
        }
        await audioCtx.resume();
        app.renderInspector();
    }

    function applyVolumes(muted) {
        if (!audioGraphReady)
            return;
        videoGain.gain.value = muted ? 0 : app.state.volume;
        audioGain.gain.value = muted ? 0 : app.state.audioVolume;
    }

    function syncAudio(force = false) {
        if (app.persistence.restorePhase !== 'ready' || !app.sources.audioFile)
            return;
        const t = app.current - app.state.audioOffset;
        if (t >= 0 && t < app.audio.duration) {
            if (force || Math.abs(app.audio.currentTime - t) > .25)
                app.audio.currentTime = t;
            if (app.playing && app.audio.paused)
                app.audio.play().catch(() => {
                });
        }
        else
            app.audio.pause();
    }

    function seekTo(t) {
        app.current = clamp(t, 0, app.duration());
        const pos = app.locate(app.current);
        if (app.persistence.restorePhase === 'ready' && app.state.kind === 'video' && Number.isFinite(app.video.duration))
            app.video.currentTime = Math.min(app.video.duration - .001, pos.source);
        syncAudio(true);
        app.updateTime();
        app.updateLayerGuide();
        app.draw();
        if (app.panel === 'text')
            app.renderPanel();
    }

    async function play() {
        if (app.recoveryBlocked() || app.playing)
            return;
        const request = ++app.playRequest;
        if (app.current >= app.duration() - .03)
            seekTo(0);
        try {
            await app.ensureAudio();
            if (request !== app.playRequest || app.recoveryBlocked())
                return;
            if (app.state.kind === 'video') {
                const pos = app.locate(app.current);
                if (Math.abs(app.video.currentTime - pos.source) > .08)
                    await app.seekVideo(pos.source);
                if (request !== app.playRequest)
                    return;
                app.video.playbackRate = app.state.speed;
                await app.video.play();
            }
            if (request !== app.playRequest)
                return;
            app.playing = true;
            app.lastTick = clock();
            app.lastDrawTime = -Infinity;
            syncAudio(true);
            app.query('#playButton').innerHTML = icon('pause');
            app.query('#playButton').setAttribute('aria-label', '일시정지');
            if (app.frameHandle)
                cancelFrame(app.frameHandle);
            app.frameHandle = requestFrame(tick);
        }
        catch {
            if (request !== app.playRequest)
                return;
            if (app.exporting)
                app.stopExport(true);
            app.toast('재생할 수 없습니다. 영상 형식과 오디오 장치를 확인하세요.');
        }
    }

    function pause() {
        ++app.playRequest;
        app.playing = false;
        app.cardPlaybackEnd = null;
        if (app.frameHandle)
            cancelFrame(app.frameHandle);
        app.frameHandle = 0;
        app.video.pause();
        app.audio.pause();
        app.query('#playButton').innerHTML = icon('play');
        app.query('#playButton').setAttribute('aria-label', '재생');
    }

    function tick(now) {
        app.frameHandle = 0;
        if (!app.playing)
            return;
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
                        app.video.play().catch(() => {
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
        if (state.kind === 'video' && app.video.seeking)
            app.audio.pause();
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
            pause();
            app.updateTime();
            if (app.exporting)
                app.stopExport(false);
        }
        else
            app.frameHandle = requestFrame(tick);
    }

    function seekVideo(time) {
        return new Promise((resolve, reject) => {
            const timeout = setTimer(() => {
                app.video.removeEventListener('seeked', done);
                reject(new Error('영상 탐색 시간 초과'));
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
        app.canvas.width = w / h >= 1 ? 960 : 540;
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
        play, pause, tick, seekVideo, resizePreview,
        get destination() { return destination; },
    };
}
