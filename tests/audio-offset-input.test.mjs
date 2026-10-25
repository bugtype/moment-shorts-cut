import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';

async function fixture(speed = 1) {
    const f = await createAppFixture();
    vm.runInContext(`
        state.speed=${speed};state.audioOffset=4;state.audioName='voice.wav';
        sources.audioFile={name:'voice.wav'};
        state.captions=[
            {start:5,end:7,text:'Keep authored timeline text',basis:'timeline',speaker:'1',timing:'estimated'},
            {start:1,end:3,text:'Keep source text',basis:'source',keywords:'Keep'},
            {start:2,end:4,text:'Default source basis'}
        ];
        switchPanel('audio');history=[];future=[JSON.stringify(state)];
        globalThis.offsetSaves=0;scheduleSave=()=>offsetSaves++;
    `, f.context);
    f.input = f.element('#audioOffset');
    f.input.type = 'number';
    f.input.value = String(4 / speed);
    f.snapshot = () => f.evaluate('({state,history,future,current,selected,panel,saves:offsetSaves})');
    f.change = (value, badInput = false) => {
        // Explicit DOM-facing values, not native typing, sanitization or IME emulation.
        f.input.value = value;
        f.input.validity = { badInput };
        f.input.onchange({ target: f.input });
    };
    return f;
}

test('empty audio start and bad-input empty values preserve offset, captions, history and drafts', async () => {
    for (const speed of [.25, 1, 4]) for (const badInput of [false, true]) {
        const f = await fixture(speed), before = f.snapshot();
        const root = f.element('#panelContent'), markup = root.innerHTML;
        f.input.focus();
        const focusCount = f.focusEvents.length;
        f.change('', badInput);
        assert.deepEqual(f.snapshot(), before);
        assert.equal(f.input.value, '', 'keep the invalid draft for correction');
        assert.equal(f.element('#audioOffset'), f.input);
        assert.equal(root.innerHTML, markup, 'do not rebuild the panel on rejection');
        assert.equal(f.doc.activeElement, f.input);
        assert.equal(f.focusEvents.length, focusCount);
        assert.equal(f.element('#toast').getAttribute('data-i18n'), 'panels.audioStartInvalid');
    }
});

test('whitespace and nonfinite direct DOM values cannot become a zero or endpoint edit', async () => {
    for (const value of ['   ', 'NaN', 'Infinity', '-Infinity', 'not a number']) {
        const f = await fixture(), before = f.snapshot();
        f.change(value);
        assert.deepEqual(f.snapshot(), before);
        assert.equal(f.element('#toast').getAttribute('data-i18n'), 'panels.audioStartInvalid');
    }
});

test('explicit zero and precise correction remain one undoable edit with the existing caption-shift policy', async () => {
    for (const speed of [.25, 1, 4]) for (const value of ['0', '.123456789', '1e-7']) {
        const f = await fixture(speed), before = f.snapshot();
        f.change('');
        assert.deepEqual(f.snapshot(), before);
        f.change(value);
        const after = f.snapshot(), next = Number(value) * speed, delta = next - 4;
        assert.equal(after.state.audioOffset, next);
        assert.deepEqual(after.state.captions[0], {
            ...before.state.captions[0], start: Math.max(0, 5 + delta), end: Math.max(.001, 7 + delta),
        });
        assert.deepEqual(after.state.captions.slice(1), before.state.captions.slice(1));
        assert.deepEqual(after.state.clips, before.state.clips);
        assert.deepEqual(after.state.design, before.state.design);
        assert.deepEqual(after.state.overlays, before.state.overlays);
        assert.equal(after.history.length, 1);
        assert.deepEqual(JSON.parse(after.history[0]), before.state);
        assert.equal(after.future.length, 0);
        assert.equal(after.saves, 1);
        vm.runInContext('undo()', f.context);
        assert.deepEqual(f.evaluate('state'), before.state);
        vm.runInContext('undo(true)', f.context);
        assert.deepEqual(f.evaluate('state'), after.state);
    }
});

test('finite negative and over-duration numbers keep the existing clamp and speed conversion', async () => {
    for (const speed of [.25, 4]) for (const value of ['-1', '100', '3.123456789']) {
        const f = await fixture(speed), before = f.snapshot();
        f.change(value);
        const after = f.snapshot(), next = Math.max(0, Math.min(12, Number(value) * speed)), delta = next - 4;
        assert.equal(after.state.audioOffset, next);
        assert.deepEqual(after.state.captions[0], {
            ...before.state.captions[0], start: Math.max(0, 5 + delta), end: Math.max(.001, 7 + delta),
        });
        assert.deepEqual(after.state.captions.slice(1), before.state.captions.slice(1));
        assert.equal(after.history.length, 1);
        assert.equal(after.saves, 1);
    }
});

test('the audio-start warning remains keyed across all supported interface languages', async () => {
    const f = await fixture(), before = f.snapshot();
    f.change('');
    for (const locale of ['ko', 'en', 'zh-CN']) {
        f.element('#uiLocale').onchange({ target: { value: locale } });
        const toast = f.element('#toast');
        assert.equal(toast.getAttribute('data-i18n'), 'panels.audioStartInvalid');
        assert.equal(toast.textContent, vm.runInContext("t('panels.audioStartInvalid')", f.context));
        assert.deepEqual(f.snapshot(), before);
        assert.equal(f.input.value, '');
    }
});

test('existing export and restoring guards still refuse valid audio-start edits', async () => {
    for (const condition of ['exporting=true', "persistence.restorePhase='restoring'"]) {
        const f = await fixture();
        vm.runInContext(condition, f.context);
        const before = f.snapshot();
        f.change('0');
        assert.deepEqual(f.snapshot(), before);
    }
});
