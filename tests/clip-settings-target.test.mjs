import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, getLocale, translateFor} from '../dist/i18n.mjs';

async function fixture({clips = [{start: 1, end: 11}], selected = 0, current = 5, speed = 1, panel = 'settings', locale = 'ko'} = {}) {
  const f = await createAppFixture();
  initLocale({languages: [locale], document: f.doc, storage: null});
  assert.equal(getLocale(), locale); assert.equal(f.doc.documentElement.lang, locale);
  f.context.seedClips = structuredClone(clips);
  vm.runInContext(`state.clips=seedClips;state.speed=${speed};selected=${selected};current=${current};history=[];future=[];timelineCache=null;switchPanel('${panel}');`, f.context);
  return f;
}
function shownBounds(f) {
  const html = f.element('#panelContent').innerHTML;
  return ['panelTrimStart', 'panelTrimEnd'].map(id => {
    const match = html.match(new RegExp(`id="${id}"[^>]*value="([^"]+)"`));
    assert.ok(match, 'the real Settings markup must declare ' + id);
    return Number(match[1]);
  });
}
function assertCurrentBounds(f) {
  const clip = f.evaluate('state.clips[selected]');
  assert.deepEqual(shownBounds(f), [clip.start, clip.end]);
  assert.deepEqual([Number(f.element('#trimStart').value), Number(f.element('#trimEnd').value)], [clip.start, clip.end]);
}
function applyShownBounds(f) {
  // The synthetic fixture does not parse input value attributes. Materialize
  // exactly the real generated markup, not the values this test hopes to see.
  const [start, end] = shownBounds(f);
  f.element('#panelTrimStart').value = String(start);
  f.element('#panelTrimEnd').value = String(end);
  f.element('#panelTrimApply').onclick();
}

test('split refreshes open Settings to the newly selected second half in every locale', async () => {
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      const f = await fixture({locale}); f.element('#splitButton').onclick();
      assert.deepEqual(f.evaluate('state.clips'), [{start: 1, end: 6}, {start: 6, end: 11}]);
      assert.equal(f.evaluate('selected'), 1); assert.equal(f.evaluate('history.length'), 1);
      assert.equal(getLocale(), locale);
      assert.ok(f.element('#panelContent').innerHTML.includes(translateFor(locale, 'panels.applyRange')));
      assertCurrentBounds(f);
    }
  } finally {initLocale();}
});

test('applying displayed Settings after split never replaces the second half with another clip', async () => {
  for (const speed of [.25, 1, 4]) {
    const original = [{start: 8, end: 10}, {start: 1.123456789, end: 9.87654321}];
    const f = await fixture({clips: original, current: 4, speed});
    f.element('#splitButton').onclick();
    assert.equal(f.evaluate('selected'), 2, 'split follows the playhead, not the old selected clip');
    const split = f.evaluate('state.clips');
    applyShownBounds(f);
    assert.deepEqual(f.evaluate('state.clips'), split, 'unchanged visible values must preserve the split result');
    assert.equal(f.evaluate('history.length'), 2, 'keep existing explicit Apply history behavior');
    vm.runInContext('undo();undo()', f.context); assert.deepEqual(f.evaluate('state.clips'), original);
    assertCurrentBounds(f);
    vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state.clips'), split);
    assertCurrentBounds(f);
  }
});

test('repeated splits rebind Settings playhead controls to the latest selected half', async () => {
  const f = await fixture();
  f.element('#splitButton').onclick();
  vm.runInContext('current=7', f.context); f.element('#splitButton').onclick();
  assert.equal(f.evaluate('selected'), 2); assertCurrentBounds(f);
  f.element('#panelTrimStart').value = '0';
  f.element('#panelTrimStartPlayhead').onclick({});
  assert.equal(Number(f.element('#panelTrimStart').value), 8, 'the new control owns the selected source clip');
  assert.equal(f.evaluate('history.length'), 2, 'capturing playhead only changes a draft');
});

