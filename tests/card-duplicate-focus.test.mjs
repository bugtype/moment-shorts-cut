import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import { setLocale, t } from '../dist/i18n.mjs';

// Model fresh controls, connectivity and explicit focus calls on every panel
// render. This is synthetic DOM bookkeeping, not native keyboard/browser QA.
function freshControls(f) {
    const root = f.element('#panelContent'), originalQuery = root.querySelector.bind(root);
    root.ownerDocument = f.doc;
    let html = root.innerHTML, controls;
    const dom = { connected: true, focusCalls: [] };
    function makeControls() {
        const nodes = new Map();
        const target = {
            querySelector: selector => nodes.get(selector) || null,
            querySelectorAll: selector => selector === '[data-scene-select]'
                ? [...nodes.values()].filter(node => node.dataset?.sceneSelect) : [],
            owns: node => [...nodes.values()].includes(node),
            removeSelected: () => { for (const [key, node] of nodes) if (node.dataset?.sceneSelect) nodes.delete(key); },
            replaceDuplicate() {
                nodes.set('#duplicateSceneCard', makeButton('duplicateSceneCard', false));
            },
            removeDuplicate: () => nodes.delete('#duplicateSceneCard')
        };
        function makeButton(id, disabled, key = '#' + id) {
            return {
                id, disabled,
                get isConnected() {
                    return dom.connected && controls === target && nodes.get(key) === this;
                },
                focus(options) {
                    assert.equal(this.isConnected, true, 'never focus a detached control');
                    assert.equal(this.disabled, false, 'never focus a disabled control');
                    f.doc.activeElement = this;
                    dom.focusCalls.push({ target: this, options });
                }
            };
        }
        let markup = '';
        Object.defineProperty(target, 'innerHTML', {
            get: () => markup,
            set(value) {
                markup = value;
                nodes.clear();
                for (const match of value.matchAll(/<button[^>]*id="([^"]+)"[^>]*>/g)) {
                    nodes.set('#' + match[1], makeButton(match[1], /\bdisabled\b/.test(match[0])));
                }
                for (const match of value.matchAll(/<button[^>]*data-scene-select="([^"]+)"[^>]*>/g)) {
                    const key = 'scene:' + match[1], button = makeButton('', false, key);
                    button.dataset = { sceneSelect: match[1] };
                    nodes.set(key, button);
                }
            }
        });
        return target;
    }
    Object.defineProperty(root, 'innerHTML', {
        configurable: true,
        get: () => html,
        set(value) {
            const active = f.doc.activeElement;
            if (active && controls?.owns(active)) f.doc.activeElement = f.doc.body;
            html = value;
            controls = value.includes('id="effectControls"') ? makeControls() : null;
        }
    });
    root.querySelector = selector => selector === '#effectControls' ? controls : originalQuery(selector);
    return Object.assign(dom, {
        controls: () => controls,
        button: () => controls?.querySelector('#duplicateSceneCard')
    });
}

async function fixture(setup = '') {
    const f = await createAppFixture();
    const dom = freshControls(f);
    Object.assign(f, dom, { dom });
    vm.runInContext(`state.overlays=[{...newCard(12),id:'source',label:'Authored label',
        text:'Keep wording 그대로',detail:'Detail 细节',start:1.125,end:4.375,role:'free',
        kind:'countdown',enabled:false,x:.25,y:.6,width:.55,size:36,stroke:2.5,
        color:'#123456',accent:'#abcdef',background:'#654321',backgroundOpacity:.4,
        animation:'slide',presentation:'panel'}, {...newCard(12),id:'other',text:'Other'}];
        selectedCard='source';effectTab='cards';state.speed=2;current=3;history=[];future=[];
        ${setup};switchPanel('effects');`, f.context);
    f.snapshot = () => f.evaluate('({state,selectedCard,current,history,future})');
    return f;
}

