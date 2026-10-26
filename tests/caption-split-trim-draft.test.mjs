import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale, setLocale, getLocale} from '../dist/i18n.mjs';

const draft = ['1.23456789', '10.87654321'];
const values = f => [f.element('#trimStart').value, f.element('#trimEnd').value];
async function fixture() {
  const f = await createAppFixture();
  vm.runInContext("state.captions=[{start:1,end:3,text:'A long authored caption with several more words to split'}];history=[];future=[];current=2;selected=0;switchPanel('captions');renderInspector();", f.context);
  [f.element('#trimStart').value, f.element('#trimEnd').value] = draft;
  f.open = () => {f.element('#captionChunkSize').value = '12'; f.element('#splitCaptionRange').onclick({});};
  f.confirm = () => f.element('#confirmSplitRange').onclick({});
  return f;
}

test('caption range split preserves unapplied trim in all locales until explicit Apply', async () => {
  for (const locale of ['ko', 'en', 'zh-CN']) {
    const f = await fixture(); initLocale({languages: [locale], document: f.doc, storage: null});
    try {
      assert.equal(getLocale(), locale);
      assert.equal(f.doc.documentElement.lang, locale);
      const before = f.evaluate('state');
      f.open(); f.confirm();
      const splitCaptions = f.evaluate('state.captions');
      assert.ok(splitCaptions.length > 1);
      assert.deepEqual(f.evaluate('state.clips'), before.clips);
      assert.equal(f.evaluate('history.length'), 1);
      assert.deepEqual(values(f), draft);
      f.element('#trimButton').onclick();
      assert.deepEqual(f.evaluate('state.clips'), [{start: Number(draft[0]), end: Number(draft[1])}]);
      assert.equal(f.evaluate('history.length'), 2);
      vm.runInContext('undo()', f.context);
      assert.deepEqual(f.evaluate('state.clips'), before.clips);
      assert.deepEqual(f.evaluate('state.captions'), splitCaptions, 'Undo reverses the explicit trim, not the preceding split');
    } finally {setLocale('ko'); initLocale({languages: ['ko'], document: null, storage: null});}
  }
});

test('direct split-long command preserves the draft without changing existing Undo/Redo semantics', async () => {
  const f = await fixture(), before = f.evaluate('state');
  assert.equal(vm.runInContext("runEditorCommand('captions.split.long',{limit:12})", f.context), true);
  const split = f.evaluate('state');
  assert.deepEqual(split.clips, before.clips); assert.deepEqual(values(f), draft);
  vm.runInContext('undo()', f.context);
  assert.deepEqual(f.evaluate('state'), before);
  assert.deepEqual(values(f), ['0.0', '12.0'], 'unapplied inputs are not an Undo snapshot');
  vm.runInContext('undo(true)', f.context);
  assert.deepEqual(f.evaluate('state'), split);
  assert.deepEqual(values(f), ['0.0', '12.0']);
});

test('canceled, invalid, no-op and busy split leave drafts and committed state unchanged', async () => {
  for (const mode of ['cancel', 'invalid', 'no-op', 'busy']) {
    const f = await fixture();
    if (mode === 'no-op') vm.runInContext("state.captions[0].text='Short'", f.context);
    const before = f.evaluate('state'); f.open();
    if (mode === 'invalid') f.element('#splitRangeFirst').value = '0';
    if (mode === 'busy') vm.runInContext('loadingMedia=true', f.context);
    if (mode === 'cancel') f.element('#cancelSplitRange').onclick({}); else f.confirm();
    assert.deepEqual(values(f), draft); assert.deepEqual(f.evaluate('state'), before);
    assert.equal(f.evaluate('history.length'), 0);
  }
});

test('an adjacent caption-only edit also preserves the same draft', async () => {
  const f = await fixture(), clips = f.evaluate('state.clips');
  f.element('#assignSpeakerRange').onclick({}); f.element('#speakerRangeValue').value = '1';
  f.element('#confirmSpeakerRange').onclick({});
  assert.deepEqual(values(f), draft); assert.deepEqual(f.evaluate('state.clips'), clips);
  assert.equal(f.evaluate('history.length'), 1);
});

test('real timeline replacement and changed selected clip still reset unrelated trim inputs', async () => {
  const replaced = await fixture();
  vm.runInContext("runEditorCommand('timeline.replace',{clips:[{start:2,end:8}]})", replaced.context);
  assert.deepEqual(values(replaced), ['2.0', '8.0']);
  for (const refreshBeforeCommand of [false, true]) {
    const f = await fixture();
    vm.runInContext('state.clips.push({start:3,end:7});selected=1;' + (refreshBeforeCommand ? 'renderInspector();' : ''), f.context);
    vm.runInContext("runEditorCommand('captions.split.long',{limit:12})", f.context);
    assert.deepEqual(values(f), ['3.0', '7.0'], 'preservation requires the current inspector target');
    assert.deepEqual(f.evaluate('state.clips'), [{start:0,end:12}, {start:3,end:7}]);
  }
});
