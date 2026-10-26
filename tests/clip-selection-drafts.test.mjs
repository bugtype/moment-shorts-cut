import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {installClipTrackDom} from './fixtures/timeline-clip-dom.mjs';
import {initLocale, getLocale} from '../dist/i18n.mjs';

async function fixture({locale = 'ko', speed = 1, clips = [{start: 1, end: 11}, {start: 2, end: 5}]} = {}) {
  const f = await createAppFixture();
  initLocale({languages: [locale], storage: null, document: f.doc});
  assert.equal(getLocale(), locale); assert.equal(f.doc.documentElement.lang, locale);
  const panel = f.element('#panelContent');
  let html = '', writes = 0;
  // Model only emitted input value attributes on replacement. The general VM
  // fixture keeps elements without parsing innerHTML; it cannot reveal this loss.
  Object.defineProperty(panel, 'innerHTML', {
    get: () => html,
    set(value) {
      html = value; writes++;
      for (const id of ['panelTrimStart', 'panelTrimEnd']) {
        const match = value.match(new RegExp(`id="${id}"[^>]*value="([^"]+)"`));
        if (match) f.element('#' + id).value = match[1];
      }
    },
  });
  const track = installClipTrackDom(f.element('#videoTrack'), f.doc, f.focusEvents);
  f.context.seedClips = structuredClone(clips);
  vm.runInContext(`state.clips=seedClips;state.speed=${speed};selected=0;current=2;timelineCache=null;
    history=[];future=[];renderTimeline();renderInspector();switchPanel('settings');`, f.context);
  return {...f, track, writes: () => writes,
    activate(index, detail = 1) { track.onclick({target: track.children[index], detail, clientX: 300}); },
    draft(start, end) { f.element('#panelTrimStart').value = start; f.element('#panelTrimEnd').value = end; },
    values: () => [f.element('#panelTrimStart').value, f.element('#panelTrimEnd').value],
  };
}

test('seeking in the selected clip preserves Settings drafts until explicit Apply in all locales', async () => {
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) for (const speed of [.25, 1, 4]) {
      const f = await fixture({locale, speed}), before = f.evaluate('({state,history,future,selected})');
      const draft = ['1.23456789', '9.87654321']; f.draft(...draft);
      const writes = f.writes(), handler = f.element('#panelTrimApply').onclick;
      for (const [detail, time] of [[1, 5], [2, 5], [0, 0], [1, 5]]) {
        f.activate(0, detail);
        assert.deepEqual(f.values(), draft);
        assert.equal(f.writes(), writes, 'same-target seek must not reconstruct Settings');
        assert.equal(f.element('#panelTrimApply').onclick, handler);
        assert.equal(f.evaluate('current'), time, 'keep edited pre-speed seek coordinates');
        assert.deepEqual(f.evaluate('({state,history,future,selected})'), before);
      }
      assert.equal(getLocale(), locale); assert.equal(f.doc.documentElement.lang, locale);
      f.element('#panelTrimApply').onclick();
      assert.deepEqual(f.evaluate('state.clips'), [{start: 1.23456789, end: 9.87654321}, {start: 2, end: 5}]);
      assert.equal(f.evaluate('history.length'), 1);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state.clips'), before.state.clips);
      vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state.clips[0]'), {start: 1.23456789, end: 9.87654321});
    }
  } finally {initLocale();}
});

test('same-target activation retains empty drafts and existing playhead controls', async () => {
  const f = await fixture();
  f.draft('', '9.87654321');
  const captureStart = f.element('#panelTrimStartPlayhead').onclick;
  const writes = f.writes(); f.activate(0);
  assert.deepEqual(f.values(), ['', '9.87654321']); assert.equal(f.writes(), writes);
  assert.equal(f.element('#panelTrimStartPlayhead').onclick, captureStart);
  captureStart({});
  assert.deepEqual(f.values(), ['6', '9.87654321']);
  assert.equal(f.evaluate('history.length'), 0, 'capturing the new playhead only edits a draft');
  f.element('#panelTrimApply').onclick();
  assert.deepEqual(f.evaluate('state.clips[0]'), {start: 6, end: 9.87654321});
});

test('changing selected occurrences still replaces Settings even for identical source ranges', async () => {
  for (const clips of [
    [{start: 1, end: 5}, {start: 7, end: 11}],
    [{start: 1, end: 5}, {start: 1, end: 5}],
  ]) {
    const f = await fixture({clips}); f.draft('2.123456789', '4.87654321');
    const writes = f.writes(); f.activate(1, 0);
    assert.equal(f.evaluate('selected'), 1); assert.equal(f.evaluate('current'), 4);
    assert.equal(f.writes(), writes + 1);
    assert.deepEqual(f.values(), [String(clips[1].start), String(clips[1].end)]);
    vm.runInContext('current=5', f.context); f.element('#panelTrimStartPlayhead').onclick({});
    assert.equal(Number(f.values()[0]), clips[1].start + 1);
    f.element('#panelTrimApply').onclick();
    assert.deepEqual(f.evaluate('state.clips'), [clips[0], {start: clips[1].start + 1, end: clips[1].end}]);
  }
});

test('API replacement waits for drafts, then explicit Undo/Redo still refresh Settings', async () => {
  const f = await fixture(); f.draft('2.123456789', '9.87654321');
  const before = f.evaluate('({state,history,future})'), writesBefore = f.writes();
  const blocked = await f.context.window.moment.execute('timeline.replace', {clips: [{start: 3, end: 8}]});
  assert.equal(blocked.error?.code, 'CONFLICT');
  assert.deepEqual(f.evaluate('({state,history,future})'), before);
  assert.deepEqual(f.values(), ['2.123456789', '9.87654321']); assert.equal(f.writes(), writesBefore);
  f.draft('1', '11');
  const result = await f.context.window.moment.execute('timeline.replace', {clips: [{start: 3, end: 8}]});
  assert.equal(result.ok, true); assert.deepEqual(f.values(), ['3', '8']);
  f.draft('4.25', '7.75'); vm.runInContext('undo()', f.context);
  assert.deepEqual(f.values(), ['1', '11']);
  f.draft('2.25', '9.75'); vm.runInContext('undo(true)', f.context);
  assert.deepEqual(f.values(), ['3', '8']);
  const writes = f.writes(); f.activate(0, 0);
  assert.equal(f.writes(), writes); assert.deepEqual(f.values(), ['3', '8']);
});

test('clip activation outside Settings keeps its existing panel ownership', async () => {
  for (const name of ['captions', 'effects']) {
    const f = await fixture(); vm.runInContext(`switchPanel('${name}')`, f.context);
    const writes = f.writes(), state = f.evaluate('({state,history,future})');
    f.activate(0); f.activate(1, 0);
    assert.equal(f.writes(), writes); assert.equal(f.evaluate('panel'), name);
    assert.equal(f.evaluate('selected'), 1);
    assert.deepEqual(f.evaluate('({state,history,future})'), state);
  }
});