for (const locale of ['ko', 'en', 'zh-CN']) {
    test(`duplicate focuses each fresh replacement and preserves authored metadata/undo in ${locale}`, async () => {
        const f = await fixture();
        try {
            setLocale(locale, { persist: false });
            vm.runInContext('renderPanel()', f.context);
            assert.ok(f.controls().innerHTML.includes(t('panels.duplicateCard')));
            const before = f.evaluate('state'), ids = new Set(before.overlays.map(card => card.id));
            let firstCopy;
            for (let i = 0; i < 2; i++) {
                const old = f.button();
                old.focus();
                f.focusCalls.length = 0;
                old.onclick();
                const next = f.button(), after = f.evaluate('state'), copy = after.overlays.at(-1);
                assert.notEqual(next, old);
                assert.equal(old.isConnected, false);
                assert.equal(next.isConnected, true);
                assert.equal(f.doc.activeElement, next);
                assert.deepEqual(f.focusCalls, [{ target: next, options: { preventScroll: true } }]);
                assert.equal(ids.has(copy.id), false, 'each copy gets a fresh ID');
                ids.add(copy.id);
                assert.deepEqual(copy, { ...before.overlays[0], id: copy.id });
                assert.deepEqual(after, { ...before, overlays: [...before.overlays,
                    ...(firstCopy ? [firstCopy] : []), copy] });
                assert.equal(f.evaluate('selectedCard'), copy.id);
                assert.equal(f.evaluate('current'), 3);
                assert.equal(f.evaluate('history.length'), i + 1);
                assert.equal(f.evaluate('future.length'), 0);
                firstCopy ||= copy;
            }
            const duplicated = f.evaluate('state');
            vm.runInContext('undo()', f.context);
            assert.deepEqual(f.evaluate('state'), { ...before, overlays: [...before.overlays, firstCopy] });
            vm.runInContext('undo()', f.context);
            assert.deepEqual(f.evaluate('state'), before);
            vm.runInContext('undo(true);undo(true)', f.context);
            assert.deepEqual(f.evaluate('state'), duplicated);
            assert.equal(f.evaluate('history.length'), 2);
            assert.equal(f.evaluate('current'), 3);
        } finally {
            setLocale('ko', { persist: false });
        }
    });
}

for (const [name, setup] of [
    ['full 12-card list', "state.overlays=Array.from({length:12},(_,i)=>({...state.overlays[0],id:i?'other-'+i:'source'}))"],
    ['exporting', 'exporting=true'],
    ['restoring', "persistence.restorePhase='restoring'"],
    ['refused edit returning undefined', 'app.edit=()=>undefined'],
    ['refused edit returning truthy', 'app.edit=()=>true']
]) {
    test(`duplicate does not mutate or focus after ${name}`, async () => {
        const f = await fixture(setup), before = f.snapshot(), button = f.button();
        button.onclick();
        assert.deepEqual(f.snapshot(), before);
        assert.equal(f.button(), button);
        assert.deepEqual(f.focusCalls, []);
    });
}

for (const [name, change] of [
    ['rerendered controls', 'renderPanel()'],
    ['different selection', "selectedCard='other'"],
    ['replaced project', 'state=structuredClone(state)'],
    ['different panel', "panel='text'"],
    ['different effect tab', "effectTab='motion'"],
    ['opened modal', "modalOpen('Other','content')"],
    ['removed source', "state.overlays=state.overlays.filter(card=>card.id!=='source')"]
]) {
    test(`stale duplicate from ${name} cannot mutate or steal focus`, async () => {
        const f = await fixture(), old = f.button().onclick;
        vm.runInContext(change, f.context);
        const before = f.snapshot(), focus = f.doc.activeElement;
        old();
        assert.deepEqual(f.snapshot(), before);
        assert.equal(f.doc.activeElement, focus);
        assert.deepEqual(f.focusCalls, []);
    });
}

test('a replaced duplicate button in the same controls cannot mutate or focus', async () => {
    const f = await fixture(), old = f.button(), before = f.snapshot();
    f.controls().replaceDuplicate();
    assert.equal(old.isConnected, false);
    old.onclick();
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.focusCalls, []);
});

test('a duplicate button in a detached panel cannot mutate or focus', async () => {
    const f = await fixture(), before = f.snapshot();
    f.dom.connected = false;
    f.button().onclick();
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.focusCalls, []);
});

test('composition events and composing clicks are inert until composition ends', async () => {
    const f = await fixture(), before = f.snapshot();
    f.button().onclick({ isComposing: true });
    f.button().onclick({ keyCode: 229 });
    f.controls().oncompositionstart();
    f.button().onclick();
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.focusCalls, []);
    f.controls().oncompositionend();
    f.button().onclick();
    assert.equal(f.evaluate('history.length'), 1);
    assert.equal(f.doc.activeElement, f.button());
});

