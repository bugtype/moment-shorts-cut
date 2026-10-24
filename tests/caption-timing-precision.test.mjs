import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

async function fixture(caption) {
    const f = await createAppFixture();
    // Mount endpoint controls explicitly: the shared synthetic DOM does not parse rows.
    const originalQueryAll = f.doc.querySelectorAll;
    f.doc.querySelectorAll = selector => {
        const field = selector.match(/^\[data-caption-(start|end)\]$/)?.[1];
        if (!field) return originalQueryAll(selector);
        const input = f.element(`[data-caption-${field}="0"]`);
        input.dataset[field === 'start' ? 'captionStart' : 'captionEnd'] = '0';
        return [input];
    };
    f.context.cue = structuredClone(caption);
    vm.runInContext("state.clips=[{start:0,end:4},{start:0,end:4}];state.speed=4;state.captions=[cue];history=[];future=[];current=2;switchPanel('captions');", f.context);
    f.rendered = side => {
        const tag = f.element('#panelContent').innerHTML.match(new RegExp(`<input[^>]*data-caption-${side}="0"[^>]*>`))?.[0];
        assert.ok(tag);
        assert.match(tag, /step="any"/);
        return tag.match(/value="([^"]*)"/)[1];
    };
    f.change = (side, value) => {
        const input = f.element(`[data-caption-${side}="0"]`);
        input.value = String(value);
        input.onchange();
    };
    return f;
}

test('editable imported precision roundtrips without changing either clock or untouched endpoint', async () => {
    for (const basis of ['source', 'timeline']) {
        const cue = { start: 1.234, end: 2.987, text: 'Imported cue', basis, speaker: '0', keywords: 'cue', timing: 'estimated' };
        const f = await fixture(cue);
        assert.equal(f.rendered('start'), '1.234');
        assert.equal(f.rendered('end'), '2.987');
        f.change('start', f.rendered('start'));
        assert.deepEqual(f.evaluate('state.captions[0]'), cue);
        // Existing explicit onchange history behavior is deliberately unchanged.
        assert.equal(f.evaluate('history.length'), 1);
        f.change('start', '1.235');
        assert.deepEqual(f.evaluate('state.captions[0]'), { ...cue, start: 1.235 });
        assert.equal(f.evaluate('current'), 2);
        vm.runInContext('undo()', f.context);
        assert.deepEqual(f.evaluate('state.captions[0]'), cue);
        vm.runInContext('undo(true)', f.context);
        assert.equal(f.evaluate('state.captions[0].start'), 1.235);
        assert.equal(f.evaluate('state.captions[0].end'), cue.end);
    }
});

test('short cues and tiny/fractional values remain distinct and roundtrip through rendered fields', async () => {
    for (const [start, end] of [[1.01, 1.04], [1e-9, 2e-9], [0.1 + 0.2, 0.987654321]]) {
        const f = await fixture({ start, end, text: 'Precise cue' });
        assert.equal(Number(f.rendered('start')), start);
        assert.equal(Number(f.rendered('end')), end);
        assert.notEqual(f.rendered('start'), f.rendered('end'));
        f.change('end', f.rendered('end'));
        assert.deepEqual(f.evaluate('state.captions[0]'), { start, end, text: 'Precise cue' });
        vm.runInContext('renderPanel()', f.context);
        assert.equal(Number(f.rendered('start')), start);
        assert.equal(Number(f.rendered('end')), end);
    }
});

test('existing basis bounds and invalid interval rejection remain unchanged with no invalid Undo', async () => {
    for (const basis of ['source', 'timeline']) {
        const cue = { start: 1.234, end: 2.987, text: 'Bounds', basis };
        const f = await fixture(cue);
        const bound = basis === 'timeline' ? 8 : 12;
        for (const [side, value] of [['start', -1], ['start', cue.end], ['end', cue.start], ['end', bound + 1], ['end', 'NaN']]) {
            f.change(side, value);
            assert.deepEqual(f.evaluate('state.captions[0]'), cue);
            assert.equal(f.evaluate('history.length'), 0);
        }
        f.change('end', bound);
        assert.deepEqual(f.evaluate('state.captions[0]'), { ...cue, end: bound });
        assert.equal(f.evaluate('history.length'), 1);
    }
});

test('typing without a change event and rerendering never commits timing drafts', async () => {
    const cue = { start: 1.234, end: 2.987, text: 'Draft' };
    const f = await fixture(cue);
    f.element('[data-caption-start="0"]').value = '1.5';
    assert.deepEqual(f.evaluate('state.captions[0]'), cue);
    assert.equal(f.evaluate('history.length'), 0);
    vm.runInContext('renderPanel()', f.context);
    assert.equal(f.rendered('start'), '1.234');
    assert.deepEqual(f.evaluate('state.captions[0]'), cue);
});
