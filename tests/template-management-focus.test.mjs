import test from 'node:test';
import assert from 'node:assert/strict';
import {createTemplateWorkspace} from '../dist/template-workspace.mjs';
import {createShellPresentation} from '../dist/shell-presentation.mjs';
import {mountTemplateGallery} from '../dist/template-gallery.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {saveCustomTemplate} from '../dist/template-catalog.mjs';
import {createTemplateDocument} from '../dist/template-library.mjs';

// Synthetic DOM lifecycle only. close() grants best-case native invoker return;
// actual browser focus, dialog timing and assistive technology remain unverified.
function fixture({id = 'custom-source', name = 'Saved source'} = {}) {
    const body = {name:'body'}, focusCalls = [], nativeReturns = [], writes = [];
    let active = body, head = [], cards = [], dialog = [], grid = null, html = '', modalHTML = '', invoker;
    const decode = value => value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,
        entity => ({'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[entity]));
    function detach(nodes) {
        for (const node of nodes) {
            node.isConnected = false;
            if (active === node) active = body;
        }
    }
    function node(attributes) {
        return {
            attributes, isConnected:true, value:attributes.value || '', textContent:'',
            dataset:Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-'))
                .map(([key,value]) => [key.slice(5).replace(/-([a-z])/g, (_,letter) => letter.toUpperCase()),value])),
            name:attributes.id || attributes.class || 'control',
            classList:{toggle() {}, add() {}, remove() {}},
            setAttribute(key,value) { this.attributes[key] = String(value); },
            getAttribute(key) { return this.attributes[key] ?? null; },
            removeAttribute(key) { delete this.attributes[key]; },
            focus(options) {
                assert.equal(this.isConnected,true,'never focus a removed control');
                active = this; focusCalls.push({node:this,options});
            },
            querySelector() { return null; },
        };
    }
    function parse(markup) {
        return [...markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)].flatMap(([,tag,raw]) => {
            const attributes = Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)]
                .map(([,key,value]) => [key,decode(value)]));
            return attributes.id || /^(button|input|canvas)$/.test(tag) ? [node(attributes)] : [];
        });
    }
    function matches(item,selector) {
        if (selector.startsWith('#')) return item.attributes.id === selector.slice(1);
        if (selector.startsWith('.')) return (item.attributes.class || '').split(/\s+/).includes(selector.slice(1));
        const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
        return !!attribute && Object.hasOwn(item.attributes,attribute);
    }
    const root = {
        isConnected:true,
        get innerHTML() { return html; },
        set innerHTML(value) {
            detach(head); detach(cards); head = parse(html = value); cards = [];
            let markup = '';
            grid = head.some(item => item.attributes.id === 'templateGrid') ? {
                get innerHTML() { return markup; },
                set innerHTML(value) { detach(cards); cards = parse(markup = value); },
            } : null;
        },
        querySelector(selector) { return selector === '#templateGrid' ? grid : this.querySelectorAll(selector)[0] || null; },
        querySelectorAll(selector) { return [...head,...cards].filter(item => matches(item,selector)); },
    };
    const modal = {
        open:false, classList:{add() {}},
        get innerHTML() { return modalHTML; },
        set innerHTML(value) { detach(dialog); dialog = parse(modalHTML = value); },
        showModal() { invoker = active; this.open = true; active = dialog[0] || body; },
        close() {
            this.open = false;
            if (invoker?.isConnected) { active = invoker; nativeReturns.push(invoker); }
            this.onclose?.();
        },
    };
    const query = selector => dialog.find(item => matches(item,selector)) || root.querySelector(selector);
    let shell;
    shell = createShellPresentation({query, queryAll:() => [], document:{}, modal,
        openDialog:(...args) => shell.modalOpen(...args), setTimer() {}, clearTimer() {}});
    const project = createDemoProject(), source = {...saveCustomTemplate(name,project),id};
    const result = {root,modal,query,project,source,focusCalls,nativeReturns,writes,
        body, get active() { return active; }, userFocus(control) { active = control; },
        fail:false, skipRefresh:false, afterRefresh:null};
    let controller;
    const render = () => controller.render(root);
    const refresh = () => { if (!result.skipRefresh) render(); result.afterRefresh?.(); };
    controller = createTemplateWorkspace({getProject:() => result.project, query, modal,
        openModal:(...args) => shell.modalOpen(...args), thumbnail() {}, preview() {},
        refresh, navigate:refresh, toast() {}, download() {}}, {
        readStorage:key => key === 'moment-templates-v1' ? JSON.stringify([source]) : '[]',
        writeStorage(...args) { writes.push(args); if (result.fail) throw new Error('synthetic quota failure'); },
        mount(target,api) { result.api = api; result.port = mountTemplateGallery(target,api); return result.port; },
        makeId:() => 'custom-copy',
    });
    result.render = render;
    result.open = action => {
        const opener = action === 'save' ? root.querySelector('#saveMyTemplate')
            : root.querySelectorAll(`[data-${action}-template]`).find(item => item.dataset[`${action}Template`] === id);
        assert.ok(opener,action + ' opener exists');
        result.userFocus(opener); opener.onclick(); return opener;
    };
    result.confirm = (action,value = action + ' result') => {
        const field = {rename:'renameTemplateName',duplicate:'duplicateTemplateName',save:'customTemplateName'}[action];
        if (field) query('#'+field).value = value;
        const button = query('#'+{rename:'confirmRenameTemplate',update:'confirmUpdateTemplate',duplicate:'confirmDuplicateTemplate',remove:'confirmRemoveTemplate',save:'saveCustomTemplate'}[action]);
        result.userFocus(button); button.onclick();
    };
    render(); return result;
}

