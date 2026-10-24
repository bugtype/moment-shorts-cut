import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { prepareCommand } from '../dist/core/commands.mjs';
import { setLocale, initLocale } from '../dist/i18n.mjs';

async function fixture() {
    const f = await createAppFixture();
    vm.runInContext(`
        state.duration=300;state.clips=[{start:0,end:300}];
        state.captions=Array.from({length:101},(_,i)=>({start:i+10,end:i+11,text:'cue '+i,
            basis:i%2?'timeline':'source',speaker:'1',keywords:'keep',timing:'estimated'}));
        state.audioOffset=3;current=2;history=[];future=[];switchPanel('captions');
    `, f.context);
    f.open = event => f.element('#shiftCaptionRange').onclick(event || {});
    f.apply = ({first, last, basis, delta} = {}) => {
        for (const [id, value] of [['First',first],['Last',last],['Basis',basis],['Delta',delta]]) {
            if (value !== undefined) f.element('#shiftRange' + id).value = String(value);
        }
        f.element('#confirmShiftRange').onclick({});
    };
    return f;
}

test('range shift uses authored indices across pages and changes matching basis only in one undo', async () => {
    for (const speed of [.25,4]) {
        const f = await fixture();
        vm.runInContext(`state.speed=${speed}`, f.context);
        const before = f.evaluate('state');
        f.element('#nextCaptionPage').onclick();
        f.open();
        assert.equal(f.element('#shiftRangeFirst').value, '51');
        assert.equal(f.element('#shiftRangeLast').value, '51');
        assert.equal(f.element('#shiftRangeBasis').value, 'source');
        assert.equal(f.element('#shiftRangeDelta').value, '0');
        const args = {captionIndex:48,count:4,basis:'source',delta:2.25};
        const expected = prepareCommand(before,'captions.timing.shift',args).project;
        f.apply({first:49,last:52,basis:'source',delta:2.25});
        assert.deepEqual(f.evaluate('state'), expected);
        assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.evaluate('current'), 2);
        assert.equal(f.evaluate('state.audioOffset'), 3);
        assert.equal(f.doc.activeElement, f.element('#shiftCaptionRange'));
        vm.runInContext('undo()', f.context);
        assert.deepEqual(f.evaluate('state'), before);
        vm.runInContext('undo(true)', f.context);
        assert.deepEqual(f.evaluate('state'), expected);
    }
});

test('timeline negative shift remains pre-speed; successful commit preserves existing trim drafts', async () => {
    const f = await fixture();
    vm.runInContext('state.speed=4;renderInspector()', f.context);
    f.element('#trimStart').value = '1.2345';
    f.element('#trimEnd').value = '299';
    const before = f.evaluate('state');
    f.open();
    f.apply({first:1,last:4,basis:'timeline',delta:-.5});
    assert.equal(f.evaluate('state.captions[1].start'), 10.5);
    assert.equal(f.evaluate('state.captions[0].start'), before.captions[0].start);
    assert.equal(f.element('#trimStart').value, '1.2345');
    assert.equal(f.element('#trimEnd').value, '299');
    assert.equal(f.evaluate('history.length'), 1);
});

test('cancel, zero shift and no matching basis do not edit, pause or replace search drafts', async () => {
    const f = await fixture();
    vm.runInContext('playing=true', f.context);
    f.element('#captionFind').value = 'draft';
    const before = f.evaluate('({state,history,current,playing})');
    f.open();
    f.element('#cancelShiftRange').onclick();
    assert.deepEqual(f.evaluate('({state,history,current,playing})'), before);
    f.open();
    f.apply({delta:0});
    assert.deepEqual(f.evaluate('({state,history,current,playing})'), before);
    f.open();
    f.apply({first:2,last:2,basis:'source',delta:2});
    assert.deepEqual(f.evaluate('({state,history,current,playing})'), before);
    assert.equal(f.element('#toast').textContent, '변경된 자막 시간이 없습니다.');
    assert.equal(f.element('#captionFind').value, 'draft');
    assert.equal(f.evaluate('!!modal.open'), false);
});

test('invalid intervals, blank/nonfinite delta, invalid basis and timing overflow are atomic', async () => {
    const f = await fixture();
    const before = f.evaluate('state');
    for (const patch of [
        {first:'',last:1,delta:1}, {first:0,last:1,delta:1}, {first:1.5,last:2,delta:1},
        {first:2,last:1,delta:1}, {first:1,last:102,delta:0},
        {first:1,last:1,delta:''}, {first:1,last:1,delta:'Infinity'},
        {first:1,last:1,basis:'invalid',delta:1},
        {first:1,last:101,basis:'source',delta:-11},
        {first:1,last:101,basis:'timeline',delta:300},
    ]) {
        f.open();
        f.apply(patch);
        assert.deepEqual(f.evaluate('state'), before);
        assert.equal(f.evaluate('history.length'), 0);
        assert.equal(f.evaluate('!!modal.open'), true);
        f.element('#cancelShiftRange').onclick();
    }
});

