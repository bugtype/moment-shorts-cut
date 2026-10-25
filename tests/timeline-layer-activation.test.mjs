import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { installLayerTrackDom } from './fixtures/timeline-layer-dom.mjs';
import { setLocale, translateFor } from '../dist/i18n.mjs';

async function setup(speed = 2) {
    const f = await createAppFixture();
    const track = installLayerTrackDom(f.element('#titleTrack'), f.doc);
    const queryAll = f.doc.querySelectorAll;
    f.doc.querySelectorAll = selector => [
        ...queryAll(selector), ...(selector.includes('[data-i18n') ? track.querySelectorAll(selector) : []),
    ];
    const fields = new Map();
    for (const kind of ['title', 'credit', 'card']) {
        const root = f.element('#panelContent');
        const target = kind === 'card' ? root.querySelector('#effectControls') : root;
        for (const key of ['start', 'end', ...(kind === 'title' ? ['lines.0', 'lines.1'] : kind === 'card' ? ['label', 'text'] : ['text'])]) {
            const input = f.element(`#layer-${kind}-${key}`);
            input.type = ['start', 'end'].includes(key) ? 'number' : kind === 'card' && key === 'text' ? 'textarea' : 'text';
            input.dataset[kind === 'card' ? 'card' : 'design'] = kind === 'card' ? key : `design.${kind}.${key}`;
            input.reportValidity = () => {};
            fields.set(`${kind}:${key}`, input);
        }
        const original = target.querySelectorAll.bind(target);
        target.querySelectorAll = selector => {
            const card = selector === '[data-card]', design = selector === '[data-design]';
            if (!card && !design) return original(selector);
            const layer = card ? 'card' : f.evaluate('textLayer');
            return [...fields].filter(([key]) => key.startsWith(layer + ':')).map(([, input]) => input);
        };
    }
    let storageWrites = 0;
    f.context.localStorage.setItem = () => { storageWrites++; };
    vm.runInContext(`state=initial();state.clips=[{start:6,end:10},{start:0,end:4},{start:6,end:10}];state.speed=${speed};
        state.design.title.enabled=true;state.design.title.start=.25;state.design.title.end=null;
        state.design.title.lines=['Authored title','Second line'];
        state.design.credit.enabled=true;state.design.credit.start=.5;state.design.credit.end=2.5;state.design.credit.text='Authored credit';
        state.overlays=[{...newCard(12/state.speed),id:'card-a',start:.5,end:2.5,label:'Label',text:'Authored card'}];
        history=[];future=[];current=0;selected=1;selectedCard='card-a';effectTab='cards';
        globalThis.layerSaves=0;scheduleSave=()=>layerSaves++;renderTimeline();`, f.context);
    f.open = kind => {
        vm.runInContext(`textLayer='${kind}';switchPanel('${kind === 'card' ? 'effects' : 'text'}');`, f.context);
        for (const [name, input] of fields) {
            const [layer, key] = name.split(':');
            const path = layer === 'card' ? 'state.overlays.find(card=>card.id===selectedCard)' : `state.design.${layer}`;
            const value = key.split('.').reduce((item, key) => item[key], f.evaluate(path));
            input.value = value == null ? '' : String(value);
        }
    };
    f.input = (kind, key) => fields.get(`${kind}:${key}`);
    f.edit = (kind, key, value, event = 'onchange') => {
        const input = f.input(kind, key);
        input.value = String(value);
        input[event]();
    };
    f.button = key => track.querySelector(key === 'card' ? '[data-track-card="card-a"]' : `[data-track-layer="${key}"]`);
    f.snapshot = () => f.evaluate('({state,history,future,layerSaves})');
    f.assertStorageUntouched = () => assert.equal(storageWrites, 0);
    return { ...f, track };
}

function capture(track) {
    return { writes: track.writes, nodes: track.children.map(node => ({
        button: node, literal: node.lastChild, prefix: node.dataset.trackLayer ? node.firstChild : null,
    })) };
}

function assertStable(track, before) {
    assert.equal(track.writes, before.writes, 'same-shape updates do not assign track.innerHTML');
    assert.equal(track.children.length, before.nodes.length);
    before.nodes.forEach(({ button, literal, prefix }, index) => {
        assert.equal(track.children[index] === button, true, `button ${index} retains identity`);
        assert.equal(button.lastChild === literal, true, `literal text ${index} retains identity`);
        if (prefix) assert.equal(button.firstChild === prefix, true, `localized prefix ${index} retains identity`);
        assert.equal(button.isConnected, true);
    });
}

