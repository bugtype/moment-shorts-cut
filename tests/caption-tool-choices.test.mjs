import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';

const ids = ['captionSource', 'language', 'captionChunkSize'];
const choices = ['audio', 'english', '24'];
const defaults = ['video', 'korean', '18'];

async function fixture() {
    const f = await createAppFixture();
    // The app fixture does not parse innerHTML. Model only select option/default
    // replacement from actual generated markup, not browser layout or ASR.
    let html = f.element('#panelContent').innerHTML;
    Object.defineProperty(f.element('#panelContent'), 'innerHTML', {
        get: () => html,
        set(value) {
            html = value;
            for (const id of ids) {
                const match = value.match(new RegExp(`<select\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
                if (!match) continue;
                const select = f.element('#' + id);
                select.options = [...match[1].matchAll(/<option\b([^>]*)>/g)].map(([, attributes]) => ({
                    value: attributes.match(/value="([^"]*)"/)?.[1] ?? '',
                    disabled: /\bdisabled\b/.test(attributes),
                    selected: /\bselected\b/.test(attributes),
                }));
                let selected = select.options.find(option => option.selected) || select.options.find(option => !option.disabled);
                Object.defineProperty(select, 'value', {
                    configurable: true,
                    get: () => selected?.value ?? '',
                    set(value) { selected = select.options.find(option => option.value === String(value)); },
                });
            }
        },
    });
    vm.runInContext(`state.duration=120;state.clips=[{start:0,end:120}];
        state.captions=Array.from({length:101},(_,i)=>({start:i,end:i+1,text:i===100?'target':'cue '+i}));
        sources.audioFile={name:'voice.wav'};history=[];future=['redo sentinel'];current=1;
        globalThis.choiceSaves=0;scheduleSave=()=>choiceSaves++;switchPanel('captions');`, f.context);
    f.values = () => ids.map(id => f.element('#' + id).value);
    f.choose = (values = choices) => ids.forEach((id, index) => { f.element('#' + id).value = values[index]; });
    f.snapshot = () => f.evaluate('({state,history,future,choiceSaves})');
    f.run = source => vm.runInContext(source, f.context);
    return f;
}

test('caption paging, page jump, search and off-page focus retain tool choices without writes', async () => {
    const f = await fixture(), before = f.snapshot();
    f.choose();
    const actions = [
        () => f.element('#nextCaptionPage').onclick(),
        () => f.element('#previousCaptionPage').onclick(),
        () => { f.element('#captionPageNumber').value='3'; f.element('#goCaptionPage').onclick(); },
        () => f.run('focusCaption(0)'),
        () => { f.element('#captionFind').value='target'; f.element('#captionFind').oninput(); f.element('#nextCaptionMatch').onclick(); },
        () => f.run('focusCaption(0)'),
    ];
    for (const action of actions) {
        action();
        assert.deepEqual(f.values(), choices);
        assert.deepEqual(f.snapshot(), before);
        assert.equal(f.evaluate('current'), 1);
    }
    f.choose(['video', 'japanese', '12']);
    f.element('#nextCaptionPage').onclick();
    assert.deepEqual(f.values(), ['video', 'japanese', '12']);
    assert.deepEqual(f.snapshot(), before);
});

test('same-panel routing and timeline row navigation retain choices without project writes', async () => {
    const f = await fixture(), before = f.snapshot();
    f.choose();
    f.run("switchPanel('captions')");
    assert.deepEqual(f.values(), choices);
    f.context.captionNavigation = {target:{closest:()=>({dataset:{captionIndex:'100',captionTime:'100',captionKey:'100:0'}})}};
    f.run('navigateCaption(captionNavigation)');
    assert.deepEqual(f.values(), choices);
    assert.match(f.element('#panelContent').innerHTML, /data-caption-text="100"/);
    assert.equal(f.evaluate('current'), 100);
    assert.deepEqual(f.snapshot(), before);
});

test('recognition receives the chosen source and language after paging without running ASR', async () => {
    const f = await fixture(), before = f.snapshot();
    f.choose();
    f.element('#nextCaptionPage').onclick();
    // Stop at the orchestration boundary: no file read, decoder or worker runs.
    f.run(`sources.videoFile={name:'original.mp4'};
        captionGeneration.generate=async(source,file,language)=>{
            globalThis.recognitionChoice={source,fileName:file.name,language};
        };`);
    await f.run('generateCaptions()');
    assert.deepEqual(f.evaluate('recognitionChoice'), {source:'audio',fileName:'voice.wav',language:'english'});
    assert.deepEqual(f.snapshot(), before);
});

test('navigation does not restore unavailable audio or nonexistent choice values', async () => {
    const f = await fixture();
    f.choose();
    f.run('sources.audioFile=null');
    const before = f.snapshot();
    f.element('#nextCaptionPage').onclick();
    assert.deepEqual(f.values(), ['video', 'english', '24']);
    assert.deepEqual(f.snapshot(), before);
    // Native selects cannot retain an unknown value; the empty selection must
    // not override the new markup's valid defaults during restoration.
    f.choose(['missing-source', 'missing-language', '999']);
    assert.deepEqual(f.values(), ['', '', '']);
    f.element('#previousCaptionPage').onclick();
    assert.deepEqual(f.values(), defaults);
});

test('normal refresh, project replacement and leaving the panel retain existing reset scope', async () => {
    const f = await fixture();
    for (const action of [
        'renderPanel()',
        'state=structuredClone(state);renderPanel()',
        "switchPanel('settings');switchPanel('captions')",
    ]) {
        f.choose(); f.run(action);
        assert.deepEqual(f.values(), defaults, action);
    }
});

test('composition and detached paging handlers remain inert with tool choices', async () => {
    const f = await fixture(), before = f.snapshot();
    f.choose();
    const oldNext = f.element('#nextCaptionPage').onclick;
    const original = f.element('#panelContent').innerHTML;
    f.element('#panelContent').oncompositionstart();
    oldNext();
    assert.equal(f.element('#panelContent').innerHTML, original);
    assert.deepEqual(f.values(), choices);
    f.element('#panelContent').oncompositionend();
    oldNext();
    const secondPage = f.element('#panelContent').innerHTML;
    oldNext();
    assert.equal(f.element('#panelContent').innerHTML, secondPage);
    assert.deepEqual(f.values(), choices);
    assert.deepEqual(f.snapshot(), before);
});
