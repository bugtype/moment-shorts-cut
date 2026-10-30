import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { createMediaStorageFixture } from './fixtures/media-storage.mjs';
import { createProjectStore } from '../dist/project-store.mjs';
import { createProjectDocument, readProjectDocument, validateProject } from '../dist/core/project.mjs';

// Native metadata and IndexedDB are simulated; loader, validation and save owners are real.
async function fixture(withVideo = false) {
  const f = await createAppFixture(), urls = new Map(), revoked = [], events = new Map(), timers = new Set();
  const seeks = [], pendingMetadata = [], audioResets = [], videoResets = [];
  let nextURL = 0, settingsWrites = 0, raw;
  const video = f.element('#sourceVideo'), audio = f.element('#sourceAudio');
  audio.pause = () => { audio.paused = true; };
  audio.load = () => {
    audioResets.push({ src: audio.getAttribute('src'), paused: audio.paused, playing: f.evaluate('playing') });
    audio.readyState = 0; audio.duration = NaN; audio.playbackRate = 1;
  };
  video.addEventListener = (name, callback) => events.set(name, callback);
  video.removeEventListener = name => events.delete(name);
  let source = '', selectedSource = '', nativeTime = 0, failSeek = false;
  Object.defineProperty(video, 'currentSrc', { get: () => selectedSource });
  video.load = () => {
    videoResets.push({ src: source, loading: f.evaluate('loadingMedia'), playing: f.evaluate('playing') });
    selectedSource = ''; video.readyState = 0; video.duration = NaN; nativeTime = 0;
  };
  Object.defineProperty(video, 'currentTime', { configurable: true,
    get: () => nativeTime,
    set(value) {
      if (failSeek) throw new Error('Restoring source time failed');
      nativeTime = value;
      seeks.push(value);
      queueMicrotask(() => events.get('seeked')?.());
    },
  });
  Object.defineProperty(video, 'src', { configurable: true,
    get: () => source,
    set(value) {
      source = selectedSource = value;
      video.readyState = 4;
      const file = urls.get(value);
      video.duration = file.duration;
      nativeTime = 0; // The native media load algorithm resets its source clock.
      const loaded = () => events.get(file.decodeError ? 'error' : 'loadeddata')?.();
      if (file.deferMetadata) pendingMetadata.push(loaded);
      else queueMicrotask(loaded);
    },
  });
  video.removeAttribute = name => { if (name === 'src') source = ''; };
  const createElement = f.doc.createElement;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    element.toDataURL = () => 'data:synthetic-thumbnail';
    return element;
  };
  f.context.URL = {
    createObjectURL: file => { const url = `blob:import-${++nextURL}`; urls.set(url, file); return url; },
    revokeObjectURL: url => revoked.push(url),
  };
  f.context.setTimeout = (callback, delay) => { const timer = { callback, delay }; timers.add(timer); return timer; };
  f.context.clearTimeout = timer => timers.delete(timer);
  f.context.oldVideo = withVideo ? { name: 'original.mp4', type: 'video/mp4', size: 100, duration: 12 } : null;
  f.context.oldAudio = { name: 'original.wav', size: 100, duration: 12 };
  vm.runInContext(`
    state = initial(); state.audioName = oldAudio.name;
    state.design.title.lines = ['Keep my title', '']; state.design.title.end = 3;
    sources.audioFile = oldAudio; sources.audioURL = 'blob:original-audio';
    audio.src = sources.audioURL; audio.setAttribute('src', sources.audioURL);
    if (oldVideo) {
      state.kind = 'video'; state.fileName = oldVideo.name; sources.videoFile = oldVideo;
      sources.sourceURL = URL.createObjectURL(oldVideo); video.src = sources.sourceURL; video.currentTime = 4;
    }
    history = [JSON.stringify(state)]; future = [JSON.stringify(state)]; current = 4; selected = 0;
  `, f.context);
  await Promise.resolve();
  raw = JSON.stringify(f.evaluate('state'));
  const storage = createMediaStorageFixture([
    ['audio', f.context.oldAudio], ...(withVideo ? [['video', f.context.oldVideo]] : []),
  ]);
  Object.assign(vm.runInContext('projectStore', f.context), createProjectStore(storage.factory));
  f.context.localStorage.getItem = () => raw;
  f.context.localStorage.setItem = (_key, value) => { raw = value; settingsWrites++; };
  return { ...f, video, audio, urls, revoked, events, timers, storage, seeks, pendingMetadata, audioResets, videoResets,
    failSeek: () => { failSeek = true; }, raw: () => raw, settingsWrites: () => settingsWrites };
}

