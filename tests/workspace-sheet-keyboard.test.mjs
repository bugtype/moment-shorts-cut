import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, setLocale, getLocale} from '../dist/i18n.mjs';

async function fixture(compact = true) {
  const f = await createAppFixture();
  const handlers = [], rail = f.element('#testCaptionRail');
  rail.dataset.panel = 'captions';
  const queryAll = f.doc.querySelectorAll;
  f.doc.querySelectorAll = selector => selector === '[data-panel]' ? [rail] : queryAll(selector);
  f.context.window.matchMedia = query => ({matches: compact && query.includes('max-width:700px')});
  // The shared fixture keeps only the final listener per event. Capture every
  // actual binding here so the earlier sheet listener cannot escape coverage.
  f.doc.addEventListener = (type, handler) => {if (type === 'keydown') handlers.push(handler);};
  vm.runInContext('bind();switchPanel("captions");history=[];future=[];', f.context);
  function press(extra = {}) {
    let prevented = 0;
    const event = {key: 'Escape', code: 'Escape', target: f.doc.activeElement,
      preventDefault() {prevented++; this.defaultPrevented = true;}, ...extra};
    for (const handler of handlers) handler(event);
    assert.equal(prevented, 0, 'sheet handling must not suppress native dialog/composition defaults');
  }
  return {...f, rail, press};
}

test('dialog Escape does not also dismiss its underlying compact workspace sheet', async () => {
  for (const locale of ['ko', 'en', 'zh-CN']) {
    const f = await fixture(); initLocale({languages: [locale], document: f.doc, storage: null});
    try {
      assert.equal(getLocale(), locale, "the scenario must execute in its requested locale");
      assert.equal(f.doc.documentElement.lang, locale);
      const before = f.evaluate('({state,current,history,future})');
      f.element('#importSrt').onclick({});
      f.element('#subtitleImportFile').focus();
      const focused = f.doc.activeElement;
      f.press();
      assert.equal(f.element('#modal').open, true, 'this fixture does not simulate native dialog cancel');
      assert.equal(f.element('#libraryPanel').hidden, false);
      assert.equal(f.rail.getAttribute('aria-expanded'), 'true');
      assert.equal(f.doc.activeElement, focused);
      assert.deepEqual(f.evaluate('({state,current,history,future})'), before);
      // Use the existing cancel action; only a subsequent Escape owns the sheet.
      f.element('#cancelSubtitleImport').onclick();
      assert.equal(f.element('#modal').open, false);
      assert.equal(f.element('#libraryPanel').hidden, false);
      assert.equal(f.doc.activeElement, f.element('#importSrt'));
      f.press();
      assert.equal(f.element('#libraryPanel').hidden, true);
      assert.equal(f.doc.activeElement, f.rail);
    } finally {setLocale('ko'); initLocale({languages: ['ko'], document: null, storage: null});}
  }
});

test('composition and already-consumed Escape keep the sheet, focus and draft input', async () => {
  for (const extra of [{isComposing: true}, {keyCode: 229}, {defaultPrevented: true}]) {
    const f = await fixture();
    const input = f.element('#trimStart'); input.value = '0.12345'; input.focus();
    const before = f.evaluate('({state,current,history,future})');
    f.press(extra);
    assert.equal(f.element('#libraryPanel').hidden, false);
    assert.equal(f.rail.getAttribute('aria-expanded'), 'true');
    assert.equal(f.doc.activeElement, input);
    assert.equal(input.value, '0.12345');
    assert.deepEqual(f.evaluate('({state,current,history,future})'), before);
    f.press();
    assert.equal(f.element('#libraryPanel').hidden, true, 'ordinary Escape still closes after composition ends');
  }
});

test('ordinary and repeated Escape preserve compact close and desktop dock behavior', async () => {
  for (const compact of [true, false]) {
    const f = await fixture(compact);
    const input = f.element('#trimStart'); input.focus();
    const before = f.evaluate('({state,current,history,future})');
    for (let i = 0; i < 2; i++) {
      f.press();
      assert.equal(f.element('#libraryPanel').hidden, compact);
      assert.equal(f.rail.getAttribute('aria-expanded'), String(!compact));
      assert.equal(f.doc.activeElement, compact ? f.rail : input);
      assert.deepEqual(f.evaluate('({state,current,history,future})'), before);
    }
  }
});
