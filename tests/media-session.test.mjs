import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { createMediaSources } from '../dist/media-sources.mjs';
import { createProjectPersistence } from '../dist/project-persistence.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

function element() {
  const events = new Map();
  return {
    events, duration: 12,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name),
    removeAttribute() {},
  };
}
function mediaFixture() {
  const video = element(), audio = element(), log = [];
  let timeout;
  const sources = createMediaSources({ video, audio }, {
    createURL: file => 'blob:' + file.name,
    revokeURL: url => log.push(['revoke', url]),
    createCanvas: () => ({
      getContext: () => ({ drawImage: () => log.push('draw') }),
      toDataURL: () => 'thumbnail',
    }),
    setTimer: callback => { timeout = callback; return 1; },
    clearTimer: timer => log.push(['clear', timer]),
  });
  return { sources, video, audio, log, timeout: () => timeout() };
}

test('media readiness clears listeners on success, error and timeout', async () => {
  for (const outcome of ['loadeddata', 'error', 'timeout']) {
    const f = mediaFixture(), pending = f.sources.waitForMedia(f.video, 'loadeddata', 'decode failed');
    if (outcome === 'timeout') f.timeout();
    else f.video.events.get(outcome)();
    if (outcome === 'loadeddata') await pending;
    else await assert.rejects(pending, outcome === 'error' ? /decode failed/ : /초과/);
    assert.equal(f.video.events.size, 0);
    assert.deepEqual(f.log, [['clear', 1]]);
  }
});

test('video replacement retains thumbnail creation and explicit reset releases both URLs', async () => {
  const f = mediaFixture();
  f.sources.sourceURL = 'blob:old';
  f.sources.audioURL = 'blob:audio';
  const pending = f.sources.setVideoFile({ name: 'next.mp4' });
  assert.equal(f.video.src, 'blob:next.mp4');
  f.video.events.get('loadeddata')();
  await pending;
  assert.equal(f.sources.thumbnail, 'thumbnail');
  f.sources.reset();
  assert.deepEqual(f.log.filter(Array.isArray), [
    ['revoke', 'blob:old'], ['clear', 1], ['revoke', 'blob:next.mp4'], ['revoke', 'blob:audio'],
  ]);
  assert.equal(f.sources.sourceURL, '');
  assert.equal(f.sources.audioURL, '');
  assert.equal(f.sources.thumbnail, '');
});

function persistenceFixture(raw = null) {
  let project = createDemoProject();
  const writes = [], statuses = [], timers = [];
  const sources = { videoFile: null, audioFile: null, restore: async () => {} };
  const store = { get: async () => null, setMedia: async () => {} };
  const native = { readSettings: () => raw };
  const persistence = createProjectPersistence({
    store, sources, getProject: () => project, replaceProject: next => { project = next; },
    saveStatus: (...args) => statuses.push(args), toast() {}, pause() {},
  }, {
    readSettings: key => native.readSettings(key),
    writeSettings: (key, value) => writes.push([key, value]),
    setTimer: callback => { timers.push(callback); return callback; },
    clearTimer() {},
  });
  return { persistence, sources, store, native, writes, statuses, timers, project: () => project };
}

test('restore failure retains valid settings and blocks even previously queued saves', async () => {
  const saved = createDemoProject(); saved.name = 'recoverable'; saved.audioName = 'missing.wav';
  const f = persistenceFixture(JSON.stringify(saved));
  f.sources.restore = async (project, read, stage) => {
    assert.equal(f.project(), project);
    stage('저장된 오디오 파일을 찾을 수 없습니다');
    throw new Error('missing');
  };
  await f.persistence.restore();
  assert.equal(f.persistence.restorePhase, 'failed');
  assert.equal(f.persistence.settingsUnavailable(), false);
  assert.deepEqual(f.project(), saved);
  f.persistence.scheduleSave(); f.persistence.persistMedia(); await f.persistence.saveProject(true);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.timers, []);
  assert.match(f.persistence.restoreMessage, /변경사항은 저장되지 않습니다/);
});

