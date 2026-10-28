import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { decimalTime } from '../dist/ui-format.mjs';
import { initLocale, getLocale, t } from '../dist/i18n.mjs';

// Model only panel descendant replacement and current input values, not native
// focus/change ordering, IME, media decoding or the transcription model.
async function fixture(locale = 'ko', caption = {start:0,end:1,text:'Original'}) {
  const f = await createAppFixture();
  initLocale({languages:[locale],storage:null,document:f.doc});
  assert.equal(getLocale(),locale);assert.equal(f.doc.documentElement.lang,locale);
  const panel = f.element('#panelContent');
  const originalQuery = f.doc.querySelector, originalAll = f.doc.querySelectorAll;
  let controls = new Map(), rows = [], splitButtons = [], mergeButtons = [], markup = '', generation = 0;
  const query = selector => controls.get(selector) || originalQuery(selector);
  f.doc.querySelector = query;
  f.doc.querySelectorAll = selector => {
    if (selector === '[data-split-caption]') return splitButtons;
    if (selector === '[data-merge-caption]') return mergeButtons;
    const field = selector.match(/^\[data-caption-(text|start|end|keywords|speaker)\]$/)?.[1];
    return field ? rows.map(row => row[field]) : originalAll(selector);
  };
  panel.querySelector = query;
  Object.defineProperty(panel, 'innerHTML', { configurable: true, get: () => markup, set: value => {
    markup = value; controls = new Map(); rows = []; splitButtons = []; mergeButtons = []; generation++;
    const node = key => f.element(`api-draft-${generation}-${key}`);
    for (const [, id] of value.matchAll(/\bid="([\w-]+)"/g)) {
      const el = node(id); el.id = id; controls.set('#' + id, el);
    }
    if (!controls.has('#captionRows')) return;
    for (const [id, val] of Object.entries({ captionSource: 'video', language: 'korean', captionChunkSize: '18',
      captionShiftDelta: '0', captionShiftBasis: 'source', captionPageNumber: '1' })) query('#' + id).value = val;
    query('#captionCreate').open = /id="captionCreate" open/.test(value);
    controls.set('#captionCreate summary', node('summary'));
    query('#generateCaptions').innerHTML = value.match(/id="generateCaptions">(.*?)<\/button>/s)[1];
    const captions = f.evaluate('state.captions');
    for (const [, index, contents] of value.matchAll(/<textarea data-caption-text="(\d+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
      const row = {};
      for (const field of ['text', 'start', 'end', 'keywords', 'speaker']) {
        const el = node(`${field}-${index}`), caption = captions[index];
        el.dataset['caption' + field[0].toUpperCase() + field.slice(1)] = index;
        el.value = ['start', 'end'].includes(field) ? decimalTime(caption[field]) : String(caption[field] ?? '');
        // HTML textarea parsing drops one initial LF; API values normalize CR,
        // while single-line text inputs strip line breaks. No native DOM claim.
        if (field === 'text') el.value = contents.replace(/&(amp|lt|gt|quot|#39);/g,
          (_, key) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]))
          .replace(/\r\n?/g, '\n').replace(/^\n/, '');
        if (field === 'keywords') el.value = el.value.replace(/[\r\n]/g, '');
        controls.set(`[data-caption-${field}="${index}"]`, el); row[field] = el;
      }
      rows.push(row);
    }
    for (const [, index] of value.matchAll(/data-split-caption="(\d+)"/g)) {
      const button = node(`split-${index}`); button.dataset.splitCaption = index;
      controls.set(`[data-split-caption="${index}"]`, button); splitButtons.push(button);
    }
    for (const [, index] of value.matchAll(/data-merge-caption="(\d+)"/g)) {
      const button = node(`merge-${index}`); button.dataset.mergeCaption = index;
      controls.set(`[data-merge-caption="${index}"]`, button); mergeButtons.push(button);
    }
  }});
  f.context.seedCaption = caption;
  vm.runInContext("state.captions=[seedCaption]; switchPanel('captions'); history=[]; future=[];", f.context);
  return {...f, query, panel};
}
const snapshot = f => f.evaluate('({state,history,future,current,selected})');
const effect = {patch:{brightness:1.1}};

async function transformFixture(action, text = '오류 문장') {
  const caption = {start:0,end:3,text,basis:'timeline',speaker:'1',keywords:'유지'};
  const f = await fixture('ko', caption);
  f.context.secondCaption = {...caption,start:3,end:6,text:'정상 문장'};
  vm.runInContext('state.captions.push(secondCaption);renderPanel();', f.context);
  const input = (id, value, event) => { const el = f.query('#' + id); el.value = value; el[event](); };
  if (action === 'replace-all') {
    input('captionFind','오류','oninput'); input('captionReplacement','수정','oninput');
  }
  if (action === 'shift') {
    input('captionShiftBasis','timeline','onchange'); input('captionShiftDelta','0.5','onchange');
  }
  const selector = action === 'merge' ? '[data-merge-caption="0"]'
    : action === 'replace-all' ? '#replaceAllCaptions' : '#shiftCaptionTiming';
  return {...f, actionButton: () => f.query(selector), toolInput: input};
}

