import { prepareCommand } from '../dist/core/commands.mjs';
import { formatError } from '../dist/i18n.mjs';
import test from 'node:test';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import assert from 'node:assert/strict';
import { createCaptionPanel } from '../dist/caption-panel.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

function fixture({ blocked = false } = {}) {
  let project = createDemoProject();
  const nodes = new Map(), log = [], commands = [];
  function query(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', dataset: {}, setCustomValidity(value) { this.validationMessage = value; }, reportValidity() { return !this.validationMessage; }, attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; }, removeAttribute(name) { delete this.attributes[name]; },
      setSelectionRange: (start, end) => log.push(['selection', selector, start, end]),
      focus: options => log.push(['focus', selector, options]),
      scrollIntoView: options => log.push(['scroll', selector, options]),
      click: () => log.push(['click', selector]),
    });
    return nodes.get(selector);
  }
  const fields = ['text', 'keywords', 'speaker', 'start', 'end'];
  function queryAll(selector) {
    const field = fields.find(name => selector === `[data-caption-${name}]`);
    if (field) {
      const control = query(selector);
      control.dataset['caption' + field[0].toUpperCase() + field.slice(1)] = '0';
      return [control];
    }
    if (selector === '[data-delete-caption]') {
      const control = query(selector);
      control.dataset.deleteCaption = '0';
      return [control];
    }
    return [];
  }
  const panel = createCaptionPanel({
    importFile: () => log.push('import-dialog'),
    query, queryAll, getProject: () => project, getDuration: () => 6, sourceTime: () => 2,
    edit: (change, refresh) => { if (blocked) return; log.push(['edit', refresh]); change(); },
    execute(name, args) {
      if (blocked) return false;
      const result = prepareCommand(project, name, args);
      commands.push([name, structuredClone(args)]);
      if (!result.project) return false;
      log.push(['edit', true]);
      project = result.project;
      return true;
    },
    refresh: () => log.push('refresh'), toast: message => log.push(['toast', formatError(message)]),
  });
  const target = { querySelector: () => ({ open: true }), innerHTML: '' };
  panel.render(target, { transcribing: false, hasAudio: false, transcriptionStatus: '' }, {
    design: () => log.push('design'), generate: () => log.push('generate'),
    download: format => log.push(['download', format]),
  });
  return { panel, query, target, log, commands, project: () => project, replace: value => { project = value; } };
}

test('caption row handlers read the current project and preserve field metadata', () => {
  const f = fixture(), old = f.project(), replacement = createDemoProject();
  replacement.captions = [{ start: 1, end: 4, text: 'current', basis: 'timeline', timing: 'estimated' }];
  f.replace(replacement);
  const text = f.query('[data-caption-text]');
  text.value = 'edited 🎬'; text.onchange();
  assert.equal(f.project().captions[0].text, 'edited 🎬');
  assert.notEqual(old.captions[0].text, 'edited 🎬');
  assert.equal(f.project().captions[0].timing, 'estimated');
  const end = f.query('[data-caption-end]');
  end.value = '7'; end.onchange();
  assert.equal(f.project().captions[0].end, 4);
  assert.equal(f.log.at(-1), 'refresh');
  end.value = '5'; end.onchange();
  assert.equal(f.project().captions[0].end, 5);
});

test('caption text commits keep the UTF-16 limit without truncating or normalizing drafts', () => {
  const f = fixture(), input = f.query('[data-caption-text]');
  for (const text of ['한'.repeat(2000), '🎬'.repeat(1000), 'e\u0301'.repeat(1000), '', ' \n ']) {
    input.value = text;
    input.onchange();
    assert.equal(f.project().captions[0].text, text);
  }
  for (const text of ['한'.repeat(2001), '🎬'.repeat(1000) + '한', 'e\u0301'.repeat(1000) + 'e', '한'.repeat(100000)]) {
    const before = structuredClone(f.project()), calls = f.log.length;
    input.value = text;
    input.onchange();
    assert.deepEqual(f.project(), before);
    assert.equal(input.value, text);
    assert.equal(f.log.length, calls + 1);
    assert.deepEqual(f.log.at(-1), ['toast', formatError({messageKey:'errors.cueLength'})]);
  }
});

test('caption delete/add retain focus scrolling and route existing actions', () => {
  const f = fixture();
  f.project().captions = [{ start: 0, end: 1, text: 'only' }];
  f.query('[data-delete-caption]').onclick();
  assert.equal(f.project().captions.length, 0);
  assert.deepEqual(f.log.slice(-2).map(event => event.slice(0, 2)), [
    ['focus', '#addCaption'], ['scroll', '#addCaption'],
  ]);
  f.query('#addCaption').onclick();
  assert.deepEqual(f.project().captions[0], { start: 2, end: 5, text: '새로운 자막을 입력하세요' });
  assert.deepEqual(f.log.at(-2), ['focus', '[data-caption-text="0"]', { preventScroll: true }]);
  for (const id of ['captionDesignShortcut', 'generateCaptions', 'downloadCaptions', 'importSrt']) f.query('#' + id).onclick();
  assert.deepEqual(f.log.slice(-4), ['design', 'generate', ['download', 'srt'], 'import-dialog']);
});

