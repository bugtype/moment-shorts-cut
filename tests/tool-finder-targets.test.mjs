import test from 'node:test';
import assert from 'node:assert/strict';
import { findToolTargets } from '../dist/tool-finder-targets.mjs';
import { SUPPORTED_LOCALES, translateFor } from '../dist/i18n.mjs';

const expected = [
  { id: 'finder.templates', panel: 'templates', selector: '#templateSearch' },
  { id: 'finder.captionReview', panel: 'captions', selector: '#inspectCaptions', details: '#captionTools' },
  { id: 'finder.captionFind', panel: 'captions', selector: '#captionFind', details: '#captionTools' },
  { id: 'finder.subtitleImport', panel: 'captions', selector: '#importSrt', details: '#captionCreate' },
  { id: 'finder.subtitleExport', panel: 'captions', selector: '#captionExportFormat' },
  { id: 'finder.framing', panel: 'settings', selector: '#openPanelFraming' },
  { id: 'finder.moveClip', panel: 'settings', selector: '#panelMoveClip' },
  { id: 'finder.audio', panel: 'audio', selector: '#chooseAudio' },
  { id: 'finder.seek', action: 'seek' },
  { id: 'finder.projectFiles', action: 'projectFiles' },
].map(target => ({ ...target, labelKey: target.id }));
const ids = query => findToolTargets(query).map(target => target.id);

test('empty search returns exactly ten fixed navigation targets, with no execution or state payload', () => {
  assert.deepEqual(findToolTargets(), expected);
  assert.deepEqual(findToolTargets(' \t\n '), expected);
  for (const target of findToolTargets()) {
    assert.ok(Object.values(target).every(value => typeof value === 'string'));
    assert.ok(Object.keys(target).every(key => ['id', 'labelKey', 'panel', 'selector', 'details', 'action'].includes(key)));
    assert.equal(Boolean(target.action), !target.panel);
  }
});

test('all translated fixed labels and aliases are searchable independent of active locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const target of expected) {
      for (const key of [target.labelKey, `${target.id}Keywords`]) {
        const translated = translateFor(locale, key);
        assert.notEqual(translated, key, `${locale} must provide ${key}`);
        assert.ok(ids(translated).includes(target.id), `${locale}: ${translated}`);
      }
    }
  }
});

test('tokens are case-insensitive literal AND matches across the merged fixed translations', () => {
  const id = 'finder.templates';
  const english = translateFor('en', id);
  const korean = translateFor('ko', id);
  const chinese = translateFor('zh-CN', id);
  const combined = `\t${english.toUpperCase()}\n${korean}  ${chinese}\t`;
  assert.ok(ids(combined).includes(id));
  assert.deepEqual(ids(english.toUpperCase()), ids(english.toLowerCase()));
  assert.deepEqual(ids(`${english} impossible-unknown-tool-43891`), []);
  for (const literal of ['.*', '^$', '[a-z]+', '(?=template)', '\\b', '<script>']) {
    assert.deepEqual(ids(literal), [], literal);
  }
});

test('results are detached and query cannot inject project data or execute code', () => {
  const all = findToolTargets();
  all[0].id = 'changed'; all[0].selector = '#anything'; all[0].action = 'delete';
  all.push({ id: 'authored-project-name' }); all.reverse();
  assert.deepEqual(findToolTargets(), expected);
  assert.notEqual(findToolTargets()[0], findToolTargets()[0]);
  assert.deepEqual(ids('authored-project-name'), []);
  globalThis.finderQueryExecuted = false;
  try {
    assert.deepEqual(ids('globalThis.finderQueryExecuted = true'), []);
    assert.equal(globalThis.finderQueryExecuted, false);
    assert.deepEqual(findToolTargets({ toString() { throw new Error('Do not execute query objects'); } }), []);
    for (const query of [null, 1, true, ['audio']]) assert.deepEqual(findToolTargets(query), []);
  } finally { delete globalThis.finderQueryExecuted; }
});