test('targeted caption transforms preserve another row draft and require explicit corrected retry', async () => {
  try {
    for (const action of ['split','match']) {
      const f = await transformFixture(action === 'match' ? 'replace-all' : action, '\n오류\r\n문장');
      assert.equal((await f.context.window.moment.execute('effects.update', effect)).ok, true);
      vm.runInContext('undo();globalThis.crossSaves=0;scheduleSave=()=>crossSaves++;', f.context);
      if (action === 'match') f.query('#nextCaptionMatch').onclick({});
      else f.query('[data-caption-text="0"]').setSelectionRange(4,4);
      const input = f.query('[data-caption-text="1"]');
      const button = f.query(action === 'split' ? '[data-split-caption="0"]' : '#replaceCaptionMatch');
      const before = snapshot(f), markup = f.panel.innerHTML, status = f.query('#captionSearchStatus').textContent;
      assert.equal(before.future.length, 1);
      input.value = '한'.repeat(2001); input.focus(); input.setSelectionRange(2,4);
      f.panel.oncompositionstart(); button.onclick({}); assert.deepEqual(snapshot(f), before);
      f.panel.oncompositionend(); input.onchange();
      assert.equal(f.element('#toast').textContent, t('errors.cueLength'));
      for (const draft of ['한'.repeat(2001), '다른 행의 미완성 문장']) {
        input.value = draft;
        const focuses = f.focusEvents.length;
        button.onclick({}); button.onclick({}); await Promise.resolve();
        assert.deepEqual(snapshot(f), before); assert.equal(f.evaluate('crossSaves'), 0);
        assert.equal(f.panel.innerHTML, markup); assert.equal(f.query('[data-caption-text="1"]'), input);
        assert.equal(input.value, draft); assert.equal(f.doc.activeElement, input);
        assert.equal(f.focusEvents.length, focuses); assert.deepEqual([input.selectionStart,input.selectionEnd], [2,4]);
        assert.equal(f.query('#captionSearchStatus').textContent, status);
        assert.equal(f.element('#toast').textContent, t('errors.captionDraftConflict'));
      }
      input.value = '정상 고침'; input.onchange();
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false);
      const corrected = f.evaluate('state');
      assert.equal(f.evaluate('history.length'), 1); assert.equal(f.evaluate('crossSaves'), 1);
      button.onclick({});
      const expected = structuredClone(corrected), first = corrected.captions[0];
      if (action === 'match') expected.captions[0].text = '\n수정\r\n문장';
      else expected.captions = [{...first,text:'\n오류\r\n',end:2,timing:'estimated'},
        {...first,text:'문장',start:2,timing:'estimated'},corrected.captions[1]];
      assert.deepEqual(f.evaluate('state'), expected); assert.equal(f.evaluate('history.length'), 2);
      assert.equal(f.evaluate('future.length'), 0); assert.equal(f.evaluate('crossSaves'), 2);
      assert.equal(f.doc.activeElement, f.query(`[data-caption-text="${action === 'match' ? 0 : 1}"]`));
      const accepted = snapshot(f); button.onclick({}); assert.deepEqual(snapshot(f), accepted);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), corrected);
      vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state'), expected);
    }
  } finally { initLocale(); }
});

test('targeted diagnostics precede cross-row admission while pending drafts defer core split errors', async () => {
  try {
    for (const action of ['split','match']) {
      const f = await transformFixture(action === 'match' ? 'replace-all' : action, '오류\r\n문장');
      if (action === 'match') f.query('#nextCaptionMatch').onclick({});
      const target = f.query('[data-caption-text="0"]'), other = f.query('[data-caption-text="1"]');
      const displayed = target.value, before = snapshot(f);
      const button = f.query(action === 'split' ? '[data-split-caption="0"]' : '#replaceCaptionMatch');
      other.value = '다른 행 초안'; target.value = '대상 행 초안'; target.setSelectionRange(2,2);
      button.onclick({});
      assert.equal(f.element('#toast').textContent, t(action === 'split' ? 'panels.finishTyping' : 'panels.searchStale'));
      target.value = displayed;
      if (action === 'split') {
        for (const [start,end] of [[1,2],[displayed.length+1,displayed.length+1]]) {
          target.setSelectionRange(start,end); button.onclick({});
          assert.equal(f.element('#toast').textContent, t('panels.chooseCaret'));
        }
        target.setSelectionRange(0,0); button.onclick({});
        assert.equal(f.element('#toast').textContent, t('errors.captionDraftConflict'));
        other.value = before.state.captions[1].text; button.onclick({});
        assert.equal(f.element('#toast').textContent, t('errors.splitCaret'));
      } else {
        f.toolInput('captionReplacement','한'.repeat(2001),'oninput'); button.onclick({});
        assert.equal(f.element('#toast').textContent, t('errors.replacementLength'));
        f.toolInput('captionReplacement','오류','oninput'); f.element('#toast').textContent = 'unchanged';
        button.onclick({}); assert.equal(f.element('#toast').textContent, 'unchanged');
      }
      assert.deepEqual(snapshot(f), before); assert.equal(f.query('[data-caption-text="1"]'), other);
    }
  } finally { initLocale(); }
});

test('caption transformations preserve refused and uncommitted drafts until corrected retry', async () => {
  try {
    for (const action of ['merge','replace-all','shift']) {
      const f = await transformFixture(action);
      assert.equal((await f.context.window.moment.execute('effects.update', effect)).ok, true);
      vm.runInContext('undo();globalThis.transformSaves=0;scheduleSave=()=>transformSaves++;', f.context);
      const input = f.query('[data-caption-text="0"]'), button = f.actionButton();
      const before = snapshot(f), markup = f.panel.innerHTML;
      assert.equal(before.future.length, 1);
      input.value = '한'.repeat(2001); input.focus(); input.setSelectionRange(2,4);
      f.element('#toast').textContent = 'unchanged';
      f.panel.oncompositionstart(); button.onclick({});
      assert.deepEqual(snapshot(f), before); assert.equal(f.element('#toast').textContent, 'unchanged');
      f.panel.oncompositionend(); input.onchange();
      assert.equal(f.element('#toast').textContent, t('errors.cueLength'));
      for (const draft of ['한'.repeat(2001), '아직 반영하지 않은 문장']) {
        input.value = draft;
        assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), true);
        const focuses = f.focusEvents.length;
        button.onclick({}); button.onclick({}); await Promise.resolve();
        assert.deepEqual(snapshot(f), before); assert.equal(f.evaluate('transformSaves'), 0);
        assert.equal(f.panel.innerHTML, markup); assert.equal(f.query('[data-caption-text="0"]'), input);
        assert.equal(input.value, draft); assert.equal(f.doc.activeElement, input);
        assert.equal(f.focusEvents.length, focuses); assert.deepEqual([input.selectionStart,input.selectionEnd], [2,4]);
        assert.equal(f.element('#toast').textContent, t('errors.captionDraftConflict'));
      }
      input.value = before.state.captions[0].text;
      const other = f.query('[data-caption-keywords="1"]'); other.value = '다른 행 초안';
      button.onclick({}); assert.deepEqual(snapshot(f), before); assert.equal(f.evaluate('transformSaves'), 0);
      assert.equal(other.value, '다른 행 초안'); assert.equal(f.element('#toast').textContent, t('errors.captionDraftConflict'));
      other.value = before.state.captions[1].keywords;
      input.value = '오류 고침'; input.onchange();
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false);
      const corrected = f.evaluate('state');
      assert.equal(f.evaluate('history.length'), 1); assert.equal(f.evaluate('transformSaves'), 1);
      button.onclick({});
      const after = f.evaluate('state'), expected = structuredClone(corrected);
      if (action === 'merge') expected.captions = [{...corrected.captions[0],end:6,text:'오류 고침 정상 문장'}];
      if (action === 'replace-all') expected.captions[0].text = '수정 고침';
      if (action === 'shift') for (const caption of expected.captions) { caption.start += .5; caption.end += .5; }
      assert.deepEqual(after, expected); assert.equal(f.evaluate('history.length'), 2);
      assert.equal(f.evaluate('future.length'), 0); assert.equal(f.evaluate('transformSaves'), 2);
      const target = action === 'merge' ? '[data-caption-text="0"]'
        : action === 'replace-all' ? '#captionFind' : '#shiftCaptionTiming';
      assert.equal(f.doc.activeElement, f.query(target));
      const accepted = snapshot(f); button.onclick({}); assert.deepEqual(snapshot(f), accepted);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), corrected);
      vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state'), after);
    }
  } finally { initLocale(); }
});

