import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {createDemoProject} from '../dist/core/project.mjs';
import {saveCustomTemplate} from '../dist/template-catalog.mjs';
import {createTemplateDocument} from '../dist/template-library.mjs';
import {createTemplateCollectionDocument, MAX_TEMPLATE_COLLECTION_BYTES} from '../dist/template-collection.mjs';

const source = {...saveCustomTemplate('Imported style', createDemoProject()), id:'custom-import-one'};
const documents = {
    single:createTemplateDocument(source),
    collection:createTemplateCollectionDocument([source, {...source, id:'custom-import-two', name:'Second style'}]),
};
const fileFor = format => new Blob([JSON.stringify(documents[format])]);
function pendingFile() {
    let resolve;
    return {size:1, arrayBuffer:() => new Promise(done => { resolve = done; }), finish:bytes => resolve(bytes)};
}

// Real app, gallery onchange and panel handlers; only byte delivery and numeric
// input replacement are modeled. Native browser/IME/focus behavior is not tested.
async function fixture() {
    const f = await createAppFixture(), root = f.element('#panelContent');
    const queryAll = root.querySelectorAll.bind(root), queryDocument = f.doc.querySelector.bind(f.doc);
    let html = root.innerHTML, inputs = [], assignments = 0, gallery;
    Object.defineProperty(root, 'innerHTML', {
        get:() => html,
        set:value => {
            html = value; assignments++;
            for (const input of inputs) {
                input.isConnected = false;
                if (f.doc.activeElement === input) f.doc.activeElement = f.doc.body;
            }
            inputs = [...value.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
                const design = /\bdata-design="(design\.(?:title|credit)\.(?:start|end))"/.exec(tag)?.[1];
                const id = /\bid="(panelTrimStart|panelTrimEnd)"/.exec(tag)?.[1];
                if (!design && !id) return [];
                return [{id, type:'number', dataset:design ? {design} : {},
                    value:/\bvalue="([^"]*)"/.exec(tag)?.[1] || '', isConnected:true,
                    get valueAsNumber() { return this.value.trim() === '' ? NaN : Number(this.value); },
                    focus() { f.doc.activeElement = this; },
                    setCustomValidity() {}, reportValidity() {}, setAttribute() {}, removeAttribute() {}}];
            });
        },
    });
    root.querySelectorAll = selector => selector === '[data-design]' ? inputs.filter(input => input.dataset.design) : queryAll(selector);
    f.doc.querySelector = selector => inputs.find(input => input.id && selector === '#' + input.id) || queryDocument(selector);
    const mount = f.context.mountTemplateGallery;
    f.context.mountTemplateGallery = (target, api) => { gallery = api; return mount(target, api); };
    const writes = [], stored = new Map();
    f.failStorage = false;
    f.context.localStorage.setItem = (key, value) => {
        writes.push([key, value]);
        if (f.failStorage) throw new Error('synthetic quota failure');
        stored.set(key, value);
    };
    vm.runInContext('state.overlays=[];history=[];future=[];current=2;globalThis.projectSaves=0;scheduleSave=()=>projectSaves++;', f.context);
    f.switch = panel => vm.runInContext(`textLayer='title';effectTab='cards';switchPanel(${JSON.stringify(panel)})`, f.context);
    f.choose = file => {
        const picker = root.querySelector('#templateFileInput');
        picker.files = [file]; picker.value = 'selected';
        const promise = picker.onchange();
        assert.equal(picker.value, '', 'same-file retry remains possible');
        return promise;
    };
    f.control = key => inputs.find(input => input.dataset.design === key || input.id === key);
    f.snapshot = () => f.evaluate('({state,history,future,current,selected,panel,projectSaves,videoFile:sources.videoFile,audioFile:sources.audioFile,sourceURL:sources.sourceURL,audioURL:sources.audioURL})');
    f.assignments = () => assignments;
    f.gallery = () => gallery;
    f.root = root; f.writes = writes; f.stored = stored;
    f.switch('templates');
    return f;
}

