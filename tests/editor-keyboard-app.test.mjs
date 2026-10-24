import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

test('legacy keyboard IME and modified arrows no longer move the actual playhead or edit history', async () => {
    const f = await createAppFixture();
    vm.runInContext('current=4;history=[];future=[];', f.context);
    const before = f.evaluate('({state,current,history,future,playing,playRequest})');
    let prevented = 0;
    const press = (key, extra = {}) => f.documentEvents.get('keydown')({
        key, code: key === ' ' ? 'Space' : key,
        target: f.element('#addCaption'), preventDefault: () => prevented++, ...extra,
    });
    for (const extra of [{ isComposing: true, keyCode: 229 }, { keyCode: 229 },
        { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
        press('ArrowRight', extra);
        press('ArrowLeft', extra);
    }
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { altKey: true },
        { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
        press(' ', { target: { tagName: 'BODY' }, ...extra });
    }
    press('z', { ctrlKey: true, isComposing: true });
    press('ArrowRight', { target: { tagName: 'SPAN', isContentEditable: true } });
    press(' ', { target: { tagName: 'SPAN', closest: () => ({ tagName: 'TEXTAREA' }) } });
    assert.deepEqual(f.evaluate('({state,current,history,future,playing,playRequest})'), before);
    assert.equal(prevented, 0);
    press('ArrowRight');
    assert.equal(f.evaluate('current'), 5);
    press('ArrowLeft');
    assert.equal(f.evaluate('current'), 4);
    assert.equal(prevented, 0, 'existing arrow default-cancellation policy stays unchanged');
});

test('actual app Ctrl/Meta Undo and Shift redo remain available outside editing controls', async () => {
    for (const modifier of ['ctrlKey', 'metaKey']) {
        const f = await createAppFixture();
        const original = f.evaluate('state.name');
        vm.runInContext("edit(()=>state.name='Changed title')", f.context);
        const press = shiftKey => f.documentEvents.get('keydown')({
            key: 'z', code: 'KeyZ', [modifier]: true, shiftKey,
            target: f.element('#addCaption'), preventDefault() {},
        });
        press(false);
        assert.equal(f.evaluate('state.name'), original);
        press(true);
        assert.equal(f.evaluate('state.name'), 'Changed title');
    }
});