test('caption transformations accept clean normalized rows without treating tool fields as drafts', async () => {
  try {
    for (const action of ['merge','replace-all','shift']) {
      const text = '\n오류\r\n문장', f = await transformFixture(action, text), before = f.evaluate('state');
      if (action !== 'replace-all') {
        f.toolInput('captionFind','검색 초안','oninput'); f.toolInput('captionReplacement','교체 초안','oninput');
      }
      assert.equal(f.query('[data-caption-text="0"]').value, '\n오류\n문장');
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false);
      f.actionButton().onclick({});
      const expected = structuredClone(before);
      if (action === 'merge') expected.captions = [{...before.captions[0],end:6,text:text+' 정상 문장'}];
      if (action === 'replace-all') expected.captions[0].text = '\n수정\r\n문장';
      if (action === 'shift') for (const caption of expected.captions) { caption.start += .5; caption.end += .5; }
      assert.deepEqual(f.evaluate('state'), expected); assert.equal(f.evaluate('history.length'), 1);
    }
  } finally { initLocale(); }
});

test('draft admission retains replacement/shift validation and no-op priority, but precedes invalid merge', async () => {
  try {
    for (const action of ['merge','replace-all','shift']) {
      const f = await transformFixture(action);
      if (action === 'merge') vm.runInContext("state.captions[1].speaker='0';renderPanel();", f.context);
      const input = f.query('[data-caption-text="0"]'), before = snapshot(f);
      input.value = '아직 반영하지 않은 문장';
      if (action === 'replace-all') {
        f.toolInput('captionFind','없는 말','oninput');
        f.element('#toast').textContent = 'unchanged'; f.actionButton().onclick({});
        assert.equal(f.element('#toast').textContent, 'unchanged');
        f.toolInput('captionFind','오류','oninput');
        f.toolInput('captionReplacement','한'.repeat(2001),'oninput'); f.actionButton().onclick({});
        assert.equal(f.element('#toast').textContent, t('errors.replacementLength'));
      }
      if (action === 'shift') {
        f.toolInput('captionShiftDelta','0','onchange');
        f.element('#toast').textContent = 'unchanged'; f.actionButton().onclick({});
        assert.equal(f.element('#toast').textContent, 'unchanged');
        f.toolInput('captionShiftDelta','','onchange'); f.actionButton().onclick({});
        assert.equal(f.element('#toast').textContent, t('panels.enterShift'));
      }
      if (action === 'merge') {
        f.actionButton().onclick({}); assert.equal(f.element('#toast').textContent, t('errors.captionDraftConflict'));
        input.value = before.state.captions[0].text;
        f.actionButton().onclick({}); assert.equal(f.element('#toast').textContent, t('errors.mergeMetadata'));
      }
      assert.deepEqual(snapshot(f), before); assert.equal(f.query('[data-caption-text="0"]'), input);
    }
  } finally { initLocale(); }
});

test('caret splitting maps normalized rows to literal authored halves and preserves Undo/Redo', async () => {
  try {
    for (const [text,caret,parts,time] of [
      ['앞\r\n뒤끝',3,['앞\r\n뒤','끝'],4.5],
      ['A\r\nB',1,['A','\r\nB'],2],
      ['A\r\nB',2,['A\r\n','B'],4],
      ['\nA\r\nBC',4,['\nA\r\nB','C'],4.8],
      ['A\rBC',2,['A\r','BC'],3],
      ['😀\r\ne\u0301Z',5,['😀\r\ne\u0301','Z'],4.5],
    ]) {
      const caption = {start:0,end:6,text,basis:'timeline',speaker:'1',keywords:'유지'};
      const f = await fixture('ko', caption), before = f.evaluate('state');
      const input = f.query('[data-caption-text="0"]'); input.focus(); input.setSelectionRange(caret,caret);
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false);
      f.query('[data-split-caption="0"]').onclick();
      const after = f.evaluate('state'), expected = structuredClone(before);
      expected.captions = [{...caption,text:parts[0],end:time,timing:'estimated'},
        {...caption,text:parts[1],start:time,timing:'estimated'}];
      assert.deepEqual(after, expected); assert.equal(f.evaluate('history.length'), 1);
      assert.equal(f.doc.activeElement, f.query('[data-caption-text="1"]'));
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), before);
      vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state'), after);
    }
  } finally { initLocale(); }
});

