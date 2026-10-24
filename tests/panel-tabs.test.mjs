import test from 'node:test';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import assert from 'node:assert/strict';
import { bindPanelTabs } from '../dist/panel-tabs.mjs';
import { mountDesignPanel } from '../dist/design-panel.mjs';
import { mountEffectsPanel } from '../dist/effects-panel.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { setLocale } from '../dist/i18n.mjs';

// Every render creates new nodes; focusing a detached previous tab fails visibly.
function mountedRoot(focused) {
    let html = '', tabs = [], nodes = new Map();
    return {
        get innerHTML() { return html; },
        set innerHTML(value) {
            for (const tab of tabs) tab.detached = true;
            html = value;
            nodes = new Map();
            tabs = [...html.matchAll(/<button\b([^>]*role="tab"[^>]*)>/g)].map(([, attributes]) => {
                const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
                const tab = {
                    attrs, dataset: {}, tagName: 'BUTTON',
                    getAttribute(name) { return attrs[name] ?? null; },
                    closest() { return this; },
                    focus() { assert.notEqual(this.detached, true); focused.push(this); }
                };
                if (attrs['data-text-layer']) tab.dataset.textLayer = attrs['data-text-layer'];
                if (attrs['data-effect-tab']) tab.dataset.effectTab = attrs['data-effect-tab'];
                return tab;
            });
        },
        querySelectorAll(selector) {
            if (selector === '[data-text-layer]') return tabs.filter(tab => tab.dataset.textLayer);
            if (selector === '[data-effect-tab]') return tabs.filter(tab => tab.dataset.effectTab);
            return [];
        },
        querySelector(selector) {
            if (!nodes.has(selector)) nodes.set(selector, selector === '#effectControls' ? mountedRoot(focused) : { focus() {} });
            return nodes.get(selector);
        }
    };
}
function key(button, value, extra = {}) {
    const event = { key: value, target: button, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    button.onkeydown(event);
    return event;
}
for (const domain of ['text', 'effects']) {
    function fixture() {
        const focused = [], root = mountedRoot(focused), project = createDemoProject();
        const values = domain === 'text' ? ['title', 'caption', 'credit', 'frame'] : ['cards', 'motion'];
        const selector = domain === 'text' ? '[data-text-layer]' : '[data-effect-tab]';
        let active = values[0], current = true, selections = 0;
        const select = value => { selections++; active = value; render(); };
        function render() {
            const api = { state: project, total: 12, current: () => current, input() {}, snapshot() { throw Error('tab must not edit'); } };
            if (domain === 'text') mountDesignPanel(root, { ...api, layer: active, select });
            else mountEffectsPanel(root, { ...api, tab: active, changeTab: select });
        }
        render();
        return { root, focused, values, project, render,
            tabs: () => root.querySelectorAll(selector), get active() { return active; },
            get selections() { return selections; }, invalidate() { current = false; } };
    }
    test(`${domain} tabs wrap, activate Home/End and focus only newly mounted nodes`, () => {
        const f = fixture(), before = JSON.stringify(f.project);
        const original = f.tabs()[0];
        assert.equal(key(original, 'ArrowLeft').prevented, true);
        assert.equal(f.active, f.values.at(-1));
        assert.equal(f.focused.at(-1), f.tabs().at(-1));
        key(f.tabs().at(-1), 'ArrowRight');
        assert.equal(f.active, f.values[0]);
        key(f.tabs()[0], 'End');
        assert.equal(f.active, f.values.at(-1));
        key(f.tabs().at(-1), 'Home');
        assert.equal(f.active, f.values[0]);
        const count = f.selections;
        key(original, 'End');
        original.onclick();
        assert.equal(f.selections, count, 'detached handlers are inert');
        assert.equal(JSON.stringify(f.project), before);
        const current = f.tabs()[0];
        current.onclick();
        assert.equal(f.selections, count, 'active tab does not rerender');
    });
    test(`${domain} tabs preserve native keys and reject modified, composing and stale actions`, () => {
        const f = fixture(), button = f.tabs()[0];
        for (const value of ['Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown']) assert.equal(key(button, value).prevented, false);
        for (const extra of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
            { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
            assert.equal(key(button, 'ArrowRight', extra).prevented, false);
            button.onclick(extra);
        }
        button.oncompositionstart();
        assert.equal(key(button, 'End').prevented, false);
        button.oncompositionend();
        f.invalidate();
        key(button, 'End');
        button.onclick();
        assert.equal(f.selections, 0);
    });
    test(`${domain} tab relationships, one tab stop and localized remounts stay intact`, () => {
        try {
            for (const locale of ['ko', 'en', 'zh-CN']) {
                setLocale(locale, { persist: false });
                const f = fixture();
                for (let index = 0; index < f.values.length; index++) {
                    f.tabs()[index].onclick();
                    const tabs = f.tabs();
                    assert.equal(tabs.filter(tab => tab.attrs.tabindex === '0').length, 1);
                    for (const tab of tabs) {
                        const selected = tab.attrs['aria-selected'] === 'true';
                        assert.equal(tab.attrs.tabindex, selected ? '0' : '-1');
                        const panel = new RegExp(`<div id="${tab.attrs['aria-controls']}" role="tabpanel" aria-labelledby="${tab.attrs.id}"([^>]*)>`).exec(f.root.innerHTML);
                        assert.ok(panel);
                        assert.equal(panel[1].includes('hidden'), !selected);
                    }
                    assert.equal((f.root.innerHTML.match(domain === 'text' ? /class="layer-controls"/g : /id="effectControls"/g) || []).length, 1);
                }
            }
        } finally { setLocale('ko', { persist: false }); }
    });
}


test('actual app tab navigation does not edit, pause, seek or save, and rejects changed context', async () => {
    const f = await createAppFixture();
    const focused = [], tabsRoot = mountedRoot(focused), root = f.element('#panelContent');
    const queryAll = root.querySelectorAll.bind(root);
    Object.defineProperty(root, 'innerHTML', {
        get: () => tabsRoot.innerHTML,
        set: value => { tabsRoot.innerHTML = value; }
    });
    root.querySelectorAll = selector => selector === '[data-text-layer]' || selector === '[data-effect-tab]'
        ? tabsRoot.querySelectorAll(selector) : queryAll(selector);
    let writes = 0;
    f.context.localStorage.setItem = () => { writes++; };
    for (const [panel, selector, selected] of [
        ['text', '[data-text-layer]', 'textLayer'], ['effects', '[data-effect-tab]', 'effectTab']
    ]) {
        vm.runInContext(`panel = '${panel}'; current = 4; playing = true; renderPanel();`, f.context);
        const before = f.evaluate('({state, history, future, current, playing})');
        const button = root.querySelectorAll(selector)[0];
        const event = key(button, 'ArrowRight');
        f.documentEvents.get('keydown')?.(event);
        assert.deepEqual(f.evaluate('({state, history, future, current, playing})'), before);
        assert.equal(writes, 0);
        assert.equal(focused.at(-1), root.querySelectorAll(selector)[1]);
        const currentTab = root.querySelectorAll(selector)[1];
        vm.runInContext("modalOpen('Other tool', 'Other content')", f.context);
        const focusCount = focused.length;
        key(currentTab, 'Home');
        assert.equal(focused.length, focusCount, 'background tab cannot steal modal focus');
        assert.equal(f.evaluate(selected), panel === 'text' ? 'caption' : 'motion');
        f.element('#modal').close();
        const selectionBefore = f.evaluate(selected);
        vm.runInContext('state = structuredClone(state);', f.context);
        key(currentTab, 'Home');
        assert.equal(f.evaluate(selected), selectionBefore, 'changed project invalidates tab handler');
        vm.runInContext('renderPanel();', f.context);
        const mounted = root.querySelectorAll(selector)[1];
        vm.runInContext("panel = 'media';", f.context);
        key(mounted, 'Home');
        assert.equal(f.evaluate(selected), selectionBefore, 'changed panel invalidates tab handler');
    }
});


test('refused tab selection does not focus an inactive replacement', () => {
    const focused = [], root = mountedRoot(focused);
    root.innerHTML = '<button role="tab" data-text-layer="title" aria-selected="true"></button>' +
        '<button role="tab" data-text-layer="caption" aria-selected="false"></button>';
    let requested;
    bindPanelTabs(root, {
        selector: '[data-text-layer]', key: 'textLayer', active: 'title',
        current: () => true, select(value) { requested = value; }
    });
    key(root.querySelectorAll('[data-text-layer]')[0], 'ArrowRight');
    assert.equal(requested, 'caption');
    assert.equal(focused.length, 0);
});
