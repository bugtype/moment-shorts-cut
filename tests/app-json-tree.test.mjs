import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

// Actual app command and row-edit owners; generated row controls use synthetic DOM.
async function fixture() {
  const f = await createAppFixture(), queryAll = f.doc.querySelectorAll;
  f.doc.querySelectorAll = selector => {
    if (selector !== '[data-caption-text]') return queryAll(selector);
    return [...f.element('#panelContent').innerHTML.matchAll(/data-caption-text="(\d+)"/g)].map(([, index]) => {
      const row = f.element(`[data-caption-text="${index}"]`);
      row.dataset.captionText = index;
      return row;
    });
  };
  vm.runInContext('globalThis.jsonTreeSaves=0;scheduleSave=()=>jsonTreeSaves++', f.context);
  return f;
}
const snapshot = f => f.evaluate('({state,history,future,current,selected,jsonTreeSaves})');

test('window.moment rejects shared cue references without committing or disturbing redo', async () => {
  const f = await fixture();
  assert.equal((await f.context.window.moment.execute('effects.update', { patch: { brightness: 1.2 } })).ok, true);
  f.element('#undoButton').onclick();
  const before = snapshot(f), refs = vm.runInContext('({state,history,future})', f.context);
  assert.equal(before.future.length, 1);
  const cue = { start: 0, end: 1, text: 'Original' };
  const result = await f.context.window.moment.execute('captions.replace', { captions: [cue, cue] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_ARGUMENT');
  assert.deepEqual(snapshot(f), before);
  const afterRefs = vm.runInContext('({state,history,future})', f.context);
  for (const key of ['state', 'history', 'future']) assert.equal(afterRefs[key], refs[key]);
  assert.deepEqual(cue, { start: 0, end: 1, text: 'Original' });
  assert.equal(f.element('#redoButton').disabled, false);
  f.element('#redoButton').onclick();
  assert.equal(f.evaluate('state.effects.brightness'), 1.2);
});

test('independent equal cues remain individually editable with exact Undo and Redo', async () => {
  const f = await fixture(), cue = { start: 0, end: 1, text: 'Original' };
  const args = { captions: [{ ...cue }, { ...cue }] };
  const result = await f.context.window.moment.execute('captions.replace', args);
  assert.equal(result.ok, true);
  assert.equal(f.evaluate('state.captions[0]===state.captions[1]'), false);
  vm.runInContext("switchPanel('captions')", f.context);
  const original = f.evaluate('state'), historyLength = f.evaluate('history.length'), saves = f.evaluate('jsonTreeSaves');
  const row = f.element('[data-caption-text="0"]');
  assert.equal(typeof row.onchange, 'function');
  row.value = 'First row only'; row.onchange();
  const changed = f.evaluate('state');
  assert.deepEqual(changed.captions.map(c => c.text), ['First row only', 'Original']);
  assert.equal(f.evaluate('history.length'), historyLength + 1);
  assert.equal(f.evaluate('jsonTreeSaves'), saves + 1);
  assert.deepEqual(args.captions, [{ ...cue }, { ...cue }]);
  f.element('#undoButton').onclick(); assert.deepEqual(f.evaluate('state'), original);
  f.element('#redoButton').onclick(); assert.deepEqual(f.evaluate('state'), changed);
  assert.equal(f.evaluate('state.captions[0]===state.captions[1]'), false);
});