test('stale project/media/panel, busy and invalid recovery refuse range commits', async () => {
    for (const mutation of [
        'state=structuredClone(state)', "state.name='changed'", 'state.speed=2',
        'sources.videoFile={}', 'sources.audioFile={}', "switchPanel('media')",
        'loadingMedia=true', 'exporting=true', 'transcribing=true',
        "persistence.restorePhase='restoring'", "persistence.restorePhase='failed';persistence.recoveryValid=false",
    ]) {
        const f = await fixture();
        f.open();
        vm.runInContext(mutation, f.context);
        const before = f.evaluate('state');
        f.apply({delta:1});
        assert.deepEqual(f.evaluate('state'), before);
        assert.equal(f.evaluate('history.length'), 0, mutation);
    }
});

test('detached modal/opener, IME and modified Enter are inert; native select Enter remains unhandled', async () => {
    const f = await fixture();
    const oldOpen = f.element('#shiftCaptionRange').onclick;
    vm.runInContext('renderPanel()', f.context);
    oldOpen({});
    assert.equal(f.evaluate('!!modal.open'), false);
    f.open({isComposing:true});
    assert.equal(f.evaluate('!!modal.open'), false);
    f.open();
    const oldConfirm = f.element('#confirmShiftRange').onclick;
    f.element('#cancelShiftRange').onclick();
    f.open();
    oldConfirm({});
    assert.equal(f.evaluate('history.length'), 0);
    const delta = f.element('#shiftRangeDelta');
    delta.value = '1';
    delta.oncompositionstart();
    f.apply();
    delta.oncompositionend();
    let prevented = 0;
    for (const flags of [{isComposing:true},{keyCode:229},{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true}]) {
        delta.onkeydown({key:'Enter',preventDefault(){prevented++;},...flags});
    }
    assert.equal(prevented, 0);
    assert.equal(typeof f.element('#shiftRangeBasis').onkeydown, 'undefined');
    delta.onkeydown({key:'Enter',preventDefault(){prevented++;}});
    assert.equal(prevented, 1);
    assert.equal(f.evaluate('history.length'), 1);
    f.open();
    const stale = f.element('#confirmShiftRange').onclick;
    vm.runInContext("modalOpen('new modal','content')", f.context);
    const focus = f.doc.activeElement;
    stale({});
    assert.equal(f.doc.activeElement, focus);
    assert.equal(f.evaluate('history.length'), 1);
});

test('failed-valid metadata shift and undo stay memory-only; locale switching preserves dialog drafts', async () => {
    try {
        for (const [locale,label] of [['ko','시간 기준'],['en','timing basis'],['zh-CN','时间基准']]) {
            const f = await fixture(), writes = [];
            f.context.localStorage.setItem = (...args) => writes.push(args);
            setLocale(locale,{persist:false});
            vm.runInContext("persistence.restorePhase='failed';persistence.recoveryValid=true",f.context);
            f.open();
            assert.ok(f.element('#modal').innerHTML.includes(label));
            const node = f.element('#shiftRangeDelta'), handler = node.onkeydown;
            node.value = '1.25';
            setLocale(locale==='ko'?'en':'ko',{persist:false});
            assert.equal(f.element('#shiftRangeDelta'), node);
            assert.equal(node.onkeydown, handler);
            assert.equal(node.value, '1.25');
            f.apply();
            assert.equal(f.evaluate('history.length'), 1);
            await vm.runInContext('saveProject(true);scheduleSave();undo()', f.context);
            assert.deepEqual(writes, []);
        }
    } finally { initLocale(); }
});

test('successful shift focuses replacement action and empty caption arrays cannot open a range', async () => {
    const f = await fixture(), root = f.element('#panelContent'), query = f.doc.querySelector;
    let markup = root.innerHTML, current = f.element('#shiftCaptionRange');
    const original = current;
    f.doc.querySelector = selector => selector==='#shiftCaptionRange' ? current : query(selector);
    Object.defineProperty(root,'innerHTML',{
        configurable:true,get:()=>markup,
        set:value=>{markup=value;current={focus(){f.doc.activeElement=this;}};},
    });
    original.onclick({});
    f.apply({delta:1});
    assert.notEqual(current, original);
    assert.equal(f.doc.activeElement, current);
    vm.runInContext('state.captions=[];renderPanel()', f.context);
    assert.match(root.innerHTML,/id="shiftCaptionRange" disabled/);
    current.onclick({});
    assert.equal(f.evaluate('!!modal.open'), false);
});