test('caption split preserves a no-op and sends real grapheme splits through edit once', () => {
  const f = fixture();
  f.project().captions = [{ start: 0, end: 2, text: 'short', basis: 'timeline' }];
  f.query('#captionChunkSize').value = '12';
  const original = f.project().captions;
  f.query('#splitLongCaptions').onclick();
  assert.equal(f.project().captions, original);
  assert.ok(!f.log.some(event => event[0] === 'edit'));
  f.project().captions = [{ start: 0, end: 4, text: 'e\u0301'.repeat(24), basis: 'timeline', speaker: '1' }];
  f.query('#splitLongCaptions').onclick();
  assert.equal(f.project().captions.length, 2);
  assert.ok(f.project().captions.every(caption => caption.text === 'e\u0301'.repeat(12) && caption.speaker === '1'));
  assert.equal(f.log.filter(event => event[0] === 'edit').length, 1);
});


test('caption export selection passes a format, persists rerenders and never edits', () => {
  const f = fixture();
  f.query('#downloadCaptions').onclick({type:'click'});
  for(const format of ['vtt','txt']){
    f.query('#captionExportFormat').value=format;f.query('#captionExportFormat').onchange();
    f.panel.render(f.target,{}, {download:value=>f.log.push(['download',value])});
    assert.equal(f.query('#captionExportFormat').value,format);
    f.query('#downloadCaptions').onclick({type:'click'});
  }
  assert.deepEqual(f.log,[['download','srt'],['download','vtt'],['download','txt']]);
  assert.match(f.target.innerHTML,/aria-label="자막 저장 형식"/);
});

function replacementInput(f, find, replacement) {
  for (const [id, value] of [['captionFind', find], ['captionReplacement', replacement]]) {
    const field = f.query('#' + id);
    field.value = value;
    field.oninput();
  }
}

test('replace-all previews literal occurrences and edits the latest project once preserving metadata', () => {
  const f = fixture(), original = f.project();
  const current = createDemoProject();
  current.captions = [
    { start: 1, end: 3, text: '이름 이름', basis: 'timeline', timing: 'estimated', speaker: '1', keywords: '이름' },
    { start: 3, end: 5, text: '다른 이름', basis: 'source' },
  ];
  f.replace(current);
  replacementInput(f, '이름', '$&🎬');
  assert.equal(f.query('#replaceAllCaptions').textContent, '모두 바꾸기 · 3곳');
  assert.equal(f.query('#replaceAllCaptions').disabled, false);
  assert.equal(current.captions[0].text, '이름 이름');
  f.query('#replaceAllCaptions').onclick();
  assert.deepEqual(current.captions[0], {
    start: 1, end: 3, text: '$&🎬 $&🎬', basis: 'timeline', timing: 'estimated', speaker: '1', keywords: '이름',
  });
  assert.equal(current.captions[1].text, '다른 $&🎬');
  assert.equal(original.captions[0].text, '잠깐, 쉬어가도 괜찮아');
  assert.equal(f.log.filter(event => event[0] === 'edit').length, 1);
  assert.equal(f.query('#replaceAllCaptions').disabled, true);
});

test('replacement fields survive render and click rechecks project changed since preview', () => {
  const f = fixture();
  replacementInput(f, '이름', '수정');
  f.panel.render(f.target, {}, {});
  assert.equal(f.query('#captionFind').value, '이름');
  assert.equal(f.query('#captionReplacement').value, '수정');
  assert.equal(f.query('#replaceAllCaptions').disabled, true);
  f.project().captions = [{ start: 0, end: 1, text: '새 이름' }];
  f.query('#replaceAllCaptions').onclick();
  assert.equal(f.project().captions[0].text, '새 수정');
  assert.equal(f.log.filter(event => event[0] === 'edit').length, 1);
});

test('replace-all no-ops and invalid replacements do not edit or partially mutate captions', () => {
  const f = fixture();
  f.project().captions = [{ start: 0, end: 1, text: '이름' }, { start: 1, end: 2, text: '이름'.repeat(1000) }];
  const original = f.project().captions;
  for (const [find, replacement] of [['없는 말', '새 말'], ['이름', '이름'], ['', '새 말'], ['이름', ''], ['이름', '길어진 이름']]) {
    replacementInput(f, find, replacement);
    f.query('#replaceAllCaptions').onclick();
    assert.equal(f.project().captions, original);
    assert.equal(f.project().captions[0].text, '이름');
    assert.equal(f.log.filter(event => event[0] === 'edit').length, 0);
  }
  assert.equal(f.log.filter(event => event[0] === 'toast').length, 3);
  replacementInput(f, '이름', '명칭');
  f.query('#replaceAllCaptions').onclick();
  assert.equal(f.project().captions[0].text, '명칭');
  assert.equal(f.log.filter(event => event[0] === 'edit').length, 1);
});