test('normalized caret ports refuse malformed positions and retain core boundary checks', async () => {
  try {
    for (const [text,caret,key] of [
      ['A\r\n\r\nB',5,'panels.chooseCaret'],
      ['A\r\n\r\nB',1.5,'panels.chooseCaret'],
      ['A\r\n\r\nB',-1,'panels.chooseCaret'],
      ['A\r\n\r\nB',0,'errors.splitCaret'],
      ['A\r\n\r\nB',4,'errors.splitCaret'],
      ['\r\nAB',1,'errors.splitEmpty'],
      ['😀\r\ne\u0301Z',1,'errors.splitBoundary'],
      ['😀\r\ne\u0301Z',4,'errors.splitBoundary'],
    ]) {
      const f = await fixture('ko', {start:0,end:6,text}), input = f.query('[data-caption-text="0"]');
      const before = snapshot(f); input.focus(); input.setSelectionRange(caret,caret);
      f.query('[data-split-caption="0"]').onclick();
      assert.deepEqual(snapshot(f), before); assert.equal(f.doc.activeElement, input);
      assert.equal(f.element('#toast').textContent, t(key));
    }
  } finally { initLocale(); }
});

test('caret splitting preserves raw-port offsets and refuses real drafts, ranges and changed text', async () => {
  try {
    for (const caret of [2,5]) {
      const text = 'A\r\n\r\nB', f = await fixture('ko', {start:0,end:6,text});
      const input = f.query('[data-caption-text="0"]'); input.value = text; input.setSelectionRange(caret,caret);
      const before = snapshot(f); f.query('[data-split-caption="0"]').onclick();
      if (caret === 2) {
        assert.deepEqual(snapshot(f), before); assert.equal(f.element('#toast').textContent, t('errors.splitBoundary'));
      } else {
        assert.deepEqual(f.evaluate('state.captions.map(c=>c.text)'), ['A\r\n\r\n','B']);
        assert.equal(f.evaluate('state.captions[0].end'), 4.5); assert.equal(f.evaluate('history.length'), 1);
      }
    }
    for (const mode of ['draft','range','changed']) {
      const f = await fixture('ko', {start:0,end:6,text:'앞\r\n뒤끝'}), input = f.query('[data-caption-text="0"]');
      input.focus(); input.setSelectionRange(3,mode === 'range' ? 4 : 3);
      if (mode === 'draft') input.value = '다른 초안';
      if (mode === 'changed') vm.runInContext("state.captions[0].text='외부 변경'", f.context);
      const before = snapshot(f); f.query('[data-split-caption="0"]').onclick();
      assert.deepEqual(snapshot(f), before); assert.equal(f.doc.activeElement, input);
      assert.equal(f.element('#toast').textContent, t(mode === 'range' ? 'panels.chooseCaret' : 'panels.finishTyping'));
      if (mode === 'draft') {
        input.value = '가나'; input.onchange(); input.setSelectionRange(1,1);
        f.query('[data-split-caption="0"]').onclick();
        assert.deepEqual(f.evaluate('state.captions.map(c=>c.text)'), ['가','나']);
        assert.equal(f.evaluate('history.length'), 2);
      }
    }
  } finally { initLocale(); }
});

test('whole-list split preserves refused and uncommitted row drafts until explicit corrected retry', async () => {
  try {
    for (const draft of ['한'.repeat(2001), '아직 적용하지 않은 문장']) {
      const caption = {start:0,end:6,text:'가'.repeat(24),basis:'timeline',speaker:'1',keywords:'유지'};
      const f = await fixture('ko', caption);
      assert.equal((await f.context.window.moment.execute('effects.update', effect)).ok, true);
      vm.runInContext('undo();globalThis.splitSaves=0;scheduleSave=()=>splitSaves++;', f.context);
      const input = f.query('[data-caption-text="0"]'), button = f.query('#splitLongCaptions');
      const split = f.context.splitCaptionText; let calls = 0;
      f.context.splitCaptionText = (...args) => { calls++; return split(...args); };
      f.query('#captionChunkSize').value = '12';
      input.value = draft; input.focus(); input.setSelectionRange(2,4);
      f.panel.oncompositionstart(); f.panel.oncompositionend();
      if (draft.length > 2000) input.onchange();
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), true);
      const before = snapshot(f), markup = f.panel.innerHTML, focuses = f.focusEvents.length;
      assert.equal(before.future.length, 1);
      button.onclick({}); button.onclick({}); await Promise.resolve();
      assert.deepEqual(snapshot(f), before); assert.equal(calls, 0);
      assert.equal(f.evaluate('splitSaves'), 0); assert.equal(f.panel.innerHTML, markup);
      assert.equal(f.query('[data-caption-text="0"]'), input); assert.equal(input.value, draft);
      assert.equal(f.doc.activeElement, input); assert.equal(f.focusEvents.length, focuses);
      assert.deepEqual([input.selectionStart,input.selectionEnd], [2,4]);
      assert.equal(f.element('#toast').textContent, t('panels.finishTyping'));
      input.value = '수'.repeat(24); input.onchange();
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false);
      assert.equal(f.evaluate('state.captions.length'), 1); assert.equal(calls, 0);
      assert.equal(f.evaluate('history.length'), 1); assert.equal(f.evaluate('splitSaves'), 1);
      button.onclick({});
      assert.equal(calls, 1); assert.equal(f.evaluate('history.length'), 2);
      assert.equal(f.evaluate('future.length'), 0); assert.equal(f.evaluate('splitSaves'), 2);
      assert.deepEqual(f.evaluate('state.captions'), [
        {...caption,text:'수'.repeat(12),end:3,timing:'estimated'},
        {...caption,text:'수'.repeat(12),start:3,timing:'estimated'},
      ]);
      assert.equal(f.doc.activeElement, f.query('#splitLongCaptions'));
      const after = snapshot(f); button.onclick({}); assert.deepEqual(snapshot(f), after);
      assert.equal(calls, 1, 'The detached button cannot retry after the accepted split');
    }
  } finally { initLocale(); }
});