for (const [name, change] of [
    ['project replacement', 'state=structuredClone(state);renderPanel()'],
    ['panel navigation', "switchPanel('text')"],
    ['effect tab navigation', "effectTab='motion';renderPanel()"],
    ['selection change', "selectedCard='source';renderPanel()"],
    ['modal opening', "modalOpen('New dialog','content')"]
]) {
    test(`successful duplicate does not steal newer focus after ${name} during callback`, async () => {
        const f = await fixture();
        vm.runInContext(`app.edit=(change,refresh)=>{edit(change,refresh);${change};
            document.querySelector('#newerFocus').focus();};`, f.context);
        f.button().onclick();
        assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.evaluate('state.overlays.length'), 3);
        assert.equal(f.doc.activeElement, f.element('#newerFocus'));
        assert.deepEqual(f.focusCalls, []);
    });
}

for (const [name, afterEdit] of [
    ['detached', f => { f.dom.connected = false; }],
    ['disabled', f => { f.button().disabled = true; }],
    ['removed', f => { f.controls().removeDuplicate(); }]
]) {
    test(`successful duplicate does not focus a ${name} replacement`, async () => {
        const f = await fixture();
        f.context.afterEdit = () => afterEdit(f);
        vm.runInContext('app.edit=(change,refresh)=>{edit(change,refresh);afterEdit();}', f.context);
        f.button().onclick();
        assert.equal(f.evaluate('history.length'), 1);
        assert.equal(f.evaluate('state.overlays.length'), 3);
        assert.deepEqual(f.focusCalls, []);
    });
}

test('successful duplication has an explicit signal even though app.edit returns undefined', async () => {
    const f = await fixture();
    f.context.editReturns = [];
    vm.runInContext('app.edit=(change,refresh)=>{const result=edit(change,refresh);editReturns.push(result);return result;}', f.context);
    f.button().onclick();
    assert.deepEqual(f.context.editReturns, [undefined]);
    assert.equal(f.evaluate('history.length'), 1);
    assert.equal(f.doc.activeElement, f.button());
});

test('existing app.edit busy policy is not broadened by the duplicate focus fix', async () => {
    const f = await fixture('loadingMedia=true;transcribing=true;editorReady=false');
    f.button().onclick();
    assert.equal(f.evaluate('history.length'), 1);
    assert.equal(f.evaluate('state.overlays.length'), 3);
    assert.equal(f.doc.activeElement, f.button());
});

test('failed-valid recovery duplication/undo/redo stays memory-only through real persistence guards', async () => {
    const f = await fixture(), writes = [], timers = [];
    f.context.localStorage.setItem = (...args) => writes.push(['settings', ...args]);
    f.context.setTimeout = (callback, delay) => timers.push({ callback, delay });
    f.context.recordMediaWrite = (...args) => writes.push(['media', ...args]);
    vm.runInContext(`persistence.restorePhase='failed';persistence.recoveryValid=true;
        projectStore.setMedia=recordMediaWrite;sources.videoFile={name:'source.mp4'};`, f.context);
    const before = f.evaluate('state');
    f.button().onclick();
    const after = f.evaluate('state');
    assert.equal(f.doc.activeElement, f.button());
    assert.equal(f.evaluate('history.length'), 1);
    await vm.runInContext('saveProject(true);scheduleSave();persistMedia();undo()', f.context);
    assert.deepEqual(f.evaluate('state'), before);
    await vm.runInContext('undo(true);saveProject(true);scheduleSave();persistMedia()', f.context);
    assert.deepEqual(f.evaluate('state'), after);
    assert.deepEqual(writes, []);
    assert.equal(timers.some(timer => timer.delay === 500), false);
    assert.equal(f.evaluate('persistence.saveTimer===undefined'), true);
});


