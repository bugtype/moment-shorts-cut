import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {bindEditorKeyboard} from '../dist/editor-interactions.mjs';
import {createAppFixture} from './fixtures/app.mjs';

function keyboard(save = true) {
  let handler, blocked = false;
  const calls = [];
  bindEditorKeyboard({addEventListener:(_, callback) => {handler = callback;}}, {
    blocked:() => blocked, save:save ? () => calls.push('save') : undefined,
    undo:() => calls.push('undo'), seekBy:() => calls.push('seek'), togglePlayback:() => calls.push('play'),
  });
  const press = (extra = {}) => handler({key:'s', code:'KeyS', ctrlKey:true,
    target:{tagName:'BODY'}, preventDefault:() => calls.push('prevent'), ...extra});
  return {calls, press, block:() => {blocked = true;}};
}

test('Save shortcut reuses logical Latin S and the non-Latin physical position without auto-repeat saves', () => {
  const f = keyboard();
  for (const key of ['s','S','ㄴ','ы','ש','σ','重']) for (const modifier of ['ctrlKey','metaKey']) {
    f.calls.length = 0;
    f.press({key, ctrlKey:false, [modifier]:true});
    f.press({key, ctrlKey:false, [modifier]:true, repeat:true});
    assert.deepEqual(f.calls, ['prevent','save','prevent'], key + '/' + modifier);
  }
  f.calls.length = 0; f.press({key:'s',code:'KeyD'});
  assert.deepEqual(f.calls, ['prevent','save'], 'Latin layouts keep logical S');
});

test('Save shortcut leaves editing, composition, modifiers and unavailable owners untouched', () => {
  const f = keyboard();
  for (const extra of [{isComposing:true},{keyCode:229},{defaultPrevented:true},
    {altKey:true},{shiftKey:true},{getModifierState:key => key === 'AltGraph'},{ctrlKey:false},
    ...['INPUT','TEXTAREA','SELECT','SUMMARY'].map(tagName => ({target:{tagName}})),
    {target:{tagName:'SPAN',isContentEditable:true}},
    {target:{tagName:'SPAN',closest:() => ({tagName:'TEXTAREA'})}},
    ...['Dead','Process','Unidentified','a','ß','🙂','\u0301',''].map(key => ({key,code:'KeyD'})),
    {key:'d',code:'KeyS'}, {key:';',code:'KeyS'},
  ]) f.press(extra);
  f.block(); f.press();
  assert.deepEqual(f.calls, []);
  const absent = keyboard(false); absent.press();
  assert.deepEqual(absent.calls, [], 'an unbound shortcut does not suppress the native key');
});

async function appFixture() {
  const f = await createAppFixture(), writes = [];
  let fail = false;
  f.context.localStorage.setItem = (key, value) => {
    if (fail) throw new DOMException('Quota failure', 'QuotaExceededError');
    writes.push([key, value]);
  };
  const run = code => vm.runInContext(code, f.context);
  // Observe the real async persistence promise; do not replace its implementation.
  run('globalThis.saving = null; globalThis.originalSave = app.saveProject; app.saveProject = show => saving = originalSave(show)');
  const press = (extra = {}) => {
    let prevented = false;
    f.documentEvents.get('keydown')({key:'s',code:'KeyS',ctrlKey:true,target:{tagName:'BUTTON'},
      preventDefault:() => {prevented = true;}, ...extra});
    return prevented;
  };
  return {...f, run, press, writes, fail:value => {fail = value;}, saved:() => run('saving')};
}

for (const locale of ['ko','en','zh-CN']) test(`${locale}: keyboard Save persists the same project without history, focus or playback changes`, async () => {
  const f = await appFixture();
  f.run(`setLocale('${locale}',{persist:false}); edit(() => state.name = 'Keyboard save'); current=2.5; playing=true`);
  const before = f.evaluate('({state,history,future,current,playing})'), focus = f.doc.activeElement;
  assert.equal(f.press(), true); await f.saved();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][0], 'moment-state-v1');
  assert.deepEqual(JSON.parse(f.writes[0][1]), before.state);
  assert.deepEqual(f.evaluate('({state,history,future,current,playing})'), before);
  assert.equal(f.doc.activeElement, focus);
  assert.equal(f.evaluate('persistence.hasUnsavedChanges()'), false);
  assert.equal(f.element('#toast').getAttribute('data-i18n'), 'errors.savedNotice');
  assert.equal(f.press({repeat:true}), true); await f.saved();
  assert.equal(f.writes.length, 1);
  f.element('#saveButton').onclick(); await f.saved();
  assert.deepEqual(f.writes[1], f.writes[0], 'existing button has identical persistence effect');
});

test('actual shortcut preserves draft fields and modal/export ownership', async () => {
  const f = await appFixture();
  const input = f.element('#projectName'); input.tagName = 'INPUT'; input.value = 'Uncommitted draft';
  const before = f.evaluate('({state,history,future})');
  for (const extra of [{target:input},{isComposing:true},{keyCode:229},{shiftKey:true},{altKey:true}])
    assert.equal(f.press(extra), false);
  f.run('modal.open=true'); assert.equal(f.press(), false);
  f.run('modal.open=false; exporting=true'); assert.equal(f.press(), false);
  assert.deepEqual(f.writes, []); assert.equal(f.saved(), null);
  assert.deepEqual(f.evaluate('({state,history,future})'), before);
  assert.equal(input.value, 'Uncommitted draft');
});

test('actual shortcut retains storage failure reporting and permits explicit retry', async () => {
  const f = await appFixture(); f.run("edit(() => state.name = 'Retry me')"); f.fail(true);
  assert.equal(f.press(), true); await f.saved();
  assert.equal(f.writes.length, 0);
  assert.equal(f.element('#saveStatusText').getAttribute('data-i18n'), 'errors.checkStorage');
  assert.equal(f.element('#toast').getAttribute('data-i18n'), 'errors.storageBlocked');
  assert.equal(f.evaluate('persistence.hasUnsavedChanges()'), true);
  f.fail(false); f.press(); await f.saved();
  assert.equal(JSON.parse(f.writes[0][1]).name, 'Retry me');
  assert.equal(f.evaluate('persistence.hasUnsavedChanges()'), false);
});

test('actual shortcut keeps restoring and failed recovery zero-write', async () => {
  for (const phase of ['restoring','failed']) for (const valid of [false,true]) {
    const f = await appFixture();
    f.run(`persistence.restorePhase='${phase}'; persistence.recoveryValid=${valid}`);
    const before = f.evaluate('({state,history,future})');
    assert.equal(f.press(), true); await f.saved();
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.evaluate('({state,history,future})'), before);
    assert.notEqual(f.element('#toast').getAttribute('data-i18n'), 'errors.savedNotice');
  }
});

test('Save advertises the shortcut and help describes browser storage, not a downloaded backup', async () => {
  const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url),'utf8');
  assert.match(html, /<button[^>]*id="saveButton"[^>]*aria-keyshortcuts="Control\+S Meta\+S"/);
  const f = await createAppFixture(); f.run = code => vm.runInContext(code, f.context);
  f.run('showHelp()');
  assert.match(f.element('#modal').innerHTML, /Ctrl\/Cmd S/);
  assert.match(f.element('#modal').innerHTML, /data-i18n="errors.saveInBrowser"/);
});