test('whole-list split permits clean normalized rows and unrelated search drafts', async () => {
  try {
    for (const text of ['\n'+'가'.repeat(24), '가'.repeat(12)+'\r\n'+'가'.repeat(12)]) {
      const f = await fixture('ko', {start:0,end:6,text});
      f.query('#captionFind').value = '찾는 문구'; f.query('#captionFind').oninput();
      f.query('#captionReplacement').value = '바꿀 문구'; f.query('#captionReplacement').oninput();
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false);
      f.query('#captionChunkSize').value = '12'; f.query('#splitLongCaptions').onclick({});
      assert.deepEqual(f.evaluate('state.captions.map(c=>c.text)'), ['가'.repeat(12),'가'.repeat(12)]);
      assert.equal(f.evaluate('history.length'), 1);
      assert.equal(f.query('#captionFind').value, '찾는 문구');
      assert.equal(f.query('#captionReplacement').value, '바꿀 문구');
    }
  } finally { initLocale(); }
});

test('current-match correction uses textarea offsets while retaining authored line endings', async () => {
  try {
    for (const text of ['앞\r\n찾기 찾기', '앞\r찾기', '\n찾기', '😀& </textarea>\r\n찾기']) {
      const caption = {start:0,end:2,text,basis:'timeline',timing:'estimated',speaker:'1',keywords:'keep'};
      const f = await fixture('ko', caption), row = () => f.query('[data-caption-text="0"]');
      assert.equal((await f.context.window.moment.execute('project.get')).ok, true);
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false);
      f.query('#captionFind').value = '찾기'; f.query('#captionFind').oninput();
      f.query('#captionReplacement').value = '고침'; f.query('#captionReplacement').oninput();
      f.query('#nextCaptionMatch').onclick();
      const displayed = row().value, start = displayed.indexOf('찾기');
      assert.deepEqual([row().selectionStart,row().selectionEnd], [start,start+2]);
      const before = snapshot(f);
      row().value += ' draft'; f.query('#replaceCaptionMatch').onclick();
      assert.deepEqual(snapshot(f), before);
      assert.equal(f.element('#toast').textContent, t('panels.searchStale'));
      row().value = displayed; f.query('#replaceCaptionMatch').onclick();
      const expected = {...caption, text:text.replace('찾기','고침')};
      assert.deepEqual(f.evaluate('state.captions'), [expected]);
      assert.equal(f.evaluate('history.length'), 1);
      assert.deepEqual([row().selectionStart,row().selectionEnd], [start,start+2]);
      if (text.endsWith('찾기 찾기')) {
        f.query('#nextCaptionMatch').onclick();
        const next = row().value.indexOf('찾기');
        assert.deepEqual([row().selectionStart,row().selectionEnd], [next,next+2]);
      }
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state.captions'), [caption]);
      vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state.captions'), [expected]);
    }
  } finally { initLocale(); }
});

test('literal LF matches and CRLF joins map visible ranges without changing raw replacements', async () => {
  for (const [text,find,replacement,expected,selected,inserted] of [
    ['A\r\nB','\n','X','A\rXB',[1,2],[2,3]],
    ['A\rX\nB','X','','A\r\nB',[2,3],[2,2]],
    ['A\rX B','X','\n','A\r\n B',[2,3],[1,2]],
    ['\r\n\r\nA','\n','X','\rX\r\nA',[0,1],[1,2]],
  ]) {
    const f = await fixture('ko', {start:0,end:2,text});
    const row = () => f.query('[data-caption-text="0"]');
    f.query('#captionFind').value = find; f.query('#captionFind').oninput();
    f.query('#captionReplacement').value = replacement; f.query('#captionReplacement').oninput();
    f.query('#nextCaptionMatch').onclick();
    assert.deepEqual([row().selectionStart,row().selectionEnd], selected);
    f.query('#replaceCaptionMatch').onclick();
    assert.equal(f.evaluate('state.captions[0].text'), expected);
    assert.equal(f.evaluate('history.length'), 1);
    assert.deepEqual([row().selectionStart,row().selectionEnd], inserted);
    if (text === '\r\n\r\nA') {
      f.query('#nextCaptionMatch').onclick();
      assert.deepEqual([row().selectionStart,row().selectionEnd], [2,3]);
    }
  }
});

test('overlong caption drafts preserve valid state and retry through the current row', async () => {
  try {
    for (const locale of ['ko', 'en', 'zh-CN']) {
      const f = await fixture(locale, {start:0,end:1,text:'원래 자막',basis:'timeline',timing:'estimated',speaker:'1',keywords:'원래'});
      const timers = [], writes = [];
      f.context.setTimeout = (_callback, delay) => timers.push(delay);
      f.context.localStorage.setItem = (key, value) => writes.push([key, value]);
      assert.equal((await f.context.window.moment.execute('effects.update', effect)).ok, true);
      assert.equal((await f.context.window.moment.execute('effects.update', {patch:{brightness:1.2}})).ok, true);
      vm.runInContext('undo()', f.context);
      assert.equal(f.evaluate('history.length'), 1);
      assert.equal(f.evaluate('future.length'), 1);
      const input = f.query('[data-caption-text="0"]');
      assert.equal(typeof input.onchange, 'function');
      const before = snapshot(f), markup = f.panel.innerHTML;
      const saveTimer = vm.runInContext('persistence.saveTimer', f.context);
      const saves = timers.filter(delay => delay === 500).length;
      input.value = '한'.repeat(2001); input.focus(); input.setSelectionRange(7, 9);
      f.panel.oncompositionstart();
      input.onchange();
      f.panel.oncompositionend();
      assert.deepEqual(snapshot(f), before);
      assert.equal(vm.runInContext('persistence.saveTimer', f.context), saveTimer);
      assert.equal(timers.filter(delay => delay === 500).length, saves);
      assert.deepEqual(writes, []);
      assert.equal(f.panel.innerHTML, markup);
      assert.equal(f.query('[data-caption-text="0"]'), input);
      assert.equal(input.value, '한'.repeat(2001));
      assert.equal(f.doc.activeElement, input);
      assert.equal(input.selectionStart, 7); assert.equal(input.selectionEnd, 9);
      assert.equal(f.element('#toast').textContent, t('errors.cueLength'));
      assert.equal((await f.context.window.moment.execute('project.get')).ok, true);
      assert.equal((await f.context.window.moment.execute('captions.export', {format:'srt'})).ok, true);
      assert.equal((await f.context.window.moment.execute('effects.update', effect)).error.code, 'CONFLICT');
      assert.deepEqual(snapshot(f), before);

      input.value = '🎬'.repeat(1000); input.onchange();
      assert.equal(f.evaluate('state.captions[0].text'), input.value);
      assert.equal(f.evaluate('history.length'), 2);
      assert.equal(f.evaluate('future.length'), 0);
      assert.equal(timers.filter(delay => delay === 500).length, saves + 1);
      assert.equal(f.query('[data-caption-text="0"]'), input);
      assert.equal(f.doc.activeElement, input);
      const accepted = f.evaluate('state');
      assert.deepEqual(accepted.captions[0], {...before.state.captions[0], text:input.value});
      assert.equal((await f.context.window.moment.execute('project.get')).ok, true);
      assert.equal((await f.context.window.moment.execute('captions.export', {format:'srt'})).ok, true);
      await vm.runInContext('saveProject()', f.context);
      assert.deepEqual(JSON.parse(writes.at(-1)[1]), accepted);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), before.state);
      vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state'), accepted);
    }
  } finally { initLocale(); }
});

