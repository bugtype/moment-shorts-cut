import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createMediaLoader } from '../dist/media-loader.mjs';
import { createMediaSources } from '../dist/media-sources.mjs';
import { createPlayback } from '../dist/playback.mjs';
import { createAppFixture } from './fixtures/app.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function nativeAudio(src = '', target = {}) {
    const listeners = new Map(), assignments = [], plays = [];
    const definition = {
        duration: 12, readyState: 4, playbackRate: 2, currentTime: 3, paused: true, error: null, resets: 0,
        get src() { return src; },
        set src(value) {
            src = value; assignments.push(value);
            this.duration = NaN; this.readyState = 0; this.playbackRate = 1;
            this.currentTime = 0; this.paused = true; this.error = null;
        },
        getAttribute: name => name === 'src' ? src || null : null,
        removeAttribute(name) { assert.equal(name, 'src'); src = ''; },
        load() { this.resets++; this.duration = NaN; this.readyState = 0; this.currentTime = 0; this.playbackRate = 1; },
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(callback);
        },
        removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
        pause() { this.paused = true; },
        async play() { this.paused = false; plays.push({time:this.currentTime, rate:this.playbackRate}); },
    };
    const element = Object.defineProperties(target, Object.getOwnPropertyDescriptors(definition));
    const emit = name => { for (const callback of [...listeners.get(name) || []]) callback(); };
    return {
        element, listeners, assignments, plays, emit,
        ready(duration = 12) { element.duration = duration; element.readyState = 2; emit('loadeddata'); },
        fail() { element.error = {code:3}; emit('error'); },
        listenerCount: () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0),
    };
}

// Real loader, media waiters and playback; only native media timing and UI ports are modeled.
function fixture(withAudio = true) {
    const native = nativeAudio(withAudio ? 'blob:old' : ''), timers = new Map(), revoked = [], messages = [], probes = [];
    const writes = [], controls = new Map();
    let nextURL = 0, timerId = 0, frameId = 0, unavailable = false;
    const query = id => {
        if (!controls.has(id)) controls.set(id, {value:'selected', setAttribute() {}});
        return controls.get(id);
    };
    const video = {pause() {}};
    const sources = createMediaSources({video, audio:native.element}, {
        setTimer(callback, delay) { assert.equal(delay, 20000); timers.set(++timerId, callback); return timerId; },
        clearTimer: id => timers.delete(id),
    });
    const oldFile = withAudio ? {name:'original.wav'} : null;
    Object.assign(sources, {audioFile:oldFile, audioURL:withAudio ? 'blob:old' : ''});
    const app = {
        state:{kind:'demo', speed:2, audioName:oldFile?.name || '', audioOffset:2, clips:[{start:0,end:12}]},
        history:['old undo'], future:['old redo'], current:5, panel:'settings', selected:0,
        loadingMedia:false, exporting:false, transcribing:false, playing:false, playRequest:0, frameHandle:0,
        audioRecording:{requesting:false, current:null}, video, audio:native.element, sources, query,
        recoveryBlocked: () => unavailable, mediaBlocked: () => false, mediaReady: () => true,
        duration: () => 12, locate: time => ({index:0, source:time, offset:0}),
        ensureAudio: async () => {}, renderInspector() {}, updateTime() {}, updateLayerGuide() {}, draw() {},
        persistMedia: () => writes.push('media'), changed: () => { native.element.playbackRate = app.state.speed; writes.push('settings'); },
        renderPanel() {}, toast: value => messages.push(value),
    };
    app.playback = createPlayback(app, {requestFrame: () => ++frameId, cancelFrame() {}, clock: () => 0});
    app.pause = () => app.playback.pause();
    const loader = createMediaLoader(app, {
        createObjectURL: () => 'blob:candidate-' + ++nextURL,
        revokeObjectURL: url => revoked.push(url),
        createAudio: () => { const probe = nativeAudio(); probes.push(probe); return probe.element; },
    });
    return {
        app, loader, native, sources, oldFile, timers, revoked, writes, messages, probes,
        block: () => { unavailable = true; },
        snapshot: () => JSON.stringify({state:app.state,history:app.history,future:app.future,current:app.current}),
        async probe() { const probe = probes.at(-1); probe.element.duration = 12; probe.emit('loadedmetadata'); await settle(); },
        expire() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); },
        empty() { assert.equal(timers.size, 0); assert.equal(native.listenerCount(), 0); assert.ok(probes.every(probe => !probe.listenerCount())); },
    };
}
const candidate = {name:'replacement.wav', size:100};

