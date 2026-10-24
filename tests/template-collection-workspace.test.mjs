import test from 'node:test';
import vm from 'node:vm';
import { createAppFixture } from './fixtures/app.mjs';
import assert from 'node:assert/strict';
import { createTemplateWorkspace } from '../dist/template-workspace.mjs';
import { createTemplateCollectionDocument } from '../dist/template-collection.mjs';
import { createTemplateDocument } from '../dist/template-library.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { saveCustomTemplate } from '../dist/template-catalog.mjs';
import { setLocale, formatError } from '../dist/i18n.mjs';

const item = (id, name = id) => ({ ...saveCustomTemplate(name, createDemoProject()), id });
const file = templates => new Blob([JSON.stringify(createTemplateCollectionDocument(templates))]);
function deferredFile() {
    let resolve;
    return { size: 1, arrayBuffer: () => new Promise(done => { resolve = done; }), resolve: bytes => resolve(bytes) };
}
function workspace(templates = [], makeId) {
    const nodes = new Map(), project = createDemoProject();
    const result = { writes: [], downloads: [], events: [], fail: false, refreshes: 0, project };
    const query = id => {
        if (!nodes.has(id)) nodes.set(id, { value: '', focus() {} });
        return nodes.get(id);
    };
    const controller = createTemplateWorkspace({
        getProject: () => project, query, modal: { close() {} }, openModal() {},
        thumbnail() {}, preview() {}, navigate() {},
        refresh() { result.refreshes++; controller.render({}); },
        toast: value => result.events.push(formatError(value)),
        download: (blob, name) => result.downloads.push({ blob, name })
    }, {
        readStorage: key => key === 'moment-templates-v1' ? JSON.stringify(templates) : '["clean"]',
        writeStorage(key, value) {
            result.writes.push({ key, value });
            if (result.fail) throw Error('quota');
        },
        mount: (_, api) => { result.api = api; },
        ...(makeId ? { makeId } : {})
    });
    result.query = query;
    result.render = () => controller.render({});
    result.render();
    return result;
}

test('collection export/import preserves order and metadata with one additive write and fresh IDs', async () => {
    const source = [item('custom-a', '첫 번째'), item('custom-b', '第二个')];
    const a = workspace(source), before = structuredClone(a.project);
    a.api.exportCollection();
    assert.equal(a.downloads[0].name, 'templates.moment-template-collection.json');
    assert.equal(a.downloads[0].blob.type, 'application/json');
    const exported = await a.downloads[0].blob.text();
    assert.equal(exported, JSON.stringify(createTemplateCollectionDocument(source), null, 2));
    assert.equal(a.downloads[0].blob.size, new TextEncoder().encode(exported).length);
    assert.equal(a.writes.length, 0);
    await a.api.import(a.downloads[0].blob);
    assert.equal(a.api.custom.length, 4);
    for (let index = 0; index < 2; index++) {
        const copy = a.api.custom[index + 2];
        assert.notEqual(copy.id, source[index].id);
        assert.deepEqual(copy, { ...source[index], id: copy.id, category: '내 템플릿' });
    }
    assert.equal(new Set(a.api.custom.map(template => template.id)).size, 4);
    assert.deepEqual(a.api.favorites, ['clean']);
    assert.deepEqual(a.project, before);
    assert.deepEqual(a.writes.map(write => write.key), ['moment-templates-v1']);
});

test('empty collection is no-op even at capacity and supersedes an older pending import', async () => {
    const a = workspace(Array.from({ length: 20 }, (_, index) => item('custom-' + index)));
    const pending = deferredFile(), work = a.api.import(pending);
    await a.api.import(file([]));
    pending.resolve(await file([item('incoming')]).arrayBuffer());
    await work;
    assert.equal(a.api.custom.length, 20);
    assert.equal(a.writes.length, 0);
    assert.equal(a.refreshes, 0);
    const empty = workspace();
    empty.api.exportCollection();
    assert.equal(empty.downloads.length, 0);
});

test('pending collection merges current library changes and rechecks total capacity atomically', async () => {
    const a = workspace([item('existing')]);
    const pending = deferredFile(), work = a.api.import(pending);
    a.api.rename('existing');
    a.query('#renameTemplateName').value = 'Renamed during read';
    a.query('#confirmRenameTemplate').onclick();
    pending.resolve(await file([item('incoming-a'), item('incoming-b')]).arrayBuffer());
    await work;
    assert.deepEqual(a.api.custom.map(template => template.name), ['Renamed during read', 'incoming-a', 'incoming-b']);
    assert.equal(a.writes.length, 2);
    const b = workspace(Array.from({ length: 19 }, (_, index) => item('existing-' + index)));
    await b.api.import(file([item('incoming-a'), item('incoming-b')]));
    assert.equal(b.writes.length, 0);
    assert.equal(b.api.custom.length, 19);
});