test('invalid caption times reset only their field without discarding another row draft', async () => {
  try {
    for (const [side, basis, locale] of [
      ['start', 'source', 'ko'],
      ['end', 'timeline', 'en'],
    ]) {
      const f = await fixture(locale, {start:1e-7,end:3,text:'\n원본\r\n문장',basis,
        timing:'estimated',speaker:'1',keywords:'유지'});
      f.context.otherCaption = {start:3,end:5,text:'다른 행',basis,speaker:'0',keywords:'원래'};
      vm.runInContext('state.captions.push(otherCaption);renderPanel();', f.context);
      assert.equal((await f.context.window.moment.execute('effects.update', effect)).ok, true);
      vm.runInContext('undo();globalThis.refusalSaves=0;scheduleSave=()=>refusalSaves++;', f.context);
      const before = snapshot(f), markup = f.panel.innerHTML;
      assert.equal(before.future.length, 1);
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false, 'normalized untouched text is clean');
      const draftText = '한'.repeat(2001);
      const draft = f.query('[data-caption-text="1"]'); draft.value = draftText;
      draft.setSelectionRange(2, 4);
      draft.onchange(); assert.equal(f.element('#toast').textContent, t('errors.cueLength'));
      const input = f.query(`[data-caption-${side}="0"]`);
      input.focus(); input.value = '-1'; input.onchange();
      assert.deepEqual(snapshot(f), before); assert.equal(f.evaluate('refusalSaves'), 0);
      assert.equal(f.element('#toast').textContent, t('panels.captionTimingInvalid'));
      assert.equal(f.query('[data-caption-text="1"]').value, draftText, 'unrelated draft survives refusal');
      assert.equal(f.panel.innerHTML, markup);
      assert.equal(f.query(`[data-caption-${side}="0"]`), input);
      assert.equal(input.value, decimalTime(before.state.captions[0][side]));
      assert.equal(f.doc.activeElement, input);
      assert.equal(f.query('[data-caption-text="1"]'), draft);
      assert.equal(draft.value, draftText);
      assert.deepEqual([draft.selectionStart, draft.selectionEnd], [2, 4]);
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), true);
      draft.value = '아직 확정하지 않은 수정';
      input.value = '-1'; input.onchange();
      assert.deepEqual(snapshot(f), before); assert.equal(f.evaluate('refusalSaves'), 0);
      assert.equal(draft.value, '아직 확정하지 않은 수정');
      input.value = side === 'start' ? '.25' : '2.75'; input.onchange();
      const accepted = f.evaluate('state'), expected = structuredClone(before.state);
      expected.captions[0][side] = Number(input.value);
      assert.deepEqual(accepted, expected);
      assert.equal(f.evaluate('history.length'), before.history.length + 1);
      assert.equal(f.evaluate('future.length'), 0); assert.equal(f.evaluate('refusalSaves'), 1);
      assert.equal(f.query('[data-caption-text="1"]'), draft);
      assert.equal(draft.value, '아직 확정하지 않은 수정');
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), true);
      draft.value = before.state.captions[1].text;
      assert.equal(f.evaluate('captionWorkspace.hasPendingEdits()'), false);
      assert.equal((await f.context.window.moment.execute('project.get')).ok, true);
      vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state'), before.state);
      const afterUndo = snapshot(f), saves = f.evaluate('refusalSaves');
      input.value = '-1'; input.onchange(); // A later real render still retires this callback.
      assert.deepEqual(snapshot(f), afterUndo); assert.equal(f.evaluate('refusalSaves'), saves);
      vm.runInContext('undo(true)', f.context); assert.deepEqual(f.evaluate('state'), accepted);
    }
  } finally { initLocale(); }
});

test('caption row clocks respect field limits on a longer repeated timeline, independently of speed', async () => {
  try {
    for (const speed of [1, 2]) {
      const f = await fixture('en', {start:0,end:60,text:'반복 편집',basis:'timeline'});
      f.context.testSpeed = speed;
      vm.runInContext("state.duration=180;state.clips=[{start:0,end:180}];state.speed=testSpeed;", f.context);
      const clips = Array.from({length:481}, () => ({start:0,end:180}));
      assert.equal((await f.context.window.moment.execute('timeline.replace', {clips})).ok, true);
      assert.equal(f.evaluate('duration()'), 86580);
      const timers = [];
      f.context.setTimeout = (_callback, delay) => timers.push(delay);
      const end = () => f.query('[data-caption-end="0"]');
      end().value = '86400'; end().onchange();
      assert.equal(f.evaluate('state.captions[0].end'), 86400);
      assert.equal((await f.context.window.moment.execute('project.get')).ok, true);
      const boundaryExport = await f.context.window.moment.execute('captions.export', {format:'srt'});
      assert.equal(boundaryExport.ok, true);
      assert.ok(boundaryExport.data.text.includes(speed === 1 ? '24:00:00,000' : '12:00:00,000'));
      assert.equal((await f.context.window.moment.execute('effects.update', effect)).ok, true);
      vm.runInContext('undo()', f.context);
      const before = snapshot(f), saves = timers.filter(delay => delay === 500).length;
      const saveTimer = vm.runInContext('persistence.saveTimer', f.context);
      assert.equal(before.future.length, 1);
      for (const side of ['end', 'start']) {
        const input = f.query(`[data-caption-${side}="0"]`);
        assert.equal(typeof input.onchange, 'function');
        input.value = '86400.001'; input.onchange();
        assert.deepEqual(snapshot(f), before);
        assert.equal(timers.filter(delay => delay === 500).length, saves);
        assert.equal(vm.runInContext('persistence.saveTimer', f.context), saveTimer);
        assert.equal(f.element('#toast').textContent, t('panels.captionTimingInvalid'));
        assert.equal(f.query(`[data-caption-${side}="0"]`), input);
        assert.equal(input.value, decimalTime(before.state.captions[0][side]));
      }
      end().value = '86399'; end().onchange();
      assert.equal(f.evaluate('state.captions[0].end'), 86399);
      assert.equal(f.evaluate('history.length'), before.history.length + 1);
      assert.equal(f.evaluate('future.length'), 0);
      assert.equal(timers.filter(delay => delay === 500).length, saves + 1);
      assert.equal((await f.context.window.moment.execute('project.get')).ok, true);
      vm.runInContext("state.captions[0].basis='source';state.captions[0].end=60;renderPanel();", f.context);
      const sourceBefore = snapshot(f);
      end().value = '181'; end().onchange();
      assert.deepEqual(snapshot(f), sourceBefore);
    }
  } finally { initLocale(); }
});