for (const format of ['single', 'collection']) {
    test(`${format} import keeps the actual Title draft, which can still commit and Undo`, async () => {
        const f = await fixture(), file = pendingFile(), pending = f.choose(file);
        f.switch('text');
        const input = f.control('design.title.start');
        input.value = '2.75'; input.focus();
        const before = f.snapshot(), assignments = f.assignments();
        file.finish(await fileFor(format).arrayBuffer()); await pending;
        assert.equal(f.assignments(), assignments);
        assert.equal(f.control('design.title.start') === input, true);
        assert.equal(input.isConnected, true); assert.equal(input.value, '2.75');
        assert.equal(f.doc.activeElement, input); assert.deepEqual(f.snapshot(), before);
        assert.deepEqual(f.writes.map(([key]) => key), ['moment-templates-v1']);
        assert.equal(JSON.parse(f.stored.get('moment-templates-v1')).length, format === 'single' ? 1 : 2);
        input.onchange();
        assert.equal(f.evaluate('state.design.title.start'), 2.75);
        assert.equal(f.evaluate('history.length'), 1);
        vm.runInContext('undo()', f.context);
        assert.deepEqual(f.evaluate('state'), before.state);
        assert.equal(f.writes.length, 1, 'project edits do not rewrite the template library');
    });

    test(`${format} import keeps Frame trim drafts until explicit Apply, then Undo works`, async () => {
        const f = await fixture(), file = pendingFile(), pending = f.choose(file);
        f.switch('settings');
        const start = f.control('panelTrimStart'), end = f.control('panelTrimEnd');
        start.value = '1.2345'; end.value = '9.8765'; start.focus();
        const before = f.snapshot(), assignments = f.assignments();
        file.finish(await fileFor(format).arrayBuffer()); await pending;
        assert.equal(f.assignments(), assignments);
        assert.equal(f.control('panelTrimStart') === start, true);
        assert.equal(f.control('panelTrimEnd') === end, true);
        assert.equal(start.isConnected, true); assert.equal(f.doc.activeElement, start);
        assert.deepEqual([start.value, end.value], ['1.2345', '9.8765']);
        assert.deepEqual(f.snapshot(), before);
        assert.deepEqual(f.writes.map(([key]) => key), ['moment-templates-v1']);
        f.element('#panelTrimApply').onclick();
        assert.deepEqual(f.evaluate('state.clips'), [{start:1.2345, end:9.8765}]);
        assert.equal(f.evaluate('history.length'), 1);
        vm.runInContext('undo()', f.context);
        assert.deepEqual(f.evaluate('state'), before.state);
        assert.equal(f.writes.length, 1);
    });
}

test('completion refreshes the current gallery, including after leaving and returning', async () => {
    for (const leaveAndReturn of [false, true]) {
        const f = await fixture(), file = pendingFile(), pending = f.choose(file);
        if (leaveAndReturn) { f.switch('text'); f.switch('templates'); }
        const previous = f.gallery(), before = f.snapshot(), assignments = f.assignments();
        file.finish(await fileFor('collection').arrayBuffer()); await pending;
        assert.equal(f.assignments(), assignments + 1);
        assert.notEqual(f.gallery(), previous);
        assert.deepEqual(f.gallery().custom.map(item => item.name), ['Imported style', 'Second style']);
        assert.equal(f.gallery().ui.category, '내 템플릿');
        assert.deepEqual(f.snapshot(), before);
        assert.deepEqual(f.writes.map(([key]) => key), ['moment-templates-v1']);
    }
});

test('other completion-time panels remain mounted and the next gallery visit shows imported copies', async () => {
    for (const panel of ['media', 'audio', 'captions', 'effects', 'unknown-panel']) {
        const f = await fixture(), file = pendingFile(), pending = f.choose(file);
        f.switch(panel);
        const before = f.snapshot(), assignments = f.assignments(), html = f.root.innerHTML;
        file.finish(await fileFor('single').arrayBuffer()); await pending;
        assert.equal(f.assignments(), assignments, panel);
        assert.equal(f.root.innerHTML, html); assert.deepEqual(f.snapshot(), before);
        assert.deepEqual(f.writes.map(([key]) => key), ['moment-templates-v1']);
        f.switch('templates');
        assert.equal(f.gallery().custom.length, 1);
        assert.equal(f.gallery().custom[0].name, 'Imported style');
        assert.notEqual(f.gallery().custom[0].id, source.id);
    }
});

