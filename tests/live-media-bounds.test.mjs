import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { createProjectDocument } from '../dist/core/project.mjs';
import { createEditorService } from '../dist/integration/editor-service.mjs';

async function fixture() {
  const f = await createAppFixture();
  vm.runInContext(`
    state = initial(); state.kind = 'video'; state.fileName = 'original.mp4';
    state.clips = [{start: 0, end: 10}]; timelineCache = null;
    sources.videoFile = {name: 'original.mp4'}; video.duration = 12;
    history = []; future = []; current = 0; selected = 0;
    ensureAudio = async () => {};
  `, f.context);
  // Actual accepted imports can move metadata without changing valid source cuts.
  for (const duration of [12.04, 12.08]) {
    const project = { ...f.evaluate('state'), duration };
    const result = await f.context.window.moment.execute('project.import', { document: createProjectDocument(project) });
    assert.equal(result.ok, true);
  }
  vm.runInContext('globalThis.scheduledSaves = 0; scheduleSave = () => scheduledSaves++;', f.context);
  return f;
}

const snapshot = f => f.evaluate('({state, history, future, current, selected, playing, playRequest, frameHandle, scheduledSaves})');
const invalidClips = [{ start: 0, end: 1 }, { start: 11.9, end: 12.04 }];

for (const route of ['project.import', 'timeline.replace', 'project.batch']) {
  test(`${route} rejects unavailable source cuts before playback/history/save side effects`, async () => {
    const f = await fixture();
    await vm.runInContext('play()', f.context);
    const before = snapshot(f), frames = [...f.pendingFrames.keys()];
    const args = route === 'project.import'
      ? { document: createProjectDocument({ ...f.evaluate('state'), clips: invalidClips }) }
      : route === 'timeline.replace' ? { clips: invalidClips }
        : { operations: [
          { command: 'project.update', arguments: { patch: { name: 'Must not partially commit' } } },
          { command: 'timeline.replace', arguments: { clips: invalidClips } },
        ] };
    const result = await f.context.window.moment.execute(route, args);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_ARGUMENT');
    assert.equal(result.error.path, 'project.clips[1]');
    assert.match(result.error.message, /원본 영상 범위/);
    assert.deepEqual(snapshot(f), before);
    assert.deepEqual([...f.pendingFrames.keys()], frames);
    assert.equal(f.evaluate('sessionMedia.mediaReady()'), true);
    vm.runInContext('pause()', f.context);
  });
}

test('settings-file import reports source bounds without replacing the current document', async () => {
  const f = await fixture(), before = snapshot(f);
  const document = createProjectDocument({ ...f.evaluate('state'), clips: invalidClips });
  f.context.importFile = new Blob([JSON.stringify(document)]);
  f.element('#projectInput').value = 'selected-file';
  await vm.runInContext('importProjectSettings(importFile)', f.context);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.element('#projectInput').value, '');
  assert.match(f.element('#toast').textContent, /원본 영상 범위/);
});

test('trim UI uses the same actual-source guard after safe metadata imports', async () => {
  const f = await fixture(), before = snapshot(f);
  vm.runInContext('trim(11.9, 12.04)', f.context);
  assert.deepEqual(snapshot(f), before);
  assert.match(f.element('#toast').textContent, /원본 영상 범위/);
});

test('corrected exact-endpoint retry retains normal undo and redo', async () => {
  const f = await fixture(), original = f.evaluate('state');
  const api = f.context.window.moment;
  assert.equal((await api.execute('timeline.replace', { clips: invalidClips })).ok, false);
  const valid = [{ start: 11.9, end: 12 }, { start: 0, end: 5 }];
  assert.equal((await api.execute('timeline.replace', { clips: valid })).ok, true);
  const edited = f.evaluate('state');
  assert.deepEqual(edited.clips, valid);
  assert.equal(edited.duration, 12.08, 'safe imported metadata is not rewritten');
  assert.equal(f.evaluate('scheduledSaves'), 1);
  vm.runInContext('undo()', f.context);
  assert.deepEqual(f.evaluate('state'), original);
  vm.runInContext('undo(true)', f.context);
  assert.deepEqual(f.evaluate('state'), edited);
});

