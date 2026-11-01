import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {bindEditorKeyboard} from '../dist/editor-interactions.mjs';
import {createAppFixture} from './fixtures/app.mjs';

// Event values model keyboard layouts; no native keyboard/IME automation is used.
const letters = ['ㅋ', '重', 'つ', 'я', 'Я', 'ζ', 'ז', 'ѕ', 'α\u0301'];
function fixture() {
  let handler, blocked = false;
  const calls = [];
  bindEditorKeyboard({addEventListener:(_, callback) => {handler = callback;}}, {
    blocked:() => blocked, undo:redo => calls.push(redo ? 'redo' : 'undo'),
    togglePlayback:() => calls.push('play'), seekBy:() => calls.push('seek'),
  });
  const press = (key, extra = {}) => handler({key, code:'KeyZ', ctrlKey:true,
    target:{tagName:'BODY'}, preventDefault:() => calls.push('prevent'), ...extra});
  return {calls, press, block:() => {blocked = true;}};
}

test('non-Latin writing keys use KeyZ for existing Ctrl/Meta Undo and Shift Redo', () => {
  const f = fixture();
  for (const key of letters) for (const modifier of ['ctrlKey', 'metaKey']) {
    for (const shiftKey of [false, true]) {
      f.calls.length = 0;
      f.press(key, {ctrlKey:false, [modifier]:true, shiftKey});
      assert.deepEqual(f.calls, ['prevent', shiftKey ? 'redo' : 'undo'], `${key}/${modifier}/${shiftKey}`);
    }
  }
});

test('Latin layout characters remain authoritative over physical positions', () => {
  const f = fixture();
  for (const code of ['KeyZ', 'KeyY', 'KeyW', 'Semicolon', 'KeyN', '']) {
    for (const key of ['z', 'Z']) {
      f.calls.length = 0; f.press(key, {code});
      assert.deepEqual(f.calls, ['prevent', 'undo'], `${key}/${code}`);
    }
  }
  for (const key of ['y', 'Y', 'w', 'W', 'a', 'q', "'", ';', '1']) {
    f.calls.length = 0; f.press(key);
    assert.deepEqual(f.calls, [], `${key}/KeyZ must keep its own meaning`);
  }
});

test('native input, composition, AltGraph, unrelated keys and blocked owners retain their events', () => {
  const f = fixture();
  const guards = [{isComposing:true}, {keyCode:229}, {defaultPrevented:true},
    {altKey:true}, {getModifierState:name => name === 'AltGraph'}, {ctrlKey:false},
    ...['INPUT','TEXTAREA','SELECT','SUMMARY'].map(tagName => ({target:{tagName}})),
    {target:{tagName:'SPAN', isContentEditable:true}},
    {target:{tagName:'SPAN', closest:() => ({tagName:'INPUT'})}},
  ];
  for (const key of ['z', ...letters]) for (const guard of guards) f.press(key, guard);
  for (const key of ['', 'Dead', 'Process', 'Unidentified', 'Shift', '🙂', '。', '\u0301']) f.press(key);
  for (const key of letters) for (const code of ['', 'KeyY', 'Unidentified']) f.press(key, {code});
  assert.deepEqual(f.calls, []);
  f.block(); for (const key of ['z', ...letters]) f.press(key);
  assert.deepEqual(f.calls, []);
});

test('history repeat remains available without adding new redo shortcuts', () => {
  const f = fixture();
  f.press('ㅋ'); f.press('ㅋ', {repeat:true});
  f.press('ㅋ', {repeat:true, shiftKey:true});
  assert.deepEqual(f.calls, ['prevent','undo','prevent','undo','prevent','redo']);
  f.calls.length = 0;
  f.press('y', {code:'KeyY'}); f.press('ㅛ', {code:'KeyY'});
  assert.deepEqual(f.calls, [], 'Ctrl+Y is not introduced by this fix');
});

for (const locale of ['ko', 'en', 'zh-CN']) test(`${locale}: actual project Undo/Redo works without changing input layout`, async () => {
  for (const key of ['ㅋ', 'я', 'ζ', '重']) for (const modifier of ['ctrlKey','metaKey']) {
    const f = await createAppFixture();
    f.element('#projectName').tagName = 'INPUT';
    vm.runInContext(`setLocale('${locale}',{persist:false})`, f.context);
    const original = f.evaluate('state');
    vm.runInContext("edit(()=>state.name='Changed title')", f.context);
    const changed = f.evaluate('state'); let prevented = 0;
    const press = (shiftKey, extra = {}) => f.documentEvents.get('keydown')({key, code:'KeyZ', [modifier]:true, shiftKey,
      target:f.element('#addCaption'), preventDefault:() => prevented++, ...extra});
    const before = f.evaluate('({state,history,future,current,playing,playRequest})');
    for (const guard of [{target:f.element('#projectName')}, {isComposing:true}, {keyCode:229}, {altKey:true}]) press(false, guard);
    vm.runInContext('modal.open=true', f.context); press(false);
    vm.runInContext('modal.open=false;exporting=true', f.context); press(false);
    vm.runInContext('exporting=false', f.context);
    assert.deepEqual(f.evaluate('({state,history,future,current,playing,playRequest})'), before);
    assert.equal(prevented, 0);
    press(false); assert.deepEqual(f.evaluate('state'), original);
    assert.equal(f.evaluate('history.length'), 0); assert.equal(f.evaluate('future.length'), 1);
    press(true); assert.deepEqual(f.evaluate('state'), changed);
    assert.equal(f.evaluate('history.length'), 1); assert.equal(f.evaluate('future.length'), 0);
    assert.equal(prevented, 2); assert.equal(f.evaluate('getLocale()'), locale);
  }
});
