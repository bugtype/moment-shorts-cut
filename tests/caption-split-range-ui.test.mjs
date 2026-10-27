import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { setLocale } from '../dist/i18n.mjs';

async function fixture(setup = '') {
    const f = await createAppFixture();
    vm.runInContext(`state.captions=Array.from({length:101},(_,i)=>({start:1,end:4,text:'A long authored caption with several words '+i,basis:i%2?'timeline':'source',speaker:'0',keywords:'authored'}));history=[];future=[];current=2;switchPanel('captions');${setup}`, f.context);
    f.open = event => f.element('#splitCaptionRange').onclick(event);
    f.confirm = (first, last) => {
        f.element('#splitRangeFirst').value = String(first);
        f.element('#splitRangeLast').value = String(last);
        f.element('#confirmSplitRange').onclick();
    };
    f.snapshot = () => f.evaluate('({state,history,future,current,playing})');
    return f;
}

test('numeric Enter splits the owned range once; IME, handled, modified and stale keys stay inert', async () => {
    const f = await fixture(), before = f.evaluate('state');
    f.element('#captionChunkSize').value = '12';
    const expected = prepareCommand(before, 'captions.split.long', {limit:12, captionIndex:0, count:1}).project;
    assert.ok(expected.captions.length > before.captions.length);
    f.open();
    const input = f.element('#splitRangeFirst'), oldKeydown = input.onkeydown;
    let prevented = 0;
    const enter = extra => input.onkeydown({key:'Enter', preventDefault(){prevented++;}, ...extra});
    for (const extra of [{key:'Escape'}, {defaultPrevented:true}, {isComposing:true}, {keyCode:229},
        {ctrlKey:true}, {metaKey:true}, {altKey:true}, {shiftKey:true}]) enter(extra);
    input.oncompositionstart(); enter(); input.oncompositionend();
    assert.equal(prevented, 0);
    assert.deepEqual(f.evaluate('state'), before);
    assert.equal(f.evaluate('history.length'), 0);
    assert.equal(f.element('#modal').open, true);
    assert.equal(typeof f.element('#splitRangeLimit').onkeydown, 'undefined');
    enter();
    assert.equal(prevented, 1);
    assert.deepEqual(f.evaluate('state'), expected);
    assert.equal(f.evaluate('history.length'), 1);
    assert.equal(f.element('#modal').open, false);
    assert.equal(f.doc.activeElement, f.element('#splitCaptionRange'));
    f.open();
    oldKeydown({get key(){assert.fail('stale handler read the event');}});
    assert.equal(f.element('#modal').open, true);
    assert.equal(f.evaluate('history.length'), 1);
    f.element('#cancelSplitRange').onclick();
    vm.runInContext('undo()', f.context);
    assert.deepEqual(f.evaluate('state'), before);
});

test('range split carries the preset and changes only explicit authored rows in one Undo', async () => {
    const f = await fixture();
    const before = f.evaluate('state');
    f.element('#captionChunkSize').value = '12';
    f.open();
    assert.equal(f.element('#splitRangeLimit').value, '12');
    assert.equal(f.element('#splitRangeFirst').value, '1');
    assert.equal(f.element('#splitRangeLast').value, '1');
    const expected = prepareCommand(before, 'captions.split.long', { limit: 12, captionIndex: 49, count: 2 }).project;
    f.confirm(50, 51);
    assert.deepEqual(f.evaluate('state'), expected);
    assert.equal(f.evaluate('history.length'), 1);
    assert.equal(f.evaluate('current'), 2);
    assert.equal(f.context.document.activeElement, f.element('#splitCaptionRange'));
    vm.runInContext('undo()', f.context);
    assert.deepEqual(f.evaluate('state'), before);
    vm.runInContext('undo(true)', f.context);
    assert.deepEqual(f.evaluate('state'), expected);
});