test('source bounds use exact fractions, not formatted timeline summaries', async () => {
  const f = await fixture();
  vm.runInContext('video.duration = 12.001234567;', f.context);
  for (const [end, ok] of [[12.001234567, true], [12.001234568, false]]) {
    const result = await f.context.window.moment.execute('timeline.replace', { clips: [{ start: 0, end }] });
    assert.equal(result.ok, ok);
    assert.equal(f.evaluate('state.clips[0].end'), 12.001234567);
  }
});

test('unlinked failed recovery still permits metadata repair without persistence', async () => {
  const f = await fixture();
  vm.runInContext(`
    persistence.restorePhase = 'failed'; persistence.recoveryValid = true;
    scheduleSave = () => persistence.scheduleSave();
  `, f.context);
  let settingsWrites = 0, mediaWrites = 0;
  f.context.localStorage.setItem = () => settingsWrites++;
  f.context.countMediaWrite = () => { mediaWrites++; return Promise.resolve(); };
  vm.runInContext('projectStore.setMedia = countMediaWrite;', f.context);
  assert.equal(f.evaluate('sessionMedia.mediaReady()'), false);
  const result = await f.context.window.moment.execute('timeline.replace', { clips: invalidClips });
  assert.equal(result.ok, true, 'unverified old native metadata must not block repairing recovered settings');
  assert.deepEqual(f.evaluate('state.clips'), invalidClips);
  await vm.runInContext('saveProject(true); persistMedia();', f.context);
  assert.equal(settingsWrites, 0);
  assert.equal(mediaWrites, 0);
  assert.equal(f.evaluate('persistence.restorePhase'), 'failed');
});

test('verified session media also enforce actual cuts while restore remains failed', async () => {
  const f = await fixture();
  // Exercise the commit capability gate, not native relinking (covered separately).
  vm.runInContext(`
    persistence.restorePhase = 'failed'; persistence.recoveryValid = true;
    sessionMedia.mediaReady = () => true;
  `, f.context);
  const before = snapshot(f);
  const result = await f.context.window.moment.execute('timeline.replace', { clips: invalidClips });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(snapshot(f), before);
});

for (const duration of ['NaN', 'Infinity']) {
  test(`unavailable native duration ${duration} is not treated as authoritative source metadata`, async () => {
    const f = await fixture();
    vm.runInContext(`video.duration = ${duration};`, f.context);
    const result = await f.context.window.moment.execute('timeline.replace', { clips: invalidClips });
    assert.equal(result.ok, true);
  });
}

test('demo and metadata-only service contracts do not inherit a browser video bound', async () => {
  const f = await fixture();
  vm.runInContext("state.kind = 'demo';", f.context);
  assert.equal((await f.context.window.moment.execute('timeline.replace', { clips: invalidClips })).ok, true);
  let project = { ...f.evaluate('state'), kind: 'video' };
  const service = createEditorService({ getProject: () => project, commitProject: next => { project = next; } });
  assert.equal((await service.execute('timeline.replace', { clips: invalidClips })).ok, true);
  assert.deepEqual(project.clips, invalidClips);
});

test('existing busy and source-relink errors retain precedence', async () => {
  const f = await fixture(), before = snapshot(f);
  vm.runInContext('exporting = true;', f.context);
  assert.equal((await f.context.window.moment.execute('timeline.replace', { clips: invalidClips })).error.code, 'BUSY');
  vm.runInContext('exporting = false;', f.context);
  const document = createProjectDocument({ ...f.evaluate('state'), fileName: 'different.mp4', clips: invalidClips });
  assert.equal((await f.context.window.moment.execute('project.import', { document })).error.code, 'MEDIA_RELINK_REQUIRED');
  assert.deepEqual(snapshot(f), before);
});

test('source-bound failures use the existing error message in all three locales', async () => {
  const f = await fixture(), before = snapshot(f);
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      vm.runInContext(`setLocale('${locale}', {persist: false});`, f.context);
      const result = await f.context.window.moment.execute('timeline.replace', { clips: invalidClips });
      assert.equal(result.ok, false);
      assert.equal(result.error.message, vm.runInContext("t('errors.clipRange')", f.context));
      assert.equal(result.error.path, 'project.clips[1]');
      assert.deepEqual(snapshot(f), before);
    }
  } finally { vm.runInContext("setLocale('ko', {persist: false});", f.context); }
});