const snapshot = f => f.evaluate('({state, history, future, current, selected, videoFile:sources.videoFile, audioFile:sources.audioFile, audioURL:sources.audioURL, thumbnail:sources.thumbnail})');
async function load(f, duration, options = {}) {
  f.context.candidateFile = { name: 'candidate.mp4', type: 'video/mp4', size: 100, duration, ...options };
  f.element('#videoInput').value = 'chosen-file';
  await vm.runInContext('loadVideo(candidateFile)', f.context);
}

for (const withVideo of [false, true]) {
  for (const duration of [.0005, 86401]) {
    test(`invalid duration ${duration} preserves ${withVideo ? 'video' : 'demo'} project, audio and saved data`, async () => {
      const f = await fixture(withVideo), before = snapshot(f), stored = f.raw();
      const media = structuredClone(f.storage.records);
      await load(f, duration);
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.raw(), stored);
      assert.deepEqual(f.storage.records, media);
      assert.equal(f.storage.attempts.length, 0);
      assert.equal(f.settingsWrites(), 0);
      assert.equal(f.evaluate('loadingMedia'), false);
      assert.equal(f.element('#videoInput').value, '');
      assert.equal(f.events.size, 0);
      assert.equal([...f.timers].some(timer => timer.delay === 500 || timer.delay === 20000), false);
      assert.doesNotThrow(() => validateProject(f.evaluate('state')));
      assert.doesNotThrow(() => readProjectDocument(createProjectDocument(f.evaluate('state'))));
      assert.match(f.element('#toast').textContent, /0.001.*86,?400/);
      assert.equal(f.audio.src, 'blob:original-audio');
      assert.deepEqual(f.audioResets, [], 'precommit failure does not retire the original audio');
      assert.equal(f.revoked.includes('blob:original-audio'), false);
      if (withVideo) {
        assert.deepEqual(f.videoResets, [], 'restoring an old source does not retire it');
        assert.equal(f.urls.get(f.video.src).name, 'original.mp4');
        assert.equal(f.video.duration, 12);
      } else {
        assert.equal(f.video.src, '');
        assert.equal(f.evaluate('sources.sourceURL'), '');
        assert.deepEqual(f.videoResets, [{src:'', loading:true, playing:false}]);
        assert.equal(f.video.currentSrc, '');
        assert.equal(f.video.readyState, 0); assert.ok(Number.isNaN(f.video.duration));
      }
      const rejectedURL = [...f.urls].find(([, file]) => file === f.context.candidateFile)[0];
      assert.equal(f.revoked.filter(url => url === rejectedURL).length, 1);
      assert.equal((await f.context.window.moment.execute('project.update', { patch: { name: 'Still editable' } })).ok, true);
    });
  }
}

for (const duration of [.001, 1 / 30, 12, 86400]) {
  test(`valid duration ${duration} remains importable, editable and restorable`, async () => {
    const f = await fixture(true);
    await load(f, duration);
    const project = f.evaluate('state');
    assert.equal(project.kind, 'video');
    assert.equal(project.duration, duration);
    assert.equal(project.fileName, 'candidate.mp4');
    assert.deepEqual(project.clips, [{ start: 0, end: duration }]);
    assert.deepEqual(project.design.title.lines, ['Keep my title', '']);
    assert.equal(project.design.title.end, duration / 4);
    assert.equal(project.audioName, '');
    assert.equal(f.evaluate('sources.audioFile'), null);
    assert.deepEqual(f.audioResets, [{ src: null, paused: true, playing: false }]);
    assert.equal(f.audio.readyState, 0);
    assert.equal(f.audio.playbackRate, project.speed);
    assert.deepEqual(f.evaluate('history'), []);
    assert.deepEqual(f.evaluate('future'), []);
    assert.doesNotThrow(() => validateProject(project));
    assert.match(f.element('#toast').textContent, /영상을 불러왔습니다/);
    await vm.runInContext('saveProject()', f.context);
    assert.equal(f.storage.records.get('video').name, 'candidate.mp4');
    assert.equal(f.storage.records.has('audio'), false);
    const restored = readProjectDocument({ format: 'moment-project', formatVersion: 1, project: JSON.parse(f.raw()) });
    assert.deepEqual(restored, project);
    assert.equal((await f.context.window.moment.execute('project.update', { patch: { name: 'Valid edit' } })).ok, true);
  });
}

