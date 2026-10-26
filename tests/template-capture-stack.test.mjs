import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDemoProject, createProjectDocument} from '../dist/core/project.mjs';
import {prepareCommand} from '../dist/core/commands.mjs';
import {newCard, activeSceneLayers} from '../dist/effects.mjs';
import {TEMPLATES, saveCustomTemplate, applyTemplate} from '../dist/template-catalog.mjs';
import {createTemplateDocument, readTemplateDocument} from '../dist/template-library.mjs';
import {createCompositionRenderer} from '../dist/composition-renderer.mjs';
import {createCanvasTrace} from './fixtures/canvas-trace.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, getLocale} from '../dist/i18n.mjs';

function project(role = 'headline', kind = 'card') {
  const p = createDemoProject();
  p.design.title.enabled = p.design.credit.enabled = false;
  p.overlays = [
    {...newCard(12), id: 'late-lower', text: 'CARD_LATE', start: 4, end: 10, role, kind, animation: 'none'},
    {...newCard(12), id: 'early-upper', text: 'CARD_EARLY', start: 0, end: 10, role, kind, animation: 'none'},
  ];
  return p;
}
const ids = cards => cards.map(card => card.id);
const capture = p => prepareCommand(p, 'template.export', {id: 'stack-style', name: 'Stack style'}).data;
function drawnCards(p, time = 5) {
  const trace = createCanvasTrace(), renderer = createCompositionRenderer(trace.makeCanvas);
  renderer.draw(trace.context, 540, 960, p, {ready: false, sourceTime: time * p.speed,
    time, total: p.clips.reduce((n, c) => n + c.end - c.start, 0) / p.speed,
    elapsed: time, remaining: 1, progress: .5}, {includeCaptions: false});
  // Follow actual compositor sprite draws back to their rasterized wording.
  // This asserts paint-command order, not pixels, layout or native canvas output.
  const text = new Map();
  for (const [surface, operation, value] of trace.events) {
    if (operation === 'fillText') text.set(surface, [...(text.get(surface) || []), value]);
  }
  return trace.events.filter(event => event[0] === 'output' && event[1] === 'drawImage')
    .flatMap(event => text.get(event[2]) || []).filter(value => value.startsWith('CARD_'));
}

test('portable template capture retains the compositor headline winner and free-card paint order', () => {
  for (const role of ['headline', 'free']) for (const kind of ['card', 'countdown']) {
    const p = project(role, kind), before = structuredClone(p), document = capture(p);
    const expected = role === 'headline' ? ['CARD_EARLY'] : ['CARD_LATE', 'CARD_EARLY'];
    assert.deepEqual(drawnCards(p), expected);
    const restored = prepareCommand(p, 'template.apply.document', {document, withContent: true}).project;
    assert.deepEqual(drawnCards(restored), expected, 'capture must not swap visible wording or stacking');
    assert.deepEqual(ids(document.template.cards), ids(p.overlays));
    assert.deepEqual(p, before);
  }
});

test('new captures retain authored order, IDs and disabled cards while clipping and normalizing timing', () => {
  const p = project('free'); p.speed = 2;
  p.overlays.push({...newCard(12), id: 'disabled', start: 1, end: 3, enabled: false},
    {...newCard(12), id: 'outside', start: 7, end: 8});
  const before = structuredClone(p), document = capture(p), cards = document.template.cards;
  assert.deepEqual(cards.map(c => [c.id, c.start, c.end, c.enabled]), [
    ['late-lower', 4 / 6, 1, true], ['early-upper', 0, 1, true], ['disabled', 1 / 6, .5, false],
  ]);
  const target = createDemoProject(); target.duration = 24; target.clips = [{start: 0, end: 24}];
  const restored = prepareCommand(target, 'template.apply.document', {document, withContent: true}).project;
  assert.deepEqual(restored.overlays.map(c => [c.id, c.start, c.end]), [
    ['late-lower', 16, 24], ['early-upper', 0, 24], ['disabled', 4, 12],
  ]);
  assert.deepEqual(ids(activeSceneLayers(restored, 20)), ['late-lower', 'early-upper']);
  assert.deepEqual(p, before);
});