test('rejected and busy split leave Settings markup, drafts, selection and history unchanged', async () => {
  for (const setup of ['current=0', 'loadingMedia=true', 'exporting=true']) {
    const f = await fixture();
    f.element('#panelTrimStart').value = '2.345';
    vm.runInContext(setup, f.context);
    const before = f.evaluate('({state,current,selected,history,future})'), html = f.element('#panelContent').innerHTML;
    f.element('#splitButton').onclick();
    assert.deepEqual(f.evaluate('({state,current,selected,history,future})'), before);
    assert.equal(f.element('#panelContent').innerHTML, html);
    assert.equal(f.element('#panelTrimStart').value, '2.345');
  }
});

test('split adds no extra panel rebuild outside Settings', async () => {
  // The current text panel has an additional existing seek-driven refresh.
  for (const [panel, existingRenders] of [['captions', 1], ['text', 2], ['effects', 1]]) {
    const f = await fixture({panel});
    vm.runInContext('globalThis.panelRenders=0;globalThis.originalRenderPanel=renderPanel;renderPanel=()=>{panelRenders++;return originalRenderPanel();}', f.context);
    f.element('#splitButton').onclick();
    assert.equal(f.evaluate('panel'), panel);
    assert.equal(f.evaluate('panelRenders'), existingRenders, 'preserve the existing per-panel refresh count');
    assert.equal(f.evaluate('history.length'), 1);
  }
});

test('Delete refreshes first, middle and final selection before unchanged Settings Apply', async () => {
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) for (const selected of [0, 1, 2]) {
      const clips = [{start: 1, end: 3}, {start: 5, end: 7}, {start: 9, end: 11}];
      const f = await fixture({clips, selected, current: 0, locale});
      f.element('#deleteButton').onclick();
      const remaining = clips.filter((_, index) => index !== selected);
      assert.deepEqual(f.evaluate('state.clips'), remaining);
      assert.equal(f.evaluate('selected'), Math.min(selected, remaining.length - 1));
      assert.equal(f.evaluate('history.length'), 1);
      assertCurrentBounds(f);
      applyShownBounds(f);
      assert.deepEqual(f.evaluate('state.clips'), remaining);
      vm.runInContext('undo();undo()', f.context); assert.deepEqual(f.evaluate('state.clips'), clips);
      assertCurrentBounds(f);
      vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state.clips'), remaining);
      assertCurrentBounds(f); assert.equal(getLocale(), locale);
    }
  } finally {initLocale();}
});

test('refused Delete and the final remaining clip do not rebuild Settings or discard draft values', async () => {
  for (const scenario of ['one clip', 'exporting=true', "persistence.restorePhase='restoring'"]) {
    const clips = scenario === 'one clip' ? [{start: 1, end: 11}] : [{start: 1, end: 5}, {start: 7, end: 11}];
    const f = await fixture({clips, current: 0});
    f.element('#panelTrimStart').value = '2.345';
    if (scenario !== 'one clip') vm.runInContext(scenario, f.context);
    const before = f.evaluate('({state,selected,history,future})'), html = f.element('#panelContent').innerHTML;
    f.element('#deleteButton').onclick();
    assert.deepEqual(f.evaluate('({state,selected,history,future})'), before);
    assert.equal(f.element('#panelContent').innerHTML, html);
    assert.equal(f.element('#panelTrimStart').value, '2.345');
  }
});

test('Duplicate already keeps Settings aligned and remains an unchanged control', async () => {
  const f = await fixture({clips: [{start: 1.23456789, end: 9.87654321}], current: 2});
  f.element('#duplicateClipButton').onclick();
  assert.equal(f.evaluate('selected'), 1); assert.equal(f.evaluate('history.length'), 1);
  assertCurrentBounds(f);
  const clips = f.evaluate('state.clips'); applyShownBounds(f);
  assert.deepEqual(f.evaluate('state.clips'), clips);
});