test('focused card deletion hands focus to the existing successor or Add without changing deletion history', async () => {
    for (const setup of ['', "selectedCard='other';", 'state.overlays.length=1;']) {
        const f = await fixture(setup), before = f.snapshot(), id = before.selectedCard;
        const remove = f.controls().querySelector('#removeSceneCard');
        remove.focus();f.focusCalls.length = 0;
        vm.runInContext('deleteSaves=0;scheduleSave=()=>deleteSaves++;', f.context);
        remove.onclick();
        const after = f.snapshot(), remaining = before.state.overlays.filter(card => card.id !== id);
        assert.deepEqual(after.state, {...before.state, overlays:remaining});
        assert.equal(after.selectedCard, remaining[0]?.id || null);
        assert.equal(after.current, before.current);assert.equal(after.history.length, 1);
        assert.equal(after.future.length, 0);assert.equal(f.evaluate('deleteSaves'), 1);
        const destination = remaining.length
            ? f.controls().querySelectorAll('[data-scene-select]').find(button => button.dataset.sceneSelect === remaining[0].id)
            : f.controls().querySelector('#addSceneCard');
        assert.equal(remove.isConnected, false);assert.ok(destination?.isConnected);
        assert.equal(f.doc.activeElement, destination);
        assert.deepEqual(f.focusCalls, [{target:destination,options:{preventScroll:true}}]);
        vm.runInContext('undo()', f.context);assert.deepEqual(f.evaluate('state'), before.state);
        vm.runInContext('undo(true)', f.context);assert.deepEqual(f.evaluate('state'), after.state);
    }
});

test('deletion focus does not steal ownership on refusal, remount, reentry or unavailable targets', async () => {
    const cases = [
        ['export refusal', "exporting=true;", null, false],
        ['restore refusal', "persistence.restorePhase='restoring';", null, false],
        ['not focused', '', null, true, false],
        ['newer focus', '', "document.querySelector('#newerFocus').focus();"],
        ['project replaced', '', 'state=structuredClone(state);renderPanel();'],
        ['panel changed', '', "switchPanel('text');"],
        ['tab changed', '', "effectTab='motion';renderPanel();"],
        ['selection changed', '', "selectedCard='different';renderPanel();"],
        ['successor reordered', "state.overlays.push({...newCard(12),id:'third'});", 'state.overlays.reverse();renderPanel();'],
        ['new modal', '', "modalOpen('New dialog','content');"],
        ['detached target', '', 'afterEdit();', true, true, f => {f.dom.connected=false;}],
        ['disabled target', '', 'afterEdit();', true, true, f => {f.controls().querySelectorAll('[data-scene-select]')[0].disabled=true;}],
        ['missing target', '', 'afterEdit();', true, true, f => {f.controls().removeSelected();}],
    ];
    for (const [name, setup, afterEdit, committed=true, focused=true, hook] of cases) {
        const f = await fixture(setup), remove = f.controls().querySelector('#removeSceneCard');
        if (focused) remove.focus();
        else f.element('#newerFocus').focus();
        f.focusCalls.length=0;
        if (hook) f.context.afterEdit=()=>hook(f);
        if (afterEdit) vm.runInContext(`app.edit=(change,refresh)=>{edit(change,refresh);${afterEdit}};`, f.context);
        remove.onclick();
        assert.equal(f.evaluate('history.length'), committed ? 1 : 0, name);
        assert.deepEqual(f.focusCalls, [], name);
        if (!focused || name==='newer focus') assert.equal(f.doc.activeElement, f.element('#newerFocus'), name);
        if (!committed) assert.equal(f.doc.activeElement, remove, name);
    }
    const f = await fixture(), old = f.controls().querySelector('#removeSceneCard').onclick;
    vm.runInContext('renderPanel()', f.context);
    f.controls().querySelector('#removeSceneCard').focus();f.focusCalls.length=0;
    old();
    assert.equal(f.evaluate('history.length'), 1, 'existing retained-delete admission remains unchanged');
    assert.equal(f.doc.activeElement, f.doc.body);assert.deepEqual(f.focusCalls, []);
    const thrown = await fixture(), error = new Error('refresh failure');
    thrown.context.deleteError=error;
    vm.runInContext('app.edit=(change,refresh)=>{edit(change,refresh);throw deleteError;};', thrown.context);
    const remove=thrown.controls().querySelector('#removeSceneCard');remove.focus();thrown.focusCalls.length=0;
    assert.throws(()=>remove.onclick(), value=>value===error);
    assert.equal(thrown.evaluate('history.length'),1);assert.deepEqual(thrown.focusCalls,[]);
});