test('audio adoption waits for the actual source so first explicit playback starts at zero', async () => {
    for (const withAudio of [false, true]) {
        const f = fixture(withAudio), before = f.snapshot();
        const pending = f.loader.loadAudio(candidate);
        await f.probe();
        assert.equal(f.app.loadingMedia, true);
        assert.equal(f.native.element.readyState, 0);
        assert.ok(Number.isNaN(f.native.element.duration));
        assert.equal(f.snapshot(), before);
        assert.equal(f.sources.audioFile, f.oldFile);
        assert.deepEqual(f.writes, []); assert.deepEqual(f.revoked, []);
        const probes = f.probes.length;
        await f.loader.loadAudio({name:'duplicate.wav',size:1});
        assert.equal(f.probes.length, probes, 'a second import cannot replace the pending attachment');
        await f.app.playback.play(); f.app.playback.tick(500);
        assert.equal(f.app.playing, false); assert.equal(f.app.current, 5);
        assert.deepEqual(f.native.plays, []);

        f.native.ready(); await pending;
        assert.equal(f.app.loadingMedia, false);
        assert.equal(f.sources.audioFile, candidate);
        assert.equal(f.sources.audioURL, 'blob:candidate-1');
        assert.equal(f.app.state.audioName, candidate.name); assert.equal(f.app.state.audioOffset, 0);
        assert.deepEqual(f.writes, ['media','settings']);
        assert.deepEqual(f.revoked, withAudio ? ['blob:old'] : []);
        f.app.current = 0;
        await f.app.playback.play();
        assert.deepEqual(f.native.plays, [{time:0,rate:2}]);
        f.app.pause(); f.empty();
    }
});

test('attachment errors, timeouts and invalid durations preserve the old project and permit retry', async () => {
    for (const withAudio of [false, true]) for (const outcome of ['error','timeout','duration']) {
        const f = fixture(withAudio), before = f.snapshot();
        const pending = f.loader.loadAudio(candidate);
        await f.probe();
        if (outcome === 'error') f.native.fail();
        else if (outcome === 'timeout') f.expire();
        else f.native.ready(0);
        await settle();
        assert.equal(f.snapshot(), before);
        assert.deepEqual(f.writes, []);
        assert.equal(f.sources.audioFile, f.oldFile);
        if (withAudio) {
            assert.equal(f.app.loadingMedia, true, 'rollback also owns the busy lock');
            assert.equal(f.native.element.src, 'blob:old');
            assert.deepEqual(f.revoked, []);
            f.app.current = 7; f.app.state.audioOffset = 1;
            f.native.ready();
        }
        await pending;
        assert.equal(f.app.loadingMedia, false);
        assert.equal(f.sources.audioURL, withAudio ? 'blob:old' : '');
        assert.equal(f.native.element.src, withAudio ? 'blob:old' : '');
        assert.deepEqual(f.revoked, ['blob:candidate-1']);
        assert.equal(f.messages.length, 1);
        assert.equal(f.messages[0].messageKey, outcome === 'timeout' ? 'errors.fileTimeout' : 'errors.audioFormat');
        if (withAudio) {
            assert.equal(f.native.element.currentTime, 6, 'rollback follows the latest playhead and offset');
            assert.equal(f.native.element.playbackRate, 2);
        } else assert.equal(f.native.element.resets, 1);
        assert.deepEqual(f.writes, []); f.empty();

        const retry = f.loader.loadAudio(candidate);
        await f.probe(); f.native.ready(Infinity); await retry;
        assert.equal(f.sources.audioFile, candidate);
        assert.equal(f.app.state.audioOffset, 0); assert.equal(f.app.loadingMedia, false);
        assert.deepEqual(f.writes, ['media','settings']); f.empty();
    }
});

test('lost recording or recovery authority during attachment rolls back without publishing', async () => {
    for (const reason of ['recording','recovery']) {
        const f = fixture(), owner = {state:'inactive'}, before = f.snapshot();
        if (reason === 'recording') f.app.audioRecording.current = owner;
        const pending = f.loader.loadAudio(candidate, reason === 'recording' ? owner : null);
        await f.probe();
        if (reason === 'recording') f.app.audioRecording.current = {state:'inactive'};
        else f.block();
        f.native.ready(); await settle();
        assert.equal(f.native.element.src, 'blob:old'); assert.equal(f.app.loadingMedia, true);
        f.native.ready(); await pending;
        assert.equal(f.snapshot(), before); assert.equal(f.sources.audioFile, f.oldFile);
        assert.deepEqual(f.writes, []); assert.deepEqual(f.revoked, ['blob:candidate-1']);
        assert.deepEqual(f.messages, []); assert.equal(f.app.loadingMedia, false); f.empty();
    }
});

test('a failed native rollback keeps the original diagnostic and releases the candidate and lock', async () => {
    const f = fixture(), before = f.snapshot();
    const pending = f.loader.loadAudio(candidate);
    await f.probe(); f.expire(); await settle();
    assert.equal(f.native.element.src, 'blob:old');
    f.native.fail(); await pending;
    assert.equal(f.snapshot(), before); assert.equal(f.sources.audioFile, f.oldFile);
    assert.equal(f.sources.audioURL, 'blob:old'); assert.equal(f.app.loadingMedia, false);
    assert.deepEqual(f.revoked, ['blob:candidate-1']); assert.deepEqual(f.writes, []);
    assert.equal(f.messages.length, 1); assert.equal(f.messages[0].messageKey, 'errors.fileTimeout'); f.empty();
});