test('retrying a valid file after rejected metadata commits only the valid replacement', async () => {
  const f = await fixture(true), original = snapshot(f);
  vm.runInContext('loadingMedia = true;', f.context);
  await load(f, 6);
  assert.deepEqual(snapshot(f), original); assert.deepEqual(f.audioResets, []);
  vm.runInContext('loadingMedia = false;', f.context);
  await load(f, 86401);
  assert.deepEqual(f.audioResets, []);
  assert.deepEqual(snapshot(f), original);
  await load(f, 6);
  await vm.runInContext('saveProject()', f.context);
  assert.equal(f.evaluate('state.duration'), 6);
  assert.equal(f.storage.attempts.length, 1);
  assert.equal(f.settingsWrites(), 1);
  assert.equal(f.storage.records.get('video').duration, 6);
  await load(f, 8); // Already-empty audio retirement is harmless on the next replacement.
  assert.equal(f.audioResets.length, 2);
  assert.equal(f.evaluate('state.duration'), 8);
  assert.equal(f.evaluate('sources.audioFile'), null);
});

test('first rejected video keeps its diagnostic if native reset throws and permits explicit retry', async () => {
  const f = await fixture(false), before = snapshot(f), stored = f.raw(), reset = f.video.load;
  let resets = 0;
  f.video.load = () => { resets++; throw new Error('Injected native reset failure'); };
  await load(f, 86401);
  assert.equal(resets, 1); assert.deepEqual(snapshot(f), before);
  assert.equal(f.raw(), stored); assert.equal(f.storage.attempts.length, 0); assert.equal(f.settingsWrites(), 0);
  assert.deepEqual(f.audioResets, []); assert.equal(f.audio.src, 'blob:original-audio');
  assert.equal(f.video.src, ''); assert.equal(f.evaluate('sources.sourceURL'), '');
  assert.equal(f.evaluate('loadingMedia'), false); assert.equal(f.element('#videoInput').value, '');
  assert.equal(f.events.size, 0);
  assert.match(f.element('#toast').textContent, /0.001.*86,?400/);
  f.video.load = reset;
  await load(f, 6); await vm.runInContext('saveProject()', f.context);
  assert.equal(f.evaluate('state.duration'), 6); assert.equal(f.video.currentSrc, f.video.src);
  assert.equal(f.video.readyState, 4); assert.deepEqual(f.videoResets, [], 'valid retry does not reset its adopted video');
  assert.equal(f.audioResets.length, 1); assert.equal(f.storage.records.get('video').duration, 6);
  assert.equal(f.storage.attempts.length, 1); assert.equal(f.settingsWrites(), 1);
});

test('valid out-of-timeline title timing is retimed on a copy, not newly restricted', async () => {
  const f = await fixture(true);
  vm.runInContext('state.design.title.end = 86400;', f.context);
  assert.doesNotThrow(() => validateProject(f.evaluate('state')));
  const original = vm.runInContext('state', f.context);
  await load(f, 24);
  assert.equal(f.evaluate('state.duration'), 24);
  assert.equal(f.evaluate('state.design.title.end'), 172800);
  assert.equal(original.design.title.end, 86400);
  assert.doesNotThrow(() => validateProject(f.evaluate('state')));
});

test('duration rejection displays the shared supported range in all three locales', async () => {
  const f = await fixture(), before = snapshot(f);
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      vm.runInContext(`setLocale('${locale}', {persist: false});`, f.context);
      await load(f, 86401);
      assert.equal(f.element('#toast').textContent, vm.runInContext("t('errors.videoDurationLimit')", f.context));
      assert.match(f.element('#toast').textContent, /0.001.*86,400/);
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.settingsWrites(), 0);
      assert.equal(f.storage.attempts.length, 0);
    }
  } finally { vm.runInContext("setLocale('ko', {persist: false});", f.context); }
});

for (const failure of ['metadata', 'decoder']) {
  for (const reordered of [false, true]) {
    test(`${failure} rejection restores the ${reordered ? 'reordered' : 'ordered'} source playhead without rebuilding draft controls`, async () => {
      const f = await fixture(true);
      vm.runInContext(`
        ${reordered ? 'state.clips = [{start: 8, end: 12}, {start: 0, end: 4}]; timelineCache = null;' : ''}
        current = 5; video.currentTime = locate(current).source;
        switchPanel('text');
      `, f.context);
      const field = f.element('#titleFirst');
      field.value = 'Uncommitted title draft'; field.focus();
      const before = snapshot(f), expectedSource = vm.runInContext('locate(current).source', f.context);
      let renders = 0;
      f.context.countPanelRender = () => renders++;
      vm.runInContext('renderPanel = countPanelRender; video.addEventListener("seeked", requestDraw);', f.context);
      await load(f, failure === 'metadata' ? 86401 : 6, { decodeError: failure === 'decoder' });
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.video.currentTime, expectedSource);
      assert.equal(renders, 0);
      assert.equal(field.value, 'Uncommitted title draft');
      assert.equal(f.doc.activeElement, field);
      assert.equal(f.storage.attempts.length, 0);
      assert.equal(f.settingsWrites(), 0);
      const frames = [];
      f.context.observePaint = (_ctx, _width, _height, _project, media) => frames.push([media.sourceTime, media.source.currentTime]);
      vm.runInContext('composition.draw = observePaint;', f.context);
      for (const [id, callback] of f.pendingFrames) { f.pendingFrames.delete(id); callback(performance.now()); }
      assert.deepEqual(frames.at(-1), [expectedSource, expectedSource]);
    });
  }
}