for (const kind of ['title', 'credit', 'card']) {
    test(`${kind} numeric commits retain every layer target and delegated activation reads current state`, async () => {
        for (const speed of [.25, 4]) for (const target of ['title', 'credit', 'card']) {
            const f = await setup(speed);
            f.open(kind);
            const before = capture(f.track), state = f.evaluate('state');
            const button = f.button(target), hit = target === 'card' ? button : button.firstChild;
            button.focus();
            f.edit(kind, 'start', .75);
            assertStable(f.track, before);
            assert.equal(hit.isConnected, true);
            assert.equal(f.doc.activeElement, button);
            const expected = structuredClone(state);
            (kind === 'card' ? expected.overlays[0] : expected.design[kind]).start = .75;
            assert.deepEqual(f.evaluate('state'), expected);
            assert.equal(f.evaluate('history.length'), 1);
            assert.equal(f.evaluate('layerSaves'), 1);
            const edited = f.snapshot();
            // Direct handler execution against a retained connected descendant, not native dispatch.
            f.track.onclick({ target: hit });
            assert.equal(f.evaluate('panel'), target === 'card' ? 'effects' : 'text');
            assert.equal(f.evaluate(target === 'card' ? 'selectedCard' : 'textLayer'), target === 'card' ? 'card-a' : target);
            assert.equal(f.evaluate('current'), target === 'card' ? Math.min(expected.overlays[0].end - .001, expected.overlays[0].start + .2) * speed : 0);
            assert.deepEqual(f.snapshot(), edited);
            f.assertStorageUntouched();
        }
    });
}

test('continuous authored text stays literal and grouped while unrelated input focus is untouched', async () => {
    for (const [kind, key] of [['title', 'lines.0'], ['credit', 'text'], ['card', 'label'], ['card', 'text']]) {
        const f = await setup();
        f.open(kind);
        const before = capture(f.track), input = f.input(kind, key);
        input.focus();
        const value = '<literal & "quoted"> 🎬';
        f.edit(kind, key, value, 'oninput');
        f.edit(kind, key, value + ' next', 'oninput');
        input.onchange();
        assertStable(f.track, before);
        assert.equal(f.doc.activeElement, input);
        assert.equal(f.track.focusCalls.length, 0);
        assert.ok(f.button(kind).textContent.includes(value + ' next'));
        assert.equal(f.button(kind).children.length, kind === 'card' ? 0 : 1, 'authored HTML never creates elements');
        assert.match(f.track.innerHTML, /&lt;literal &amp; &quot;quoted&quot;&gt; 🎬 next/);
        assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.evaluate('layerSaves'), 2);
        f.assertStorageUntouched();
    }
});

test('locale switches, subsequent edits and Undo preserve prefix targets and authored text leaves', async () => {
    const f = await setup();
    f.open('title');
    const before = capture(f.track);
    f.button('credit').focus();
    try {
        for (const locale of ['en', 'zh-CN', 'ko']) {
            const state = f.snapshot();
            setLocale(locale, { persist: false });
            assertStable(f.track, before);
            assert.deepEqual(f.snapshot(), state);
            assert.equal(f.button('title').firstChild.textContent, translateFor(locale, 'shell.title'));
            f.edit('title', 'lines.0', 'Literal ' + locale, 'oninput');
            assertStable(f.track, before);
            assert.equal(f.button('title').firstChild.getAttribute('data-i18n'), 'shell.title');
            assert.equal(f.button('title').firstChild.textContent, translateFor(locale, 'shell.title'));
            assert.ok(f.button('title').lastChild.data.includes('Literal ' + locale));
        }
        vm.runInContext('undo();timelineView.setZoom(4);renderTimeline();renderTimeline();', f.context);
        assertStable(f.track, before);
        assert.ok(f.button('title').lastChild.data.includes('Authored title'));
        assert.equal(f.doc.activeElement, f.button('credit'));
        f.assertStorageUntouched();
    } finally { setLocale('ko', { persist: false }); }
});

test('same-key geometry keeps output clipping, zero-width layers and disabled cards unchanged', async () => {
    for (const speed of [.25, 4]) {
        const f = await setup(speed), before = capture(f.track);
        vm.runInContext(`state.design.title.start=12/state.speed;state.design.title.end=null;
            state.design.credit.start=.5;state.design.credit.end=100;
            state.overlays[0].start=.5;state.overlays[0].end=100;state.overlays[0].enabled=false;renderTimeline();`, f.context);
        assertStable(f.track, before);
        const total = 12 / speed;
        assert.equal(f.button('title').style.left, '100%');
        assert.equal(f.button('title').style.width, '0%');
        assert.equal(f.button('credit').style.left, `${.5 / total * 100}%`);
        assert.equal(f.button('credit').style.width, `${(total - .5) / total * 100}%`);
        assert.equal(f.button('card').style.width, `${(total - .5) / total * 100}%`);
        assert.equal(f.evaluate('history.length'), 0);
        assert.equal(f.evaluate('layerSaves'), 0);
    }
});