test('save waits for the latest queued media write and rechecks the restore lock', async () => {
  for (const failedRestore of [false, true]) {
    const f = persistenceFixture(); await f.persistence.restore();
    let releaseFirst, releaseLast;
    f.persistence.pendingSave = new Promise(resolve => { releaseFirst = resolve; });
    const saving = f.persistence.saveProject();
    f.persistence.pendingSave = new Promise(resolve => { releaseLast = resolve; });
    releaseFirst(); await Promise.resolve();
    assert.deepEqual(f.writes, []);
    if (failedRestore) {
      f.native.readSettings = () => 'invalid';
      await f.persistence.restore();
    }
    releaseLast(); await saving;
    assert.equal(f.writes.length, failedRestore ? 0 : 1);
  }
});

test('explicit media retirement resets native resources without reviving stale playback', async () => {
  // Actual app callbacks with injected load/play semantics, not native decoder or memory QA.
  for (const [action, throwing] of [['remove', null], ['reset', null], ['remove', 'audio'], ['reset', 'video'], ['reset', 'audio'], ['replace', null], ['replace', 'audio']]) {
    const f = await createAppFixture(), events = [], nodes = [], pending = [];
    const run = code => vm.runInContext(code, f.context);
    let contexts = 0, retry = false;
    const node = () => ({ connect() {}, gain: { value: 1 } });
    f.context.AudioContext = class {
      constructor() { contexts++; this.destination = {}; }
      async resume() {}
      createMediaStreamDestination() { return { stream: { getAudioTracks: () => [] } }; }
      createMediaElementSource(element) { nodes.push(element); return node(); }
      createGain() { return node(); }
    };
    f.context.URL = { revokeObjectURL: url => events.push(['revoke', url]) };
    for (const kind of ['video', 'audio']) {
      const media = f.element(kind === 'video' ? '#sourceVideo' : '#sourceAudio');
      media.setAttribute('src', `blob:${kind}`);
      media.paused = true;
      media.pause = () => { media.paused = true; events.push([kind, 'pause']); };
      media.play = () => {
        media.paused = false;
        if (retry || (kind === 'video' && action !== 'reset')) return Promise.resolve();
        return new Promise((resolve, reject) => pending.push({kind, reject}));
      };
      media.load = () => {
        events.push([kind, 'load', media.getAttribute('src'), media.paused, f.evaluate('playing')]);
        if (throwing === kind) throw new Error('Injected reset failure');
        media.readyState = 0; media.duration = NaN; media.currentTime = 0; media.playbackRate = 1;
        for (const request of pending.filter(request => request.kind === kind))
          request.reject(new DOMException('Retired source', 'AbortError'));
      };
    }
    run(`state.kind='video';state.fileName='video.mp4';state.speed=1.5;
      sources.videoFile={name:state.fileName};sources.sourceURL='blob:video';
      sources.audioFile={name:'audio.wav'};sources.audioURL='blob:audio';state.audioName='audio.wav';
      globalThis.persistCount=0;globalThis.saveCount=0;persistMedia=()=>persistCount++;scheduleSave=()=>saveCount++;
      history=[JSON.stringify(state)];future=[JSON.stringify(state)];switchPanel('audio');`);
    const started = run('play()');
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(pending.length, 1, 'the intended native play promise is pending');
    assert.equal(pending[0].kind, action === 'reset' ? 'video' : 'audio');
    const before = f.evaluate('({state,history,future,playRequest})');
    events.length = 0;
    if (action === 'remove') f.element('#removeAudio').onclick();
    else if (action === 'replace') {
      const video = f.element('#sourceVideo'), readiness = new Map();
      video.addEventListener = (name, callback) => readiness.set(name, callback);
      video.removeEventListener = name => readiness.delete(name);
      Object.defineProperty(video, 'src', { set(value) {
        this.setAttribute('src', value); this.duration = 6; this.readyState = 4;
      }});
      f.context.URL.createObjectURL = () => 'blob:replacement';
      const createElement = f.doc.createElement;
      f.doc.createElement = tag => { const element = createElement(tag); element.toDataURL = () => 'data:thumbnail'; return element; };
      const replacing = run("loadVideo({name:'replacement.mp4',type:'video/mp4',size:1})");
      readiness.get('loadeddata')();
      await replacing;
      assert.equal(readiness.size, 0);
    } else { run('confirmReset()'); f.element('#confirmReset').onclick(); }
    const retired = action === 'reset' ? ['video', 'audio'] : ['audio'];
    assert.deepEqual(events.filter(event => event[1] === 'load'), retired.map(kind => [kind, 'load', null, true, false]));
    assert.deepEqual(events.slice(0, 2), [['video', 'pause'], ['audio', 'pause']]);
    assert.deepEqual(events.filter(event => event[0] === 'revoke'), (action === 'replace' ? ['video', 'audio'] : retired).map(kind => ['revoke', `blob:${kind}`]));
    assert.equal(f.evaluate('sources.audioFile'), null);
    assert.equal(f.evaluate('state.audioName'), '');
    assert.equal(f.evaluate('persistCount'), 1); assert.equal(f.evaluate('saveCount'), 1);
    assert.ok(f.evaluate('playRequest') > before.playRequest);
    if (action === 'remove') {
      const expected = structuredClone(before.state); expected.audioName = '';
      assert.deepEqual(f.evaluate('state'), expected);
      assert.deepEqual(f.evaluate('({history,future})'), {history:before.history,future:before.future});
      assert.equal(f.element('#sourceVideo').getAttribute('src'), 'blob:video');
      assert.equal(f.element('#sourceVideo').readyState, 4);
    } else if (action === 'replace') {
      assert.equal(f.evaluate('state.kind'), 'video');
      assert.equal(f.evaluate('state.fileName'), 'replacement.mp4');
      assert.equal(f.element('#sourceVideo').getAttribute('src'), 'blob:replacement');
      assert.deepEqual(f.evaluate('({history,future})'), {history:[],future:[]});
      assert.equal(f.evaluate('sources.audioURL'), '');
    } else {
      assert.equal(f.evaluate('state.kind'), 'demo');
      assert.deepEqual(f.evaluate('({history,future})'), {history:[],future:[]});
      assert.equal(f.evaluate('sources.sourceURL'), ''); assert.equal(f.evaluate('sources.audioURL'), '');
    }
    for (const kind of retired) {
      const media = f.element(kind === 'video' ? '#sourceVideo' : '#sourceAudio');
      if (throwing !== kind) { assert.equal(media.readyState, 0); assert.ok(Number.isNaN(media.duration)); }
      assert.equal(media.playbackRate, f.evaluate('state.speed'), 'inspector restores the active project rate');
    }
    const settled = f.evaluate('({state,history,future,playing,playRequest})');
    f.element('#toast').textContent = 'Current operation';
    pending[0].reject(new DOMException('Late old request', 'AbortError'));
    await started; await Promise.resolve();
    assert.deepEqual(f.evaluate('({state,history,future,playing,playRequest})'), settled);
    assert.equal(f.element('#toast').textContent, 'Current operation');
    // The actual audio loader can attach again on the same element and warm graph.
    retry = true;
    f.context.URL.createObjectURL = () => 'blob:new-audio';
    f.context.Audio = class {
      duration = 12; listeners = new Map();
      addEventListener(name, handler) { this.listeners.set(name, handler); }
      removeEventListener(name) { this.listeners.delete(name); }
      set src(value) { queueMicrotask(() => this.listeners.get('loadedmetadata')?.()); }
      removeAttribute() {} load() {}
    };
    const audio = f.element('#sourceAudio');
    Object.defineProperty(audio, 'src', {set(value) {
      this.setAttribute('src', value); this.readyState = 4; this.duration = 12;
    }});
    await run("loadAudio({name:'new.wav',size:1})");
    assert.equal(audio.getAttribute('src'), 'blob:new-audio');
    assert.equal(f.evaluate('sources.audioFile.name'), 'new.wav');
    await run('play()');
    assert.equal(f.evaluate('playing'), true); assert.equal(contexts, 1);
    assert.deepEqual(nodes, [f.element('#sourceVideo'), f.element('#sourceAudio')]);
    run('pause()');
  }
});