test('malformed middle entry, duplicates and unknown formats never partially import', async () => {
    const valid = createTemplateCollectionDocument([item('a'), item('b'), item('c')]);
    const malformed = structuredClone(valid);
    malformed.templates[1].template.settings.speed = 0;
    const duplicate = structuredClone(valid);
    duplicate.templates[1] = duplicate.templates[0];
    for (const document of [malformed, duplicate, { ...valid, format: 'unknown' }, { ...valid, formatVersion: 2 }]) {
        const a = workspace();
        await a.api.import(new Blob([JSON.stringify(document)]));
        assert.equal(a.writes.length, 0);
        assert.equal(a.api.custom.length, 0);
        assert.equal(a.events.length, 1);
    }
});

test('collision retries exclude builtins, stored IDs, incoming IDs and earlier generated IDs', async () => {
    const ids = ['clean', 'existing', 'incoming-a', 'fresh-a', 'fresh-a', 'fresh-b'];
    const a = workspace([item('existing')], () => ids.shift());
    await a.api.import(file([item('incoming-a'), item('incoming-b')]));
    assert.deepEqual(a.api.custom.map(template => template.id), ['existing', 'fresh-a', 'fresh-b']);
    assert.equal(a.writes.length, 1);
    let attempts = 0;
    const blocked = workspace([], () => { attempts++; return 'clean'; });
    await blocked.api.import(file([item('incoming')]));
    assert.equal(attempts, 20);
    assert.equal(blocked.writes.length, 0);
});

test('failed collection write rolls back all entries and retry remains additive exactly once', async () => {
    const a = workspace([item('existing')]);
    a.fail = true;
    const backup = file([item('a'), item('b')]);
    await a.api.import(backup);
    a.render();
    assert.deepEqual(a.api.custom.map(template => template.id), ['existing']);
    assert.equal(a.writes.length, 1);
    a.fail = false;
    await a.api.import(backup);
    assert.equal(a.api.custom.length, 3);
    assert.equal(a.writes.length, 2);
    assert.deepEqual(a.api.favorites, ['clean']);
});

test('file budgets apply to actual bytes and singles retain their smaller limit', async () => {
    const a = workspace();
    let reads = 0;
    await a.api.import({ size: 6 * 1024 * 1024 + 1, arrayBuffer() { reads++; } });
    assert.equal(reads, 0);
    await a.api.import({ size: 1, arrayBuffer: async () => new ArrayBuffer(6 * 1024 * 1024 + 1) });
    const single = JSON.stringify(createTemplateDocument(item('single')));
    await a.api.import(new Blob([single, ' '.repeat(256 * 1024)]));
    await a.api.import(new Blob([new Uint8Array([0xff])]));
    assert.equal(a.writes.length, 0);
    assert.equal(a.events.length, 4);
    await a.api.import(new Blob([single]));
    assert.equal(a.writes.length, 1, 'ordinary single import still works');
});

test('collection notifications use all UI locales without translating authored names', async () => {
    try {
        for (const locale of ['ko', 'en', 'zh-CN']) {
            setLocale(locale, { persist: false });
            const a = workspace();
            await a.api.import(file([item('a', 'Keep 原文 그대로')]));
            assert.equal(a.api.custom[0].name, 'Keep 原文 그대로');
            assert.ok(!a.events[0].includes('templates.collectionImported'));
        }
    } finally { setLocale('ko', { persist: false }); }
});

test('valid collection exceeding combined library node budget is rejected without writes', async () => {
    const large = item('large');
    large.flow = Array(10000).fill('text');
    const incoming = Array.from({ length: 11 }, (_, index) => ({ ...large, id: 'large-' + index }));
    const a = workspace([item('existing')]);
    const before = structuredClone(a.api.custom);
    await a.api.import(file(incoming));
    assert.equal(a.writes.length, 0);
    assert.deepEqual(a.api.custom, before);
});


test('actual app collection import writes only template library, without applying or editing project', async () => {
    const f = await createAppFixture();
    const writes = [];
    f.context.localStorage.setItem = (key, value) => writes.push({key, value});
    vm.runInContext("panel = 'templates'; current = 4; history = [JSON.stringify(state)]; renderPanel();", f.context);
    const before = f.evaluate('({state,history,future,current,playing})');
    const picker = f.element('#panelContent').querySelector('#templateFileInput');
    picker.files = [file([item('one'), item('two')])];
    picker.value = 'templates.json';
    await picker.onchange();
    assert.equal(picker.value, '');
    assert.deepEqual(writes.map(write => write.key), ['moment-templates-v1']);
    assert.equal(JSON.parse(writes[0].value).length, 2);
    assert.deepEqual(f.evaluate('({state,history,future,current,playing})'), before);
});