for (const locale of ['ko','en','zh-CN']) {
  test(`browser execute protects pending caption fields and composition (${locale})`, async () => {
    try {
      for (const [field,value] of [['text','Human draft'],['start','.2'],['end','.8'],['keywords','draft word'],['speaker','1'],['composition',null]]) {
        const f=await fixture(locale), input=f.query(`[data-caption-${field==='composition'?'text':field}="0"]`);
        input.focus();input.setSelectionRange(1,3);
        if(field==='composition') f.panel.oncompositionstart();else input.value=value;
        const before=snapshot(f),markup=f.panel.innerHTML;
        const result=await f.context.window.moment.execute('effects.update',effect);
        assert.equal(result.ok,false);assert.equal(result.error.code,'CONFLICT');
        assert.equal(result.error.message,t('errors.captionDraftConflict'));
        assert.deepEqual(snapshot(f),before);assert.equal(f.panel.innerHTML,markup);
        assert.equal(f.query(`[data-caption-${field==='composition'?'text':field}="0"]`),input);
        assert.equal(input.value,field==='composition'?'Original':value);
        assert.equal(f.doc.activeElement,input);assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);
      }
    } finally {initLocale();}
  });
}

test('whole-list split refuses exhausted precision atomically and permits corrected retry', async () => {
  try {
    const phrase = '오늘은 자막을 고쳐요. 다음은 시간을 맞춰요.';
    const f = await fixture('en', {start:0,end:1,text:phrase,speaker:'0',keywords:'자막'});
    f.context.precisionCue = {start:1,end:1+Number.EPSILON,text:phrase,basis:'timeline',speaker:'1',keywords:'유지'};
    vm.runInContext("state.captions.push(precisionCue);renderPanel();history=[];future=[JSON.stringify(state)];current=.5;globalThis.precisionSaves=0;scheduleSave=()=>precisionSaves++;globalThis.precisionProject=state;", f.context);
    assert.equal((await f.context.window.moment.execute('project.get')).ok, true, 'The authored input is valid');
    const input = f.query('[data-caption-text="0"]'), button = f.query('#splitLongCaptions');
    f.query('#captionChunkSize').value = '12'; input.focus(); input.setSelectionRange(1,3);
    const before = snapshot(f), markup = f.panel.innerHTML;
    const split = f.context.splitCaptionText, calls = [];
    f.context.splitCaptionText = (caption, limit) => { calls.push(caption.start); return split(caption, limit); };
    for (let attempt = 0; attempt < 2; attempt++) {
      button.onclick({});
      assert.deepEqual(snapshot(f), before, 'A later precision failure must not commit earlier pieces');
      assert.equal(f.evaluate('state===precisionProject'), true);
      assert.equal(f.evaluate('precisionSaves'), 0);
      assert.equal(f.element('#toast').textContent, t('errors.splitPrecision'));
      assert.equal(f.panel.innerHTML, markup); assert.equal(f.query('#splitLongCaptions'), button);
      assert.equal(f.query('[data-caption-text="0"]'), input); assert.equal(f.doc.activeElement, input);
      assert.equal(input.selectionStart,1); assert.equal(input.selectionEnd,3);
    }
    assert.deepEqual(calls,[0,1,0,1], 'The valid earlier row is processed before the failing row');
    const end = f.query('[data-caption-end="1"]'); end.value = '2'; end.onchange();
    const corrected = snapshot(f), saves = f.evaluate('precisionSaves');
    assert.equal(corrected.state.captions[1].end,2);
    const expected = corrected.state.captions.flatMap(caption => split(caption,12));
    button.onclick({});
    assert.deepEqual(f.evaluate('state.captions'),expected);
    assert.equal(f.evaluate('history.length'),corrected.history.length+1);
    assert.equal(f.evaluate('future.length'),0); assert.equal(f.evaluate('precisionSaves'),saves+1);
    assert.equal((await f.context.window.moment.execute('project.get')).ok,true);
    const after = snapshot(f); button.onclick({}); assert.deepEqual(snapshot(f),after);
    vm.runInContext('undo()',f.context); assert.deepEqual(f.evaluate('state'),corrected.state);
    vm.runInContext('undo(true)',f.context); assert.deepEqual(f.evaluate('state'),after.state);
  } finally { initLocale(); }
});