test('namespaced card IDs stay distinct; actual add, remove, order and visibility changes remount', async () => {
    const f = await setup();
    vm.runInContext("state.overlays.push({...state.overlays[0],id:'title',label:'<id & label>'});renderTimeline();", f.context);
    const collision = f.track.querySelector('[data-track-card="title"]');
    assert.ok(collision);
    assert.notEqual(collision, f.button('title'));
    const before = capture(f.track);
    vm.runInContext("state.overlays[1].text='Distinct';renderTimeline();", f.context);
    assertStable(f.track, before);
    assert.equal(f.track.querySelector('[data-track-card="title"]'), collision);
    for (const change of [
        'state.overlays.reverse()', 'state.overlays.pop()',
        'state.design.title.enabled=false', 'state.design.credit.enabled=false',
        'state.overlays[0].start=12/state.speed', 'state.overlays[0].start=.5',
    ]) {
        const previous = capture(f.track);
        vm.runInContext(change + ';renderTimeline();', f.context);
        assert.equal(f.track.writes, previous.writes + 1);
        assert.ok(previous.nodes.every(({ button }) => !button.isConnected));
    }
    assert.equal(f.evaluate('history.length'), 0);
    assert.equal(f.evaluate('layerSaves'), 0);
});

test('raw authored CR/NUL and unexpected child shapes retain the legacy markup fallback', async () => {
    for (const value of ['A\rB', 'A\r\nB', 'A\0B']) {
        const f = await setup();
        f.open('card');
        const before = capture(f.track);
        f.edit('card', 'text', value, 'oninput');
        assert.equal(f.track.writes, before.writes + 1);
        assert.ok(f.track.assignedHTML.includes(value), 'the legacy raw HTML input is retained, without asserting native parser normalization');
        assert.equal(f.evaluate('state.overlays[0].text'), value);
    }
    for (const malformed of ['extra-text', 'nested-prefix']) {
        const f = await setup();
        f.open('title');
        const before = capture(f.track), button = f.button('title');
        if (malformed === 'extra-text') button.appendChild(f.track.createText('unexpected'));
        else button.firstChild.appendChild(f.track.createElement('em'));
        f.edit('title', 'lines.0', 'Changed', 'oninput');
        assert.equal(f.track.writes, before.writes + 1);
        assert.equal(button.isConnected, false);
        assert.ok(f.button('title').textContent.includes('Changed'));
    }
});

test('invalid and unchanged recommits keep their existing project and save behavior', async () => {
    for (const kind of ['title', 'credit', 'card']) {
        const f = await setup();
        f.open(kind);
        const before = capture(f.track), state = f.snapshot();
        f.edit(kind, 'start', '');
        assertStable(f.track, before);
        assert.deepEqual(f.snapshot(), state);
        const original = kind === 'title' ? .25 : .5;
        f.edit(kind, 'start', original);
        assertStable(f.track, before);
        assert.deepEqual(f.evaluate('state'), state.state);
        assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.evaluate('layerSaves'), 1);
    }
});

test('valid subnormal output duration retains legacy markup fallback without normalizing the project', async () => {
    const f = await setup(4);
    vm.runInContext('state.overlays=[];renderTimeline();', f.context);
    const before = capture(f.track);
    assert.equal(before.nodes.length, 2);
    vm.runInContext('state.clips=[{start:0,end:Number.MIN_VALUE}];validateProject(state);', f.context);
    assert.equal(f.evaluate('duration()'), Number.MIN_VALUE);
    assert.equal(f.evaluate('duration()/state.speed'), 0);
    const project = f.snapshot();
    vm.runInContext('timelineView.renderLayers(state,duration());', f.context);
    assert.equal(f.track.writes, before.writes + 1, 'nonfinite percentages use the existing whole-lane HTML path');
    assert.ok(before.nodes.every(({ button }) => !button.isConnected));
    assert.match(f.track.assignedHTML, /style="left:NaN%;width:NaN%"/);
    assert.deepEqual(f.snapshot(), project);
    f.assertStorageUntouched();
    // This asserts fallback selection and raw markup, not native CSS parsing behavior.
});