test('actual Play and Export controls remain blocked until the attached audio is ready', async () => {
    const f = await createAppFixture(), writes = [], probes = [];
    const native = nativeAudio('', f.element('#sourceAudio'));
    f.context.Audio = class { constructor() { const probe = nativeAudio(); probes.push(probe); return probe.element; } };
    f.context.URL = {createObjectURL: () => 'blob:attached-audio', revokeObjectURL() {}};
    f.context.recordAudioWrite = kind => writes.push(kind);
    vm.runInContext('current=0;persistMedia=()=>recordAudioWrite("media");scheduleSave=()=>recordAudioWrite("settings");ensureAudio=async()=>{};', f.context);
    const pending = f.element('#audioInput').onchange({target:{files:[candidate],value:'selected'}});
    probes[0].element.duration = 12; probes[0].emit('loadedmetadata'); await settle();
    assert.equal(f.evaluate('loadingMedia'), true);
    await f.element('#playButton').onclick();
    f.element('#exportButton').onclick();
    assert.equal(f.evaluate('playing'), false); assert.equal(f.evaluate('exporting'), false);
    assert.equal(f.evaluate('current'), 0); assert.deepEqual(native.plays, []); assert.deepEqual(writes, []);
    native.ready(); await pending;
    assert.equal(f.evaluate('loadingMedia'), false);
    assert.deepEqual(writes, ['media','settings']);
    await f.element('#playButton').onclick();
    assert.equal(f.evaluate('playing'), true);
    assert.equal(native.plays[0].time, 0);
    vm.runInContext('pause()', f.context);
});


test('removed audio is never resurrected by a failed attachment rollback', async () => {
    for (const outcome of ['error', 'timeout', 'duration']) {
        const f = await createAppFixture(), probes = [], revoked = [], writes = [], timers = new Map();
        const native = nativeAudio('blob:removed', f.element('#sourceAudio'));
        let timerId = 0, urlId = 0;
        f.context.setTimeout = (callback, delay) => { timers.set(++timerId, {callback, delay}); return timerId; };
        f.context.clearTimeout = id => timers.delete(id);
        f.context.Audio = class { constructor() { const probe = nativeAudio(); probes.push(probe); return probe.element; } };
        f.context.URL = {createObjectURL: () => 'blob:candidate-' + ++urlId, revokeObjectURL: url => revoked.push(url)};
        f.context.recordAudioWrite = kind => writes.push(kind);
        vm.runInContext("sources.audioFile={name:'removed.wav'};sources.audioURL='blob:removed';state.audioName='removed.wav';state.speed=2;persistMedia=()=>recordAudioWrite('media');scheduleSave=()=>recordAudioWrite('settings');switchPanel('audio');", f.context);
        f.element('#removeAudio').onclick();
        assert.equal(f.evaluate('sources.audioFile'), null);
        assert.equal(f.evaluate('state.audioName'), '');
        assert.equal(native.element.src, '');
        assert.deepEqual(revoked, ['blob:removed']);
        const before = f.evaluate('({state,history,future,current,selected})');
        writes.length = 0;
        const load = () => f.element('#audioInput').onchange({target:{files:[candidate],value:'selected'}});
        const readyProbe = async () => {
            probes.at(-1).element.duration = 12; probes.at(-1).emit('loadedmetadata'); await settle();
        };
        const pending = load(); await readyProbe();
        if (outcome === 'error') native.fail();
        else if (outcome === 'duration') native.ready(0);
        else {
            const timer = [...timers.values()].find(timer => timer.delay === 20000);
            assert.ok(timer); timer.callback();
        }
        await settle();
        assert.equal(f.evaluate('loadingMedia'), false, 'no second wait for an already removed source');
        await pending;
        assert.equal(native.element.src, '');
        assert.deepEqual(native.assignments, ['blob:candidate-1']);
        assert.equal(native.element.playbackRate, 2);
        assert.equal(f.evaluate('sources.audioFile'), null);
        assert.deepEqual(f.evaluate('({state,history,future,current,selected})'), before);
        assert.deepEqual(writes, []);
        assert.deepEqual(revoked, ['blob:removed', 'blob:candidate-1']);
        assert.equal(native.listenerCount(), 0);
        assert.equal([...timers.values()].some(timer => timer.delay === 20000), false);
        assert.equal(f.element('#audioInput').value, '');
        assert.equal(f.element('#toast').getAttribute('data-i18n'), outcome === 'timeout' ? 'errors.fileTimeout' : 'errors.audioFormat');
        const retry = load(); await readyProbe(); native.ready(); await retry;
        assert.equal(f.evaluate('sources.audioURL'), 'blob:candidate-2');
        assert.equal(f.evaluate('state.audioName'), candidate.name);
        assert.equal(f.evaluate('loadingMedia'), false);
        assert.deepEqual(writes, ['media', 'settings']);
    }
});