test('queued commands detect later drafts; explicit human commit or restoring the value permits retry',async()=>{
  const f=await fixture('en'), input=f.query('[data-caption-text="0"]');let hooks=0;
  const pending=f.context.window.moment.execute('effects.update',effect,()=>hooks++);
  input.value='Typed after submission';input.focus();
  assert.equal((await pending).error.code,'CONFLICT');assert.equal(hooks,0);
  assert.equal(f.evaluate('state.captions[0].text'),'Original');assert.equal(f.evaluate('history.length'),0);
  input.onchange(); // Explicit user change remains outside the API guard.
  assert.equal(f.evaluate('state.captions[0].text'),input.value);assert.equal(f.evaluate('history.length'),1);
  assert.equal((await f.context.window.moment.execute('effects.update',effect,()=>hooks++)).ok,true);
  assert.equal(hooks,1);assert.equal(f.evaluate('history.length'),2);
  vm.runInContext('undo()',f.context);assert.equal(f.evaluate('state.captions[0].text'),'Typed after submission');
  const next=f.query('[data-caption-text="0"]');next.value='Discard this draft';next.value='Typed after submission';
  assert.equal((await f.context.window.moment.execute('effects.update',effect)).ok,true);
});

test('reads, previews and genuine no-op mutations retain drafts without invoking commit guards',async()=>{
  const f=await fixture(),input=f.query('[data-caption-text="0"]');input.value='Human draft';
  const noMatch={find:'absent',replacement:'unused'},operation={command:'effects.update',arguments:effect};
  const before=snapshot(f);
  for(const [name,args] of [
    ['project.get',{}],['captions.list',{}],['captions.export',{}],
    ['project.preview',{operations:[operation]}],
    ['captions.text.replace',noMatch],
    ['project.batch',{operations:[{command:'captions.text.replace',arguments:noMatch}]}],
  ]) {
    const result=await f.context.window.moment.execute(name,args,()=>{throw Error('must not run');});
    assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(snapshot(f),before);
    assert.equal(f.query('[data-caption-text="0"]'),input);assert.equal(input.value,'Human draft');
  }
  // Equal-value updates still replace the project/UI, unlike genuine no-project results.
  assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1}})).error.code,'CONFLICT');
});

test('caption replacement, project import through execute and mixed batches reject atomically',async()=>{
  for(const name of ['captions.update','project.import','project.batch']) {
    const f=await fixture(),input=f.query('[data-caption-text="0"]');input.value='Human draft';
    const args=name==='captions.update'?{captionIndex:0,patch:{text:'AI replacement'}}:
      name==='project.import'?{document:f.evaluate('createProjectDocument(state)')}:
      {operations:[{command:'effects.update',arguments:effect},{command:'captions.update',arguments:{captionIndex:0,patch:{text:'AI replacement'}}}]};
    const before=snapshot(f),result=await f.context.window.moment.execute(name,args);
    assert.equal(result.ok,false);assert.equal(result.error.code,'CONFLICT');assert.deepEqual(snapshot(f),before);
    assert.equal(f.query('[data-caption-text="0"]'),input);assert.equal(input.value,'Human draft');
  }
});

test('invalid commands and caller guard contracts retain their existing diagnostics',async()=>{
  const f=await fixture(),before=snapshot(f);
  assert.equal((await f.context.window.moment.execute('effects.update',effect,'invalid')).error.code,'INVALID_ARGUMENT');
  assert.equal((await f.context.window.moment.execute('effects.update',effect,()=>Promise.resolve())).error.code,'INVALID_ARGUMENT');
  const denied=await f.context.window.moment.execute('effects.update',effect,()=>{throw new f.context.CommandError('CONFLICT','Caller conflict');});
  assert.equal(denied.error.code,'CONFLICT');assert.equal(denied.error.message,'Caller conflict');
  f.query('[data-caption-text="0"]').value='Human draft';
  const invalid=await f.context.window.moment.execute('effects.update',{patch:{brightness:9}});
  assert.equal(invalid.error.code,'INVALID_ARGUMENT');assert.match(invalid.error.path,/brightness/);
  assert.deepEqual(snapshot(f),before);
});

test('caption textarea keeps leading newlines through clean checks, edits and Undo/Redo',async()=>{
  for(const caption of [
    {start:0,end:1,text:'\nOriginal'}, {start:0,end:1,text:'\n\n한글'},
    {start:0,end:1,text:'\r\nFirst\r\nSecond',keywords:'one\ntwo'},
    {start:0,end:1,text:'\n'+'한'.repeat(1998),basis:'timeline',timing:'estimated',speaker:'1'},
  ]) {
    const f=await fixture('en',caption),before=f.evaluate('state.captions');
    const displayed = caption.text.replace(/\r\n?/g, '\n');
    assert.equal(f.query('[data-caption-text="0"]').value, displayed);
    f.panel.oncompositionstart();f.panel.oncompositionend();
    assert.equal((await f.context.window.moment.execute('effects.update',effect)).ok,true);
    assert.deepEqual(f.evaluate('state.captions'),before);
    const input = f.query('[data-caption-text="0"]');
    input.value += '!'; input.onchange();
    assert.deepEqual(f.evaluate('state.captions'), [{...caption, text:displayed+'!'}]);
    vm.runInContext('undo()', f.context); assert.deepEqual(f.evaluate('state.captions'), before);
    vm.runInContext('undo(true)', f.context);
    assert.deepEqual(f.evaluate('state.captions'), [{...caption, text:displayed+'!'}]);
  }
});

test('local commands, Undo, explicit file import and inactive caption panels keep existing replacement semantics',async()=>{
  for(const action of ['local','undo','file','inactive']) {
    const f=await fixture(),input=f.query('[data-caption-text="0"]');input.value='Human draft';
    if(action==='local') assert.equal(vm.runInContext("runEditorCommand('captions.update',{captionIndex:0,patch:{text:'Local replacement'}})",f.context),true);
    else if(action==='undo') {
      vm.runInContext("snapshot();state.name='Changed';undo()",f.context);
      assert.equal(f.evaluate('history.length'),0);
    } else if(action==='file') {
      const document=f.evaluate('createProjectDocument(state)');document.project.name='Explicit file';
      assert.equal((await f.context.window.moment.importProject(new Blob([JSON.stringify(document)]))).ok,true);
      assert.equal(f.evaluate('state.name'),'Explicit file');
    } else {
      vm.runInContext("switchPanel('effects')",f.context);
      assert.equal((await f.context.window.moment.execute('effects.update',effect)).ok,true);
    }
    assert.notEqual(f.query('[data-caption-text="0"]'),input);
  }
});