test('replacement through the app is one undoable edit and preserves fields on refresh', async () => {
  const { context, element } = await createAppFixture();
  vm.runInContext("state.captions = [{start:0,end:2,text:'이름 이름',basis:'timeline',timing:'estimated'}]; history=[]; future=[]; switchPanel('captions');", context);
  for (const [id, value] of [['captionFind', '이름'], ['captionReplacement', '명칭']]) {
    element('#' + id).value = value;
    element('#' + id).oninput();
  }
  element('#replaceAllCaptions').onclick();
  assert.equal(vm.runInContext('state.captions[0].text', context), '명칭 명칭');
  assert.equal(vm.runInContext('history.length', context), 1);
  assert.equal(element('#captionFind').value, '이름');
  vm.runInContext('undo()', context);
  assert.equal(vm.runInContext('state.captions[0].text', context), '이름 이름');
  vm.runInContext('undo(true)', context);
  assert.equal(vm.runInContext('state.captions[0].text', context), '명칭 명칭');
  assert.equal(vm.runInContext('state.captions[0].basis', context), 'timeline');
  assert.equal(vm.runInContext('state.captions[0].timing', context), 'estimated');
});


test('a blocked app edit does not announce replacement success or alter captions', () => {
  const f = fixture({ blocked: true });
  f.project().captions = [{start: 0, end: 1, text: '이름'}];
  const before = f.project().captions;
  replacementInput(f, '이름', '명칭');
  f.query('#replaceAllCaptions').onclick();
  assert.equal(f.project().captions, before);
  assert.equal(f.log.length, 0);
});

test('search navigates every nonoverlapping literal UTF-16 match and wraps without edits', () => {
  const f = fixture();
  f.project().captions = [
    { start:0,end:1,text:'앞🎬 한글.* 한글.*' },
    { start:1,end:2,text:'unmatched' },
    { start:2,end:3,text:'한글.*' },
  ];
  const before=structuredClone(f.project());
  replacementInput(f,'한글.*',''); // One entire cue would become empty; search still works.
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 0 / 3');
  assert.equal(f.query('#nextCaptionMatch').disabled,false);
  f.query('#nextCaptionMatch').onclick();
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 1 / 3');
  assert.deepEqual(f.log.at(-1),['selection','[data-caption-text="0"]',4,8]);
  f.query('#nextCaptionMatch').onclick();
  assert.deepEqual(f.log.at(-1),['selection','[data-caption-text="0"]',9,13]);
  f.query('#nextCaptionMatch').onclick();
  assert.deepEqual(f.log.at(-1),['selection','[data-caption-text="2"]',0,4]);
  f.query('#nextCaptionMatch').onclick();
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 1 / 3');
  f.query('#previousCaptionMatch').onclick();
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 3 / 3');
  assert.deepEqual(f.project(),before);
  assert.ok(!f.log.some(event=>event[0]==='edit'||event[0]==='toast'));
});

test('search resets by query or project identity and preserves a surviving caption across renders/reordering', () => {
  const f=fixture(), first={start:0,end:1,text:'hit'}, second={start:1,end:2,text:'hit'};
  f.project().captions=[first,second]; replacementInput(f,'hit','same');
  f.query('#previousCaptionMatch').onclick();
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 2 / 2');
  f.project().captions=[second,first]; f.panel.render(f.target,{},{});
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 1 / 2');
  assert.equal(f.query('#captionFind').value,'hit');
  f.project().captions.splice(0,1); f.panel.render(f.target,{},{});
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 0 / 1');
  f.query('#nextCaptionMatch').onclick();
  const next={...f.project(),captions:[first]}; f.replace(next); f.panel.render(f.target,{},{});
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 0 / 1');
  replacementInput(f,'HIT','same');
  assert.equal(f.query('#nextCaptionMatch').disabled,true);
  replacementInput(f,'hit','same');
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 0 / 1');
  f.query('#previousCaptionMatch').onclick();
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 1 / 1');
});

