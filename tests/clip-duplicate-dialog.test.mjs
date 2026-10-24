import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { setLocale } from '../dist/i18n.mjs';

async function fixture(setup = '') {
    const f = await createAppFixture();
    vm.runInContext(`state.clips=[{start:0,end:2},{start:3,end:6},{start:8,end:12},{start:0,end:2}];timelineCache=null;selected=1;current=3;history=[];future=[];${setup}`, f.context);
    for (const id of ['duplicateClipRangeButton', 'panelDuplicateClipRange']) f.element('#' + id).id = id;
    f.open = event => f.element('#duplicateClipRangeButton').onclick(event);
    f.confirm = (first, last, event) => {
        f.element('#duplicateRangeFirst').value = String(first);
        f.element('#duplicateRangeLast').value = String(last);
        f.element('#confirmDuplicateRange').onclick(event);
    };
    f.snapshot = () => f.evaluate('({state,history,future,current,selected,playing})');
    return f;
}

test('inclusive blocks duplicate atomically, select first copy, retime once and undo/redo exactly', async () => {
    for (const [first, last] of [[1, 2], [2, 3], [3, 4], [1, 4], [2, 2]]) {
        const f = await fixture();
        const before = f.evaluate('state');
        const expected = prepareCommand(before, 'timeline.duplicate', { clipIndex: first - 1, count: last - first + 1 }).project;
        f.open();
        assert.equal(f.element('#duplicateRangeFirst').value, '2');
        assert.equal(f.element('#duplicateRangeLast').value, '2');
        f.confirm(first, last);
        assert.deepEqual(f.evaluate('state'), expected);
        assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.evaluate('selected'), last);
        assert.equal(f.evaluate('current'), expected.clips.slice(0, last).reduce((sum, clip) => sum + clip.end - clip.start, 0));
        assert.equal(!!f.element('#modal').open, false);
        assert.equal(f.context.document.activeElement, f.element('#duplicateClipRangeButton'));
        vm.runInContext('undo()', f.context);
        assert.deepEqual(f.evaluate('state'), before);
        vm.runInContext('undo(true)', f.context);
        assert.deepEqual(f.evaluate('state'), expected);
    }
});

test('invalid bounds, capacity overflow, cancel and IME preserve state and trim drafts', async () => {
    const f = await fixture('playing=true;');
    f.element('#trimStart').value = 'draft';
    const before = f.snapshot();
    f.open();
    for (const [first, last] of [['', 2], [0, 2], [3, 2], [1, 5], [1.5, 2], ['Infinity', 2]]) {
        f.confirm(first, last);
        assert.deepEqual(f.snapshot(), before);
    }
    f.confirm(1, 2, { isComposing: true });
    f.element('#duplicateRangeFirst').oncompositionstart();
    f.confirm(1, 2);
    assert.deepEqual(f.snapshot(), before);
    f.element('#duplicateRangeFirst').oncompositionend();
    f.element('#cancelDuplicateRange').onclick();
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.element('#trimStart').value, 'draft');
    const full = await fixture('state.clips=Array.from({length:1000},()=>({start:0,end:1}));timelineCache=null;');
    full.open();
    const fullBefore = full.snapshot();
    full.confirm(1, 1);
    assert.deepEqual(full.snapshot(), fullBefore);
    assert.equal(full.element('#modal').open, true);
});

test('stale project/media/panel/selection and busy guards reject; same owned busy dialog retries', async () => {
    for (const mutation of ['state=structuredClone(state)', 'state.speed=2', 'selected=0', "panel='text'", 'sources.videoFile={}', 'sources.audioFile={}', 'exporting=true', 'loadingMedia=true', 'transcribing=true', 'editorReady=false', "Object.defineProperty(persistence,'restorePhase',{get:()=> 'restoring'})", "Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'})"]) {
        const f = await fixture();
        f.open();
        vm.runInContext(mutation, f.context);
        const before = f.snapshot();
        f.confirm(1, 2);
        assert.deepEqual(f.snapshot(), before, mutation);
    }
    const f = await fixture();
    f.open();
    vm.runInContext('loadingMedia=true', f.context);
    f.confirm(1, 2);
    vm.runInContext('loadingMedia=false', f.context);
    f.confirm(1, 2);
    assert.equal(f.evaluate('history.length'), 1);
});

test('closed/replaced dialog callbacks and stale compact-panel openers are inert', async () => {
    const f = await fixture();
    f.open({ keyCode: 229 });
    assert.equal(!!f.element('#modal').open, false);
    f.open();
    const oldConfirm = f.element('#confirmDuplicateRange').onclick;
    const oldCancel = f.element('#cancelDuplicateRange').onclick;
    f.element('#cancelDuplicateRange').onclick();
    f.open();
    f.element('#modal').onclose();
    const before = f.snapshot();
    oldConfirm(); oldCancel();
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.element('#modal').open, true);
    f.element('#cancelDuplicateRange').onclick();
    vm.runInContext("switchPanel('settings')", f.context);
    const oldOpen = f.element('#panelDuplicateClipRange').onclick;
    vm.runInContext("switchPanel('settings')", f.context);
    oldOpen();
    assert.equal(!!f.element('#modal').open, false);
    f.element('#panelDuplicateClipRange').onclick();
    f.confirm(1, 2);
    assert.equal(f.context.document.activeElement, f.element('#panelDuplicateClipRange'));
});

test('valid failed recovery duplicates and undoes in memory with no persistence writes', async () => {
    const f = await fixture("Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'});Object.defineProperty(persistence,'recoveryValid',{get:()=>true});");
    vm.runInContext('globalThis.writes=0;projectStore.setMedia=async()=>writes++;localStorage.setItem=()=>writes++;', f.context);
    const before = f.evaluate('state');
    f.open(); f.confirm(1, 2);
    assert.equal(f.evaluate('history.length'), 1);
    await vm.runInContext('saveProject(true)', f.context);
    vm.runInContext('persistMedia();scheduleSave();undo();', f.context);
    await Promise.resolve();
    assert.equal(f.evaluate('writes'), 0);
    assert.deepEqual(f.evaluate('state'), before);
});

test('three locales expose the same desktop/compact action and preserve numeric drafts', async () => {
    for (const [locale, label] of [['ko', '클립 범위 복제…'], ['en', 'Duplicate clip range…'], ['zh-CN', '复制片段范围…']]) {
        const f = await fixture();
        setLocale(locale, { persist: false });
        vm.runInContext("switchPanel('settings')", f.context);
        assert.ok(f.element('#panelContent').innerHTML.includes(label));
        f.element('#panelDuplicateClipRange').onclick();
        assert.equal(f.element('#modal').open, true);
        assert.equal(f.element('#duplicateRangeFirst').value, '2');
        f.element('#duplicateRangeFirst').value = '3';
        setLocale('ko', { persist: false });
        assert.equal(f.element('#duplicateRangeFirst').value, '3');
    }
});
