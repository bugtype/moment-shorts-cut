import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Native metadata/seek completion is controlled; loader, playback and bindings are real.
async function fixture() {
  const f = await createAppFixture(), events = new Map(), urls = new Map(), seeks = [], played = [];
  const video = f.element('#sourceVideo');
  let nativeTime = 0, source, prepared = 0;
  video.addEventListener = (name, callback) => {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(callback);
  };
  video.removeEventListener = (name, callback) => events.get(name)?.delete(callback);
  const emit = name => { for (const callback of [...events.get(name) || []]) callback(); };
  Object.defineProperty(video, 'currentTime', { configurable: true,
    get: () => nativeTime,
    set(time) { nativeTime = time; video.seeking = true; seeks.push({ file: source.name, time }); },
  });
  Object.defineProperty(video, 'src', { configurable: true,
    get: () => source?.name || '',
    set(url) {
      source = urls.get(url); video.duration = source.duration; nativeTime = 0;
      video.seeking = false; video.paused = true;
      video.readyState = source.name === 'old.mp4' ? 4 : 1;
      if (source.name === 'old.mp4') queueMicrotask(() => emit('loadeddata'));
    },
  });
  video.play = async () => {
    assert.ok(video.readyState >= 2, 'native play is not resolved before loadeddata');
    video.paused = false; played.push(source.name);
  };
  video.pause = () => { video.paused = true; };
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    element.toDataURL = () => 'data:synthetic-thumbnail';
    return element;
  };
  f.context.URL = {
    createObjectURL: file => { const url = `blob:${urls.size}`; urls.set(url, file); return url; },
    revokeObjectURL() {},
  };
  f.context.prepareAudio = async () => { prepared++; };
  vm.runInContext(`
    state = initial(); state.kind = 'video'; state.fileName = 'old.mp4';
    state.clips = [{start:8,end:12}]; current = 1; timelineCache = null;
    sources.videoFile = {name:'old.mp4',type:'video/mp4',size:100,duration:12};
    ensureAudio = prepareAudio; projectStore.setMedia = async () => {}; bindUi(app);
  `, f.context);
  await vm.runInContext('sources.setVideoFile(sources.videoFile)', f.context);
  nativeTime = 9; video.seeking = false;
  return { ...f, video, emit, seeks, played, prepared: () => prepared,
    loaded() { video.readyState = 4; emit('loadeddata'); },
    seeked() { video.seeking = false; emit('seeked'); },
  };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const importVideo = (f, duration = 24) => vm.runInContext(
  `loadVideo({name:'new.mp4',type:'video/mp4',size:100,duration:${duration}})`, f.context);
const snapshot = f => f.evaluate('({state,history,future,current,selected})');

for (const entry of ['button', 'space']) {
  for (const valid of [true, false]) {
    test(`${entry} cannot start the candidate video under the old project during ${valid ? 'valid' : 'rejected'} import`, async () => {
      const f = await fixture(), before = snapshot(f), loading = importVideo(f, valid ? 24 : 86401);
      assert.equal(f.evaluate('loadingMedia'), true);
      assert.equal(f.video.readyState, 1);
      let pending;
      if (entry === 'button') pending = f.element('#playButton').onclick();
      else f.documentEvents.get('keydown')({ code: 'Space', key: ' ', target: f.doc.body, preventDefault() {} });
      await settle();
      assert.equal(f.video.currentTime, 0, 'the old source coordinate must not seek the candidate');
      assert.equal(f.seeks.length, 0);
      assert.equal(f.prepared(), 0);
      assert.equal(f.evaluate('playing'), false);
      f.loaded(); await loading; f.seeked(); await pending; await settle();
      assert.equal(f.evaluate('loadingMedia'), false);
      assert.equal(f.evaluate('playing'), false, 'refused Play does not turn into deferred autoplay');
      assert.deepEqual(f.played, []);
      if (valid) {
        assert.equal(f.evaluate('state.fileName'), 'new.mp4');
        assert.equal(f.evaluate('current'), 0);
        assert.equal(f.video.currentTime, 0);
      } else {
        assert.deepEqual(snapshot(f), before);
        assert.equal(f.video.currentTime, 9);
      }
      await f.element('#playButton').onclick();
      assert.equal(f.evaluate('playing'), true, 'an explicit Play after import remains available');
      assert.deepEqual(f.played, [valid ? 'new.mp4' : 'old.mp4']);
      vm.runInContext('tick(performance.now())', f.context);
      assert.equal(f.evaluate('current'), valid ? 0 : 1);
      vm.runInContext('pause()', f.context);
    });
  }
}

test('an existing preview continues during audio probing, but Pause is immediate and restart waits for import', async () => {
  const f = await fixture(), listeners = new Map();
  const probe = { duration: 6,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name), removeAttribute() {}, load() {},
  };
  f.context.Audio = class { constructor() { return probe; } };
  await f.element('#playButton').onclick();
  const loading = vm.runInContext("loadAudio({name:'voice.wav',size:100})", f.context);
  assert.equal(f.evaluate('loadingMedia'), true);
  assert.equal(f.evaluate('playing'), true);
  f.video.currentTime = 10; f.seeked();
  const frame = f.evaluate('frameHandle'), callback = f.pendingFrames.get(frame);
  f.pendingFrames.delete(frame); callback(performance.now());
  assert.equal(f.evaluate('current'), 2);
  f.element('#playButton').onclick();
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.video.paused, true);
  const prepared = f.prepared();
  await f.element('#playButton').onclick();
  assert.equal(f.evaluate('playing'), false);
  assert.equal(f.prepared(), prepared);
  assert.deepEqual(f.played, ['old.mp4']);
  listeners.get('loadedmetadata')(); await loading;
  assert.equal(f.evaluate('state.audioName'), 'voice.wav');
  assert.equal(f.evaluate('loadingMedia'), false);
  await f.element('#playButton').onclick();
  assert.equal(f.evaluate('playing'), true);
  vm.runInContext('pause()', f.context);
});

for (const stage of ['audio', 'native-play']) {
  test(`play already waiting on ${stage} before video import cannot resume into the replacement`, async () => {
    const f = await fixture();
    let resume;
    const gate = new Promise(resolve => { resume = resolve; });
    if (stage === 'audio') {
      f.context.pendingAudio = () => gate;
      vm.runInContext('ensureAudio = pendingAudio;', f.context);
    } else f.video.play = () => { f.video.paused = false; return gate; };
    const pending = f.element('#playButton').onclick();
    await settle();
    const loading = importVideo(f);
    f.loaded(); await loading;
    resume(); await pending;
    assert.equal(f.evaluate('state.fileName'), 'new.mp4');
    assert.equal(f.evaluate('current'), 0);
    assert.equal(f.evaluate('playing'), false);
    assert.equal(f.evaluate('frameHandle'), 0);
    assert.equal(f.video.paused, true);
    assert.deepEqual(f.played, []);
  });
}