for (const action of ['rename','update','duplicate','remove','save']) {
    test(`${action} returns focus to a freshly mounted name or the search fallback`, () => {
        const f = fixture(), before = structuredClone(f.project), opener = f.open(action);
        const focusBefore = f.focusCalls.length;
        f.confirm(action);
        const target = action === 'remove' ? f.root.querySelector('#templateSearch')
            : f.root.querySelectorAll('.template-name').find(item => item.dataset.previewTemplate ===
                (action === 'duplicate' ? 'custom-copy' : action === 'save'
                    ? f.api.custom.find(item => item.name === 'save result').id : f.source.id));
        assert.equal(f.modal.open,false); assert.equal(opener.isConnected,false);
        assert.equal(f.active,target,'focus must survive removal of the native-returned opener');
        assert.equal(f.focusCalls.length,focusBefore + 1);
        assert.notEqual(f.focusCalls.at(-1).options?.preventScroll,true,'result navigation keeps native scrolling enabled');
        assert.equal(f.nativeReturns.at(-1),opener);
        assert.deepEqual(f.project,before); assert.equal(f.writes.length,1);
        assert.equal(f.writes[0][0],'moment-templates-v1');
    });
}

for (const action of ['rename','update','duplicate','remove','save']) {
    test(`${action} write failure retains the dialog and retry restores focus only after success`, () => {
        const f = fixture(), before = structuredClone(f.project);
        f.fail = true; f.open(action);
        const focusBefore = f.focusCalls.length;
        f.confirm(action);
        assert.equal(f.modal.open,true); assert.equal(f.nativeReturns.length,0);
        assert.equal(f.focusCalls.length,focusBefore); assert.deepEqual(f.api.custom,[f.source]);
        f.fail = false; f.confirm(action);
        assert.equal(f.modal.open,false); assert.equal(f.focusCalls.length,focusBefore + 1);
        assert.equal(f.active.isConnected,true); assert.equal(f.writes.length,2);
        assert.deepEqual(f.project,before);
    });

    test(`${action} cancellation leaves unchanged native return behavior without explicit focus`, () => {
        const f = fixture(), opener = f.open(action), focusBefore = f.focusCalls.length;
        const cancel = {rename:'cancelRenameTemplate',update:'cancelUpdateTemplate',
            duplicate:'cancelDuplicateTemplate',remove:'cancelRemoveTemplate',save:'closeModal'}[action];
        f.query('#'+cancel).onclick();
        assert.equal(f.modal.open,false); assert.equal(f.active,opener);
        assert.equal(opener.isConnected,true); assert.equal(f.focusCalls.length,focusBefore);
        assert.equal(f.writes.length,0);
    });
}