test('search recomputes edited text, missing results and deletion immediately before navigation', () => {
  const f=fixture(); f.project().captions=[{start:0,end:1,text:'🎬'},{start:1,end:2,text:'🎬'}];
  replacementInput(f,'🎬','x'); f.query('#nextCaptionMatch').onclick();
  assert.deepEqual(f.log.at(-1),['selection','[data-caption-text="0"]',0,2]);
  f.project().captions[0].text='gone'; f.query('#nextCaptionMatch').onclick();
  assert.deepEqual(f.log.at(-1),['selection','[data-caption-text="1"]',0,2]);
  f.project().captions=[]; const before=f.log.length; f.query('#previousCaptionMatch').onclick();
  assert.equal(f.log.length,before);
  assert.equal(f.query('#captionSearchStatus').textContent,'일치 0 / 0');
  assert.equal(f.query('#previousCaptionMatch').disabled,true);
  replacementInput(f,'','x'); f.query('#nextCaptionMatch').onclick();
  assert.equal(f.log.length,before);
});

test('caption add and delete dispatch shared commands with source timing and focus only on success', () => {
  const f = fixture();
  f.project().captions = [];
  f.query('#addCaption').onclick();
  assert.deepEqual(f.commands, [['captions.insert', {
    captionIndex: 0, caption: { start: 2, end: 5, text: '새로운 자막을 입력하세요' },
  }]]);
  f.query('[data-delete-caption]').onclick();
  assert.deepEqual(f.commands.at(-1), ['captions.remove', { captionIndex: 0 }]);
  assert.equal(f.project().captions.length, 0);
  assert.deepEqual(f.log.at(-2), ['focus', '#addCaption', { preventScroll: true }]);
  assert.equal(f.log.filter(event => event[0] === 'edit').length, 2);

  const blocked = fixture({ blocked: true }), before = structuredClone(blocked.project());
  blocked.query('#addCaption').onclick();
  blocked.query('[data-delete-caption]').onclick();
  assert.deepEqual(blocked.project(), before);
  assert.deepEqual(blocked.commands, []);
  assert.deepEqual(blocked.log, []);
});

test('composition and detached add/delete controls cannot dispatch commands or steal focus', () => {
  const f = fixture(), before = structuredClone(f.project());
  const add = f.query('#addCaption').onclick, remove = f.query('[data-delete-caption]').onclick;
  f.target.oncompositionstart();
  add(); remove();
  assert.deepEqual(f.project(), before);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.log, []);
  f.target.oncompositionend();
  f.panel.render(f.target, {}, {});
  add(); remove();
  assert.deepEqual(f.project(), before);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.log, []);
});

test('actual whole-list split refuses composition without history, save or focus changes', async () => {
  for (const mode of ['owner', 'event', 'key229']) {
    const f = await createAppFixture();
    vm.runInContext("state.captions=[{start:0,end:6,text:'오늘은 자막을 고쳐요. 다음은 시간을 맞춰요.',speaker:'0',keywords:'자막'}];history=[];future=[JSON.stringify(state)];current=2;globalThis.splitSaves=0;scheduleSave=()=>splitSaves++;switchPanel('captions');", f.context);
    const input = f.element('[data-caption-text="0"]'), button = f.element('#splitLongCaptions');
    input.value = '작성 중인 한글'; input.focus();
    f.element('#captionChunkSize').value = '12';
    if (mode === 'owner') f.element('#panelContent').oncompositionstart();
    const snapshot = () => f.evaluate('({state,history,future,current,saves:splitSaves})');
    const before = snapshot(), html = f.element('#panelContent').innerHTML, focusCount = f.focusEvents.length;
    const split = f.context.splitCaptionText; let splitCalls = 0;
    f.context.splitCaptionText = (...args) => { splitCalls++; return split(...args); };
    const event = mode === 'event' ? {isComposing:true} : mode === 'key229' ? {keyCode:229} : {};
    button.onclick(event); button.onclick(event);
    assert.deepEqual(snapshot(), before);
    assert.equal(splitCalls, 0, 'Refuse before inspecting or splitting committed text');
    assert.equal(f.element('#panelContent').innerHTML, html);
    assert.equal(f.doc.activeElement, input); assert.equal(f.focusEvents.length, focusCount);
    assert.equal(input.value, '작성 중인 한글');
    if (mode === 'owner') f.element('#panelContent').oncompositionend();
    assert.deepEqual(snapshot(), before); assert.equal(splitCalls, 0);
    input.value = before.state.captions[0].text; // Restore the draft before the explicit retry.
    button.onclick();
    assert.equal(splitCalls, 1);
    assert.deepEqual(f.evaluate('state.captions.map(c=>c.text)'), ['오늘은 자막을 고쳐요.', '다음은 시간을 맞춰요.']);
    assert.equal(f.evaluate('history.length'), 1); assert.equal(f.evaluate('future.length'), 0);
    assert.equal(f.evaluate('splitSaves'), 1); assert.equal(f.evaluate('current'), 2);
    assert.equal(f.doc.activeElement, f.element('#splitLongCaptions'));
    const after = snapshot(); button.onclick();
    assert.deepEqual(snapshot(), after, 'The detached pre-render button remains inert');
  }
});
