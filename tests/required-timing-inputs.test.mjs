import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

async function fixture(kind, { basis = 'source', speed = 4 } = {}) {
    const f = await createAppFixture();
    const root = f.element('#panelContent');
    const target = kind === 'card' ? root.querySelector('#effectControls') : root;
    const inputs = Object.fromEntries(['start', 'end'].map(side => {
        const selector = kind === 'caption' ? `[data-caption-${side}="0"]`
            : kind === 'card' ? `[data-card="${side}"]` : `[data-design="design.${kind}.${side}"]`;
        const input = kind === 'caption' ? f.element(selector) : target.querySelector(selector);
        input.type = 'number';
        if (kind === 'caption') input.dataset[side === 'start' ? 'captionStart' : 'captionEnd'] = '0';
        else input.dataset[kind === 'card' ? 'card' : 'design'] = kind === 'card' ? side : `design.${kind}.${side}`;
        input.reportValidity = () => { input.validityReports = (input.validityReports || 0) + 1; };
        return [side, input];
    }));
    if (kind === 'caption') {
        const queryAll = f.doc.querySelectorAll;
        f.doc.querySelectorAll = selector => {
            const side = selector.match(/^\[data-caption-(start|end)\]$/)?.[1];
            return side ? [inputs[side]] : queryAll(selector);
        };
    } else {
        const queryAll = target.querySelectorAll.bind(target);
        target.querySelectorAll = selector => selector === (kind === 'card' ? '[data-card]' : '[data-design]')
            ? Object.values(inputs) : queryAll(selector);
    }
    vm.runInContext(`
        state.clips=[{start:2,end:6},{start:0,end:4}];state.speed=${speed};
        state.captions=[{start:.23456789,end:.987654321,text:'Keep caption',basis:'${basis}',
            timing:'estimated',speaker:'0',keywords:'Keep'}];
        state.overlays=[{...newCard(8/state.speed),id:'timing-card',start:.23456789,end:.987654321,text:'Keep card'}];
        for(const layer of ['title','credit']){state.design[layer].start=.23456789;state.design[layer].end=.987654321;}
        selectedCard='timing-card';selected=1;current=2;effectTab='cards';textLayer='${kind === 'credit' ? 'credit' : 'title'}';
        history=[];future=[JSON.stringify(state)];globalThis.saves=0;scheduleSave=()=>saves++;
        switchPanel('${kind === 'caption' ? 'captions' : kind === 'card' ? 'effects' : 'text'}');
    `, f.context);
    const model = kind === 'caption' ? 'state.captions[0]' : kind === 'card' ? 'state.overlays[0]' : `state.design.${kind}`;
    f.input = side => inputs[side];
    f.value = side => f.evaluate(`${model}.${side}`);
    f.snapshot = () => f.evaluate('({state,history,future,current,selected,selectedCard,saves})');
    f.change = (side, value, badInput = false) => {
        // Explicit DOM-facing values, not browser typing/sanitization or IME emulation.
        // A cleared number and an invalid numeric UI may both expose value="".
        const input = inputs[side];
        input.value = String(value);
        input.validity = { badInput };
        input.onchange();
    };
    f.assertWarning = side => {
        if (kind === 'caption') {
            assert.equal(f.element('#toast').getAttribute('data-i18n'), 'panels.captionTimingInvalid');
            const tag = root.innerHTML.match(new RegExp(`<input[^>]*data-caption-${side}="0"[^>]*>`))?.[0];
            assert.ok(tag, 'the existing invalid-caption path redraws the saved endpoint');
            assert.equal(Number(tag.match(/value="([^"]*)"/)[1]), f.value(side));
        } else {
            const input = inputs[side];
            assert.equal(input.getAttribute('data-i18n-validity'), kind === 'card' ? 'panels.cardTimingInvalid' : 'panels.timingInvalid');
            assert.ok(input.validationMessage);
            assert.ok(input.validityReports > 0);
        }
    };
    return f;
}

for (const basis of ['source', 'timeline']) {
    test(`${basis} caption endpoints reject empty and bad-input empty values without changing project or history`, async () => {
        const f = await fixture('caption', { basis }), before = f.snapshot();
        for (const side of ['start', 'end']) for (const badInput of [false, true]) {
            f.change(side, '', badInput);
            assert.deepEqual(f.snapshot(), before);
            f.assertWarning(side);
        }
    });
}

test('required card endpoints reject empty and bad-input empty values at both output-speed extremes', async () => {
    for (const speed of [.25, 4]) {
        const f = await fixture('card', { speed }), before = f.snapshot();
        for (const side of ['start', 'end']) for (const badInput of [false, true]) {
            f.change(side, '', badInput);
            assert.deepEqual(f.snapshot(), before);
            f.assertWarning(side);
            assert.equal(f.input(side).value, '', 'the existing inline card error keeps the invalid input');
        }
    }
});

test('existing nonfinite, negative and reversed-interval errors never create Undo or clear Redo', async () => {
    for (const kind of ['caption', 'card']) {
        const f = await fixture(kind), before = f.snapshot();
        for (const [side, value] of [['start', 'NaN'], ['end', 'Infinity'], ['start', -1],
            ['start', f.value('end')], ['end', f.value('start')]]) {
            f.change(side, value);
            assert.deepEqual(f.snapshot(), before);
            f.assertWarning(side);
        }
    }
});

test('literal zero and precise corrections after rejection remain one undoable edit', async () => {
    for (const [kind, basis] of [['caption', 'source'], ['caption', 'timeline'], ['card', 'source']]) {
        for (const [side, value] of [['start', 0], ['start', .456789012], ['end', 1.87654321]]) {
            const f = await fixture(kind, { basis }), before = f.snapshot();
            f.change(side, '');
            assert.deepEqual(f.snapshot(), before);
            f.change(side, String(value));
            const expected = structuredClone(before.state);
            (kind === 'caption' ? expected.captions[0] : expected.overlays[0])[side] = value;
            assert.deepEqual(f.evaluate('state'), expected);
            assert.equal(f.evaluate('history.length'), 1);
            assert.equal(f.evaluate('future.length'), 0);
            assert.equal(f.evaluate('saves'), 1);
            assert.equal(f.evaluate('current'), before.current);
            assert.equal(f.evaluate('selected'), before.selected);
            if (kind === 'card') assert.equal(f.input(side).validationMessage, '');
            vm.runInContext('undo()', f.context);
            assert.deepEqual(f.evaluate('state'), before.state);
            assert.equal(f.evaluate('history.length'), 0);
        }
    }
});

test('source and pre-speed caption bounds stay distinct from card output bounds', async () => {
    for (const [kind, options, bound] of [
        ['caption', { basis: 'source', speed: 4 }, 12],
        ['caption', { basis: 'timeline', speed: 4 }, 8],
        ['card', { speed: .25 }, 32], ['card', { speed: 4 }, 2],
    ]) {
        const f = await fixture(kind, options), before = f.snapshot();
        f.change('end', bound + .000001);
        assert.deepEqual(f.snapshot(), before);
        f.assertWarning('end');
        f.change('end', bound);
        assert.equal(f.value('end'), bound);
        assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.evaluate('saves'), 1);
        assert.equal(f.value('start'), .23456789);
    }
});

test('Title and Credit keep required start but intentionally allow blank end as null', async () => {
    for (const kind of ['title', 'credit']) {
        const f = await fixture(kind), before = f.snapshot();
        f.change('start', '');
        assert.deepEqual(f.snapshot(), before);
        f.assertWarning('start');
        f.change('end', '');
        const expected = structuredClone(before.state);
        expected.design[kind].end = null;
        assert.deepEqual(f.evaluate('state'), expected);
        assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.evaluate('saves'), 1);
        assert.equal(f.input('end').validationMessage, '');
        vm.runInContext('undo()', f.context);
        assert.deepEqual(f.evaluate('state'), before.state);
    }
});

test('caption callbacks from a replaced render cannot commit even otherwise valid timing', async () => {
    const f = await fixture('caption');
    const oldChange = f.input('start').onchange;
    vm.runInContext('renderPanel()', f.context);
    const before = f.snapshot();
    f.input('start').value = '0';
    oldChange();
    assert.deepEqual(f.snapshot(), before);
    f.input('start').onchange();
    assert.equal(f.value('start'), 0);
    assert.equal(f.evaluate('history.length'), 1);
});
