import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { setLocale } from '../dist/i18n.mjs';

async function fixture() {
    const f = await createAppFixture();
    vm.runInContext(`state.captions=[
        {start:0,end:2,text:'hello\\nworld',basis:'source',speaker:'1',keywords:'hello',timing:'estimated'},
        {start:2,end:4,text:'other\\nline',basis:'timeline',speaker:'0'}
    ];current=1;history=[];future=[];switchPanel('captions');`, f.context);
    f.type = (id, value) => {
        const field = f.element('#' + id);
        field.tagName = 'TEXTAREA';
        field.value = value;
        field.oninput();
        return field;
    };
    return f;
}

test('newline-only cleanup uses existing literal replace-all with one undo and unchanged metadata', async () => {
    const f = await fixture(), before = f.evaluate('state');
    f.type('captionFind', '\n');
    f.type('captionReplacement', ' ');
    assert.equal(f.element('#captionSearchStatus').textContent, '일치 0 / 2');
    f.element('#replaceAllCaptions').onclick();
    const expected = structuredClone(before);
    expected.captions.forEach(caption => { caption.text = caption.text.replace('\n', ' '); });
    assert.deepEqual(f.evaluate('state'), expected);
    assert.equal(f.evaluate('history.length'), 1);
    assert.equal(f.evaluate('current'), 1);
    vm.runInContext('undo()', f.context);
    assert.deepEqual(f.evaluate('state'), before);
    vm.runInContext('undo(true)', f.context);
    assert.deepEqual(f.evaluate('state'), expected);
});

test('multiline find and replacement preserve literal markup and selected-match offsets', async () => {
    const f = await fixture();
    const find = 'hello\nworld', replacement = '<b>第一行</b>\n$& second';
    f.type('captionFind', find);
    f.type('captionReplacement', replacement);
    f.element('#nextCaptionMatch').onclick();
    const row = f.element('[data-caption-text="0"]');
    row.value = find; // The synthetic DOM does not parse textarea contents.
    assert.deepEqual([row.selectionStart, row.selectionEnd], [0, find.length]);
    f.element('#replaceCaptionMatch').onclick();
    assert.equal(f.evaluate('state.captions[0].text'), replacement);
    assert.equal(f.evaluate('history.length'), 1);
    assert.equal(f.element('#captionReplacement').value, replacement);
    assert.doesNotMatch(f.element('#panelContent').innerHTML, /<textarea[^>]*id="captionReplacement"[^>]*>\s+|<b>第一行<\/b>/);
});

test('backslash-n stays literal and does not become a newline escape', async () => {
    const f = await fixture();
    vm.runInContext("state.captions[1].text='literal \\\\n marker';renderPanel();", f.context);
    f.type('captionFind', '\\n');
    f.type('captionReplacement', 'X');
    assert.equal(f.element('#captionSearchStatus').textContent, '일치 0 / 1');
    f.element('#replaceAllCaptions').onclick();
    assert.equal(f.evaluate('state.captions[0].text'), 'hello\nworld');
    assert.equal(f.evaluate('state.captions[1].text'), 'literal X marker');
});

test('multiline drafts survive pagination and locale switching without edits', async () => {
    const f = await fixture();
    vm.runInContext("state.captions=Array.from({length:101},(_,i)=>({start:i,end:i+1,text:'cue '+i}));renderPanel();", f.context);
    const before = f.evaluate('({state,history,current})');
    f.type('captionFind', 'first\nsecond');
    f.type('captionReplacement', 'replacement\ntext');
    try {
        for (const locale of ['ko', 'en', 'zh-CN']) {
            setLocale(locale, {persist:false});
            f.element('#nextCaptionPage').onclick();
            assert.equal(f.element('#captionFind').value, 'first\nsecond');
            assert.equal(f.element('#captionReplacement').value, 'replacement\ntext');
        }
        assert.deepEqual(f.evaluate('({state,history,current})'), before);
    } finally { setLocale('ko', {persist:false}); }
});

test('native Enter and IME remain text editing rather than playback or replacement shortcuts', async () => {
    const f = await fixture(), field = f.type('captionFind', 'hello');
    assert.equal(typeof field.onkeydown, 'undefined');
    const before = f.evaluate('({state,history,current,playing})');
    let prevented = 0;
    for (const event of [{key:'Enter'}, {key:'Enter',isComposing:true}, {key:'ArrowRight'}, {key:' ',code:'Space'}]) {
        f.documentEvents.get('keydown')({...event,target:field,preventDefault(){prevented++;}});
    }
    assert.equal(prevented, 0);
    f.element('#panelContent').oncompositionstart();
    f.type('captionFind', 'hello\nworld');
    f.element('#replaceAllCaptions').onclick({isComposing:true});
    f.element('#panelContent').oncompositionend();
    assert.deepEqual(f.evaluate('({state,history,current,playing})'), before);
});

test('multiline fields retain blank-result, length and no-op validation', async () => {
    const f = await fixture(), before = f.evaluate('state');
    f.type('captionFind', 'hello\nworld');
    f.type('captionReplacement', 'hello\nworld');
    assert.equal(f.element('#replaceAllCaptions').disabled, true);
    f.element('#replaceAllCaptions').onclick();
    f.type('captionReplacement', '\n');
    f.element('#replaceAllCaptions').onclick();
    assert.equal(f.evaluate('history.length'), 0);
    f.type('captionReplacement', 'x\n'.repeat(1001));
    f.element('#replaceAllCaptions').onclick();
    assert.equal(f.evaluate('history.length'), 0);
    assert.deepEqual(f.evaluate('state'), before);
});