test('invalid, oversized and empty imports keep the panel, project and library untouched', async () => {
    const files = [new Blob(['{']), new Blob([new Uint8Array([255])]),
        {size:MAX_TEMPLATE_COLLECTION_BYTES + 1, arrayBuffer() { throw new Error('must not read'); }},
        {size:1, arrayBuffer:async () => new ArrayBuffer(MAX_TEMPLATE_COLLECTION_BYTES + 1)},
        new Blob([JSON.stringify(createTemplateCollectionDocument([]))])];
    for (const file of files) {
        const f = await fixture(), before = f.snapshot(), assignments = f.assignments();
        await f.choose(file);
        assert.equal(f.assignments(), assignments);
        assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.writes, []);
        assert.equal(f.gallery().custom.length, 0);
    }
});

test('latest picker selection still supersedes a pending import, even when newer input fails', async () => {
    for (const latestValid of [false, true]) {
        const f = await fixture(), older = pendingFile(), latest = pendingFile();
        const p1 = f.choose(older), p2 = f.choose(latest);
        f.switch('text');
        const input = f.control('design.title.start'); input.value = '2.75'; input.focus();
        const before = f.snapshot(), assignments = f.assignments();
        latest.finish(await (latestValid ? fileFor('collection') : new Blob(['{'])).arrayBuffer()); await p2;
        older.finish(await fileFor('single').arrayBuffer()); await p1;
        assert.equal(f.assignments(), assignments);
        assert.equal(f.control('design.title.start') === input, true);
        assert.equal(input.value, '2.75'); assert.deepEqual(f.snapshot(), before);
        assert.equal(f.writes.length, latestValid ? 1 : 0);
        f.switch('templates');
        assert.equal(f.gallery().custom.length, latestValid ? 2 : 0);
    }
});

test('failed storage retains the library and current panel, then the same file can be retried', async () => {
    const f = await fixture(), bytes = await fileFor('single').arrayBuffer();
    f.failStorage = true;
    const failed = pendingFile(), p1 = f.choose(failed);
    f.switch('settings');
    const start = f.control('panelTrimStart'); start.value = '1.2345'; start.focus();
    const before = f.snapshot(), assignments = f.assignments();
    failed.finish(bytes); await p1;
    assert.equal(f.assignments(), assignments); assert.equal(f.control('panelTrimStart'), start);
    assert.deepEqual(f.snapshot(), before); assert.equal(f.stored.size, 0);
    assert.deepEqual(f.writes.map(([key]) => key), ['moment-templates-v1']);
    f.switch('templates'); assert.equal(f.gallery().custom.length, 0);
    f.failStorage = false;
    await f.choose(fileFor('single'));
    assert.equal(f.gallery().custom.length, 1);
    assert.deepEqual(f.writes.map(([key]) => key), ['moment-templates-v1', 'moment-templates-v1']);
    assert.equal(f.evaluate('projectSaves'), 0);
});

test('explicitly saving the current composition still navigates to its updated gallery', async () => {
    const f = await fixture(), before = f.snapshot();
    f.root.querySelector('#saveMyTemplate').onclick();
    f.element('#customTemplateName').value = 'Saved current composition';
    f.element('#saveCustomTemplate').onclick();
    assert.equal(f.evaluate('panel'), 'templates');
    assert.equal(f.gallery().custom.length, 1);
    assert.equal(f.gallery().custom[0].name, 'Saved current composition');
    assert.equal(f.gallery().ui.category, '내 템플릿');
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.writes.map(([key]) => key), ['moment-templates-v1']);
});