test('unchanged rename closes without remounting or adding explicit focus', () => {
    const f = fixture(), opener = f.open('rename'), focusBefore = f.focusCalls.length;
    f.confirm('rename','  '+f.source.name+'  ');
    assert.equal(f.active,opener); assert.equal(opener.isConnected,true);
    assert.equal(f.writes.length,0); assert.equal(f.focusCalls.length,focusBefore);
});

test('a renamed template excluded by the retained query falls back to search', () => {
    const f = fixture({name:'Needle source'});
    f.api.ui.query = 'Needle'; f.render(); f.open('rename'); f.confirm('rename','Different');
    assert.equal(f.api.ui.query,'Needle');
    assert.ok(!f.root.querySelectorAll('.template-name').some(item => item.dataset.previewTemplate === f.source.id));
    assert.equal(f.active,f.root.querySelector('#templateSearch'));
});

test('hostile template IDs are matched through decoded datasets, not selector interpolation', () => {
    const f = fixture({id:'custom-"][data-owner="else"]<&'});
    f.open('rename'); f.confirm('rename','Safe name');
    assert.equal(f.active.dataset.previewTemplate,f.source.id);
    assert.ok(f.root.querySelectorAll('.template-name').includes(f.active));
});

test('gallery focus handles refuse stale owners, missing grids and detached roots', () => {
    const f = fixture(), stale = f.port;
    f.render(); const count = f.focusCalls.length;
    stale.focusTemplate(f.source.id); assert.equal(f.focusCalls.length,count);
    f.root.isConnected = false; f.port.focusTemplate(f.source.id);
    assert.equal(f.focusCalls.length,count);
    f.root.isConnected = true;
    f.root.innerHTML = '<button id="otherPanel">Other panel</button>';
    f.port.focusTemplate(f.source.id); assert.equal(f.focusCalls.length,count);
});

for (const context of ['new modal','closed newer dialog','query','category','nested gallery','other panel','detached root']) {
    test(`successful update does not steal focus when ${context} changes during refresh`, () => {
        const f = fixture(); let expected, expectedCalls;
        f.afterRefresh = () => {
            f.afterRefresh = null;
            if (context === 'new modal' || context === 'closed newer dialog') {
                f.open('rename');
                if (context === 'closed newer dialog') f.modal.close();
            } else if (context === 'query') {
                const search = f.root.querySelector('#templateSearch');
                search.value = 'unrelated'; search.oninput({target:search}); f.userFocus(search);
            } else if (context === 'category') {
                const filter = f.root.querySelectorAll('[data-category]').find(item => item.dataset.category === '리뷰');
                filter.onclick(); f.userFocus(filter);
            } else if (context === 'nested gallery') {
                f.render(); f.userFocus(f.root.querySelector('#templateSearch'));
            } else if (context === 'other panel') {
                f.root.innerHTML = '<button id="otherPanel">Other panel</button>';
                f.userFocus(f.root.querySelector('#otherPanel'));
            } else f.root.isConnected = false;
            expected = f.active; expectedCalls = f.focusCalls.length;
        };
        f.open('update'); f.confirm('update');
        assert.equal(f.active,expected); assert.equal(f.focusCalls.length,expectedCalls);
        assert.equal(f.writes.length,1);
    });
}

test('a successful callback without a new gallery mount does not focus an old view', () => {
    const f = fixture(), opener = f.open('update'), count = f.focusCalls.length;
    f.skipRefresh = true; f.confirm('update');
    assert.equal(f.active,opener); assert.equal(opener.isConnected,true);
    assert.equal(f.focusCalls.length,count); assert.equal(f.writes.length,1);
});

test('pending template import retains its existing no-focus behavior while a newer dialog is open', async () => {
    const f = fixture(), before = structuredClone(f.project);
    const bytes = new TextEncoder().encode(JSON.stringify(createTemplateDocument({...f.source,id:'incoming',name:'Imported'})));
    let resolve;
    const pending = f.api.import({size:bytes.byteLength,arrayBuffer:() => new Promise(done => { resolve = done; })});
    f.open('rename'); const input = f.query('#renameTemplateName'); f.userFocus(input);
    const count = f.focusCalls.length;
    resolve(bytes.buffer); await pending;
    assert.equal(f.modal.open,true); assert.equal(f.active,input);
    assert.equal(f.focusCalls.length,count); assert.equal(f.writes.length,1);
    assert.deepEqual(f.project,before);
});