test('current-page single default, native select keys and locale switching preserve dialog drafts', async () => {
    for (const locale of ['ko', 'en', 'zh-CN']) {
        const f = await fixture();
        setLocale(locale, { persist: false });
        f.element('#nextCaptionPage').onclick();
        f.element('#captionChunkSize').value = '24';
        f.open();
        assert.equal(f.element('#splitRangeFirst').value, '51');
        assert.equal(f.element('#splitRangeLast').value, '51');
        assert.equal(f.element('#splitRangeLimit').value, '24');
        assert.equal(typeof f.element('#splitRangeLimit').onkeydown, 'undefined');
        f.element('#splitRangeLast').value = '70';
        setLocale('en', { persist: false });
        assert.equal(f.element('#splitRangeLast').value, '70');
        f.element('#cancelSplitRange').onclick();
        assert.equal(f.evaluate('history.length'), 0);
    }
});

test('no-op and cancellation preserve playback, search drafts and history', async () => {
    const f = await fixture("state.captions[0].text='short';playing=true;");
    f.element('#captionFind').value = 'authored';
    f.element('#captionFind').oninput();
    const before = f.snapshot();
    f.open(); f.confirm(1, 1);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.element('#captionFind').value, 'authored');
    assert.equal(f.element('#modal').open, false);
    f.open(); f.element('#cancelSplitRange').onclick();
    assert.deepEqual(f.snapshot(), before);
});

test('invalid bounds and total-caption overflow reject atomically', async () => {
    const f = await fixture();
    f.open();
    const before = f.snapshot();
    for (const [first, last] of [['', 1], [0, 1], [2, 1], [1, 102], [1.5, 2]]) {
        f.confirm(first, last);
        assert.deepEqual(f.snapshot(), before);
    }
    f.element('#splitRangeLimit').value = '13';
    f.confirm(1, 1);
    assert.deepEqual(f.snapshot(), before);
    const full = await fixture("state.captions=Array.from({length:10000},()=>({start:0,end:2,text:'A sufficiently long caption to split into pieces'}));renderPanel();");
    full.open(); const original = full.snapshot(); full.confirm(1, 1);
    assert.deepEqual(full.snapshot(), original);
});

test('owned busy retry works but stale project/media/panel and old dialogs cannot split', async () => {
    for (const mutation of ['state=structuredClone(state)', 'state.speed=2', 'sources.videoFile={}', 'sources.audioFile={}', "panel='text'", 'loadingMedia=true', 'exporting=true', 'transcribing=true']) {
        const f = await fixture(); f.open();
        vm.runInContext(mutation, f.context);
        const before = f.snapshot(); f.confirm(1, 2);
        assert.deepEqual(f.snapshot(), before);
    }
    const f = await fixture(); f.open();
    const oldConfirm = f.element('#confirmSplitRange').onclick;
    f.element('#cancelSplitRange').onclick(); f.open();
    oldConfirm(); assert.equal(f.evaluate('history.length'), 0);
    f.element('#splitRangeFirst').oncompositionstart(); f.confirm(1, 2);
    assert.equal(f.evaluate('history.length'), 0);
    f.element('#splitRangeFirst').oncompositionend();
    vm.runInContext('loadingMedia=true', f.context); f.confirm(1, 2);
    vm.runInContext('loadingMedia=false', f.context); f.confirm(1, 2);
    assert.equal(f.evaluate('history.length'), 1);
});

test('failed-valid metadata editing stays in memory and stale/IME openers stay inert', async () => {
    const f = await fixture("Object.defineProperty(persistence,'restorePhase',{get:()=> 'failed'});Object.defineProperty(persistence,'recoveryValid',{get:()=>true});globalThis.writes=0;localStorage.setItem=()=>writes++;projectStore.setMedia=async()=>writes++;");
    f.open({ isComposing: true }); assert.equal(!!f.element('#modal').open, false);
    const oldOpen = f.element('#splitCaptionRange').onclick;
    vm.runInContext('renderPanel()', f.context);
    oldOpen(); assert.equal(!!f.element('#modal').open, false);
    f.open(); f.confirm(1, 2);
    assert.equal(f.evaluate('history.length'), 1);
    await vm.runInContext('saveProject(true)', f.context);
    vm.runInContext('scheduleSave();persistMedia();', f.context);
    await Promise.resolve();
    assert.equal(f.evaluate('writes'), 0);
});