test('style-only application preserves target cards and unrelated project metadata', () => {
  const source = project(), document = capture(source), target = project('free');
  target.kind = 'video'; target.fileName = 'original.mp4'; target.audioName = 'voice.wav';
  target.audioOffset = 2; target.speed = 2; target.ratio = '4:5'; target.panX = .25;
  target.name = 'Keep name'; target.design.title.lines = ['Keep title', 'Keep second'];
  target.design.credit.text = 'Keep credit'; target.overlays.reverse();
  const before = structuredClone(target), input = structuredClone(document);
  const next = prepareCommand(target, 'template.apply.document', {document}).project;
  for (const key of ['name', 'kind', 'fileName', 'audioName', 'audioOffset', 'audioVolume', 'volume',
    'clips', 'speed', 'ratio', 'fit', 'panX', 'panY', 'zoom', 'captions', 'overlays']) assert.deepEqual(next[key], before[key], key);
  assert.deepEqual(next.design.title.lines, before.design.title.lines);
  assert.equal(next.design.credit.text, before.design.credit.text);
  assert.deepEqual(target, before); assert.deepEqual(document, input);
});

test('existing portable and legacy saved templates keep their stored order without reinterpretation', () => {
  const saved = saveCustomTemplate('Existing', project(), {id: 'existing-style'});
  // Deliberately model the earlier chronological capture, including legacy timing.
  saved.cards.sort((a, b) => a.start - b.start);
  for (const relative of [true, false]) {
    const old = structuredClone(saved); if (!relative) delete old.relativeTiming;
    const document = createTemplateDocument(old), before = structuredClone(document);
    const read = readTemplateDocument(document);
    assert.deepEqual(ids(read.cards), ['early-upper', 'late-lower']);
    const next = prepareCommand(project(), 'template.apply.document', {document, withContent: true}).project;
    assert.deepEqual(drawnCards(next), ['CARD_LATE'], 'old files keep the composition they already encode');
    assert.deepEqual(document, before);
  }
});

test('capturing built-in compositions keeps their existing card order and detached project', () => {
  for (const template of TEMPLATES) {
    const p = createDemoProject(); applyTemplate(p, template, true);
    const before = structuredClone(p), document = capture(p);
    assert.deepEqual(ids(document.template.cards), ids(p.overlays));
    assert.deepEqual(p, before);
    assert.doesNotThrow(() => createProjectDocument(prepareCommand(p, 'template.apply.document', {document, withContent: true}).project));
  }
});

test('browser save, update and content Apply retain the captured stack in all locales', async () => {
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      const f = await createAppFixture();
      initLocale({languages: [locale], storage: null, document: f.doc});
      assert.equal(getLocale(), locale); assert.equal(f.doc.documentElement.lang, locale);
      let gallery; f.context.mountTemplateGallery = (_, options) => { gallery = options; };
      const stored = new Map(); f.context.localStorage.setItem = (key, value) => stored.set(key, value);
      f.context.seed = project();
      vm.runInContext("state=seed;history=[];future=[];timelineCache=null;switchPanel('templates')", f.context);
      const before = f.evaluate('({state,history,future})');
      gallery.save(); f.element('#customTemplateName').value = 'Stack style'; f.element('#saveCustomTemplate').onclick();
      let saved = gallery.custom[0];
      assert.deepEqual(ids(saved.cards), ids(before.state.overlays));
      assert.deepEqual(f.evaluate('({state,history,future})'), before);
      const id = saved.id; gallery.favorite(id);
      vm.runInContext("state.overlays[0].text='CARD_UPDATED'", f.context);
      gallery.update(id); f.element('#confirmUpdateTemplate').onclick();
      saved = gallery.custom[0];
      assert.equal(saved.id, id); assert.equal(saved.name, 'Stack style');
      assert.deepEqual(ids(saved.cards), ids(before.state.overlays));
      assert.equal(saved.cards[0].text, 'CARD_UPDATED'); assert.ok(gallery.favorites.includes(id));
      assert.deepEqual(ids(JSON.parse(stored.get('moment-templates-v1'))[0].cards), ids(before.state.overlays));
      const beforeApply = f.evaluate('state');
      gallery.preview(saved); f.element('#applyTemplateStructure').onclick({});
      assert.deepEqual(drawnCards(f.evaluate('state')), drawnCards(beforeApply));
      assert.equal(f.evaluate('history.length'), 1);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), beforeApply);
      assert.equal(getLocale(), locale); assert.equal(f.doc.documentElement.lang, locale);
    }
  } finally {initLocale();}
});