test('rollback follows a newer ruler seek rather than a captured old position', async () => {
  const f = await fixture(true);
  vm.runInContext('state.clips = [{start:8,end:12},{start:0,end:4}]; timelineCache = null; current = 1;', f.context);
  const originalThumbnail = f.evaluate('sources.thumbnail');
  f.context.oldVideo.deferMetadata = true;
  const pending = load(f, 86401);
  for (let i = 0; i < 8 && !f.pendingMetadata.length; i++) await Promise.resolve();
  assert.equal(f.pendingMetadata.length, 1, 'original source reload is pending');
  const ruler = f.element('#ruler');
  ruler.onclick({ currentTarget: ruler, clientX: 540 * 6 / 8 });
  assert.equal(f.evaluate('current'), 6);
  const before = snapshot(f);
  before.thumbnail = originalThumbnail;
  f.pendingMetadata.shift()();
  await pending;
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.video.currentTime, 2, 'latest timeline position maps into the second source occurrence');
  assert.equal(f.evaluate('loadingMedia'), false);
});

for (const failure of ['reload', 'seek']) {
  test(`rollback ${failure} failure cannot mask the original rejected-import diagnostic`, async () => {
    const f = await fixture(true), before = snapshot(f);
    if (failure === 'reload') f.context.oldVideo.decodeError = true;
    else f.failSeek();
    await load(f, 86401);
    // The native File fixture's fault flag is not authored project state.
    const after = snapshot(f);
    if (failure === 'reload') delete after.videoFile.decodeError;
    assert.deepEqual(after, before);
    assert.equal(f.element('#toast').textContent, vm.runInContext("t('errors.videoDurationLimit')", f.context));
    assert.equal(f.evaluate('loadingMedia'), false);
    assert.equal(f.storage.attempts.length, 0);
    assert.equal(f.settingsWrites(), 0);
  });
}

for (const edit of ['timeline', 'speed']) {
  for (const action of ['undo', 'redo']) {
    for (const rejectedFirst of [false, true]) {
      test(`${edit} ${action} during video loading keeps current title timing${rejectedFirst ? ' after rejection and retry' : ''}`, async () => {
        const f = await fixture(true);
        vm.runInContext(`
          state.clips = [{start:0,end:6}]; state.design.title.start = 1.5; state.design.title.end = 3;
          state.design.credit.start = 3; state.design.credit.end = null;
          history = []; future = []; timelineCache = null;
        `, f.context);
        const command = edit === 'timeline'
          ? "runEditorCommand('timeline.replace', {clips:[{start:0,end:12}]})"
          : "runEditorCommand('project.update', {patch:{speed:2}})";
        assert.equal(vm.runInContext(command, f.context), true);
        if (action === 'redo') f.element('#undoButton').onclick();
        const pending = load(f, rejectedFirst ? 86401 : 24, { deferMetadata: true });
        assert.equal(f.evaluate('loadingMedia'), true);
        f.element(action === 'undo' ? '#undoButton' : '#redoButton').onclick();
        assert.equal(f.evaluate('state.design.title.end / (duration() / state.speed)'), .5);
        const current = snapshot(f);
        // A save while native loading is pending still belongs to the edited old project.
        await vm.runInContext('saveProject()', f.context);
        assert.deepEqual(JSON.parse(f.raw()), current.state);
        f.pendingMetadata.shift()();
        await pending;
        if (rejectedFirst) {
          assert.deepEqual(snapshot(f), current);
          assert.deepEqual(JSON.parse(f.raw()), current.state);
          assert.equal(f.storage.attempts.length, 0);
          await load(f, 24);
        }
        const project = f.evaluate('state');
        assert.equal(project.duration, 24);
        assert.equal(project.speed, 1);
        assert.deepEqual([project.design.title.start, project.design.title.end], [6, 12]);
        assert.deepEqual([project.design.credit.start, project.design.credit.end], [12, null]);
        assert.deepEqual(project.design.title.lines, ['Keep my title', '']);
        await vm.runInContext('saveProject()', f.context);
        assert.deepEqual(JSON.parse(f.raw()), project);
        assert.equal(f.storage.records.get('video').duration, 24);
        assert.equal(f.storage.attempts.length, 1);
        assert.deepEqual(f.evaluate('history'), []);
        assert.deepEqual(f.evaluate('future'), []);
        assert.doesNotThrow(() => readProjectDocument(createProjectDocument(project)));
      });
    }
  }
}
