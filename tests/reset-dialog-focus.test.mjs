import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

// Actual app handlers, explicit DOM replacement/native-dialog focus model; not browser QA.
async function mounted({closeFocus = 'body'} = {}) {
    const f = await createAppFixture(), root = f.element('#panelContent'), query = f.doc.querySelector;
    let generation = 0, nodes = new Map(), html = '', opener, afterClose = () => {}, focused = true;
    root.isConnected = true;
    root.contains = node => [...nodes.values()].includes(node);
    f.doc.querySelector = selector => nodes.get(selector) || query(selector);
    Object.defineProperty(root, 'innerHTML', {get: () => html, set(markup) {
        if (root.contains(f.doc.activeElement)) f.doc.activeElement = f.doc.body;
        generation++; nodes = new Map(); html = markup;
        for (const [, attrs] of markup.matchAll(/<button\b([^>]*)>/g)) {
            const id = attrs.match(/\bid="([^"]+)"/)?.[1];
            if (!id) continue;
            const node = f.element(`${generation}-${id}`), owner = generation;
            node.tagName = 'BUTTON';
            Object.defineProperty(node, 'isConnected', {get: () => owner === generation});
            nodes.set('#' + id, node);
        }
    }});
    const modal = f.element('#modal');
    const dialogNodes = () => ['#closeModal', '#confirmReset', '#cancelReset'].map(f.element);
    modal.ownerDocument = f.doc;
    modal.contains = node => dialogNodes().includes(node);
    f.doc.hasFocus = () => focused;
    modal.showModal = function() { if (this.open) return; opener = f.doc.activeElement; this.open = true; f.element('#closeModal').focus(); };
    modal.close = function() {
        this.open = false;
        if (opener?.isConnected !== false) opener?.focus();
        else if (closeFocus === 'body') f.doc.activeElement = f.doc.body;
        this.onclose?.(); afterClose();
    };
    vm.runInContext("switchPanel('media'); state.name='Authored edit'; history=['prior'];", f.context);
    const trigger = nodes.get('#loadDemo');
    return {...f, root, modal, trigger, nodes: () => nodes, afterClose(fn) {afterClose = fn;}, blur() {focused = false;}, open() {trigger.focus(); trigger.onclick(); f.element('#confirmReset').focus();}};
}

for (const closeFocus of ['body', 'hidden-dialog']) test(`accepted demo reset returns to replacement action from ${closeFocus}`, async () => {
    const f = await mounted({closeFocus}); f.open();
    f.element('#confirmReset').onclick();
    assert.equal(f.modal.open, false); assert.equal(f.trigger.isConnected, false);
    assert.equal(f.doc.activeElement, f.nodes().get('#loadDemo'));
    assert.notEqual(f.evaluate('state.name'), 'Authored edit'); assert.equal(f.evaluate('history.length'), 0);
    const count = f.focusEvents.length; f.element('#confirmReset').onclick(); assert.equal(f.focusEvents.length, count);
});

test('cancel and native close keep original opener without reset or remount', async () => {
    for (const close of [f => f.element('#cancelReset').onclick(), f => f.modal.close()]) {
        const f = await mounted(); f.open(); close(f);
        assert.equal(f.trigger.isConnected, true); assert.equal(f.doc.activeElement, f.trigger);
        assert.equal(f.evaluate('state.name'), 'Authored edit'); assert.equal(f.evaluate('history.length'), 1);
    }
});

test('busy refusal retains focus; retry returns to new action', async () => {
    const f = await mounted(); f.open(); vm.runInContext('loadingMedia=true', f.context);
    f.element('#confirmReset').onclick(); assert.equal(f.modal.open, true); assert.equal(f.trigger.isConnected, true);
    assert.equal(f.doc.activeElement, f.element('#confirmReset'));
    vm.runInContext('loadingMedia=false', f.context); f.element('#confirmReset').onclick();
    assert.equal(f.doc.activeElement, f.nodes().get('#loadDemo'));
});

test('static rail opener uses native return', async () => {
    const f = await mounted(), rail = f.element('#resetButton'); rail.isConnected = true; rail.focus(); rail.onclick();
    f.element('#confirmReset').focus(); f.element('#confirmReset').onclick();
    assert.equal(f.doc.activeElement, rail);
});

test('unfocused media activation does not claim focus', async () => {
    const f = await mounted(), other = f.element('#helpButton'); other.isConnected = true; other.focus(); f.trigger.onclick();
    f.element('#confirmReset').focus(); f.element('#confirmReset').onclick(); assert.equal(f.doc.activeElement, other);
});

for (const change of ['competing-focus', 'new-dialog', 'other-panel', 'round-trip-panel', 'blur', 'hidden', 'disabled']) test(`reset focus does not override ${change}`, async () => {
    const f = await mounted(); f.open();
    f.afterClose(() => {
        if (change === 'competing-focus') f.element('#helpButton').focus();
        if (change === 'new-dialog') vm.runInContext('showHelp()', f.context);
        if (change === 'other-panel') vm.runInContext("switchPanel('settings')", f.context);
        if (change === 'round-trip-panel') vm.runInContext("switchPanel('settings'); switchPanel('media')", f.context);
        if (change === 'blur') f.blur();
        if (change === 'hidden') f.nodes().get('#loadDemo').hidden = true;
        if (change === 'disabled') f.nodes().get('#loadDemo').disabled = true;
    });
    f.element('#confirmReset').onclick();
    assert.notEqual(f.doc.activeElement, f.nodes().get('#loadDemo'));
});
