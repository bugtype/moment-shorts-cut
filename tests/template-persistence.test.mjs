import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateWorkspace } from '../dist/template-workspace.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { saveCustomTemplate } from '../dist/template-catalog.mjs';

// Characterize existing injected-port/reference behavior, not storage isolation
// or native browser concurrency. Replacement and in-place aliases differ.
function fixture(onWrite = () => {}, onToast = () => {}) {
  const project = createDemoProject(), template = saveCustomTemplate('original', project, {id:'custom-a'});
  const stored = new Map([
    ['moment-templates-v1', JSON.stringify([template, {...template,id:'custom-b'}])],
    ['moment-favorites-v1', '[]'],
  ]);
  const controls = new Map(), trace = [], f = {project, stored, trace, writes:0};
  const query = key => {
    if (!controls.has(key)) controls.set(key, {value:'',focus() { trace.push('focus-input'); }});
    return controls.get(key);
  };
  const modal = {open:false,close() { this.open = false; trace.push('close'); }};
  const controller = createTemplateWorkspace({
    getProject: () => project, query, modal,
    openModal() { modal.open = true; trace.push('open'); },
    thumbnail() {}, preview() {}, download() {},
    refresh() { trace.push('refresh'); controller.render({}); },
    navigate() { trace.push('navigate'); controller.render({}); },
    toast(value) { trace.push(`toast:${value.messageKey}`); onToast(value); },
  }, {
    readStorage: key => stored.get(key) ?? null,
    writeStorage(key, value) {
      const number = ++f.writes;
      trace.push(`write:${number}:${key}`);
      onWrite(f, number, key, value);
      stored.set(key, value);
    },
    mount(_target, api) {
      f.api = api; trace.push('mount');
      return {focusTemplate() { trace.push('focus-template'); }};
    },
    makeId: () => 'custom-new',
  });
  f.query = query;
  f.render = () => controller.render({});
  f.rename = name => {
    f.api.rename('custom-a'); query('#renameTemplateName').value = name;
    query('#confirmRenameTemplate').onclick();
  };
  f.removeB = () => { f.api.remove('custom-b'); query('#confirmRemoveTemplate').onclick(); };
  f.render();
  return f;
}

for (const method of ['map', 'filter']) {
  test(`replacement captures the previous array before reentrant ${method} evaluation`, () => {
    const f = fixture((_f, number) => { if (number === 2) throw Error('outer write failure'); });
    const before = f.api.custom, favorites = f.api.favorites, project = structuredClone(f.project);
    let nested;
    Object.defineProperty(before, method, {get() {
      f.trace.push(`${method}-getter`);
      if (method === 'map') f.removeB(); else f.rename('nested');
      nested = f.api.custom;
      return Array.prototype[method];
    }});
    if (method === 'map') f.rename('renamed'); else f.removeB();
    f.render();
    assert.equal(f.writes, 2);
    assert.notEqual(nested, before);
    assert.equal(f.api.custom, before, 'rollback restores the pre-transform reference');
    assert.equal(f.api.custom.length, 2);
    assert.equal(f.api.custom[0].name, 'original');
    assert.equal(f.api.favorites, favorites);
    assert.deepEqual(f.project, project);
    assert.ok(f.trace.indexOf(`${method}-getter`) < f.trace.indexOf('write:1:moment-templates-v1'));
  });
}

for (const failOuter of [false, true]) {
  test(`reentrant successful replacement ${failOuter ? 'rolls back to the outer prior array on outer failure' : 'remains selected after outer success'}`, () => {
    let nested;
    const f = fixture((f, number) => {
      if (number === 1) {
        f.removeB(); nested = f.api.custom;
        if (failOuter) throw Error('outer write failure');
      }
    });
    const before = f.api.custom, favorites = f.api.favorites, project = structuredClone(f.project);
    f.rename('renamed'); f.render();
    assert.equal(f.writes, 2);
    assert.notEqual(nested, before);
    assert.equal(f.api.custom, failOuter ? before : nested);
    assert.equal(f.api.custom.length, failOuter ? 2 : 1);
    assert.equal(f.api.custom[0].name, failOuter ? 'original' : 'renamed');
    assert.equal(f.api.favorites, favorites);
    assert.deepEqual(f.project, project);
  });
}

test('throwing replacement transforms preserve the original error, array and no-write outcome', () => {
  for (const method of ['map', 'filter']) {
    const f = fixture(), before = f.api.custom, failure = Error('transform failure');
    Object.defineProperty(before, method, {get() { throw failure; }});
    assert.throws(() => method === 'map' ? f.rename('renamed') : f.removeB(), error => error === failure);
    f.render();
    assert.equal(f.writes, 0);
    assert.equal(f.api.custom, before);
  }
});

test('throwing persistence feedback retains the existing caller exception and published candidate', () => {
  const failure = Error('toast failure');
  const f = fixture(() => { throw Error('write failure'); }, () => { throw failure; });
  const before = f.api.custom;
  assert.throws(() => f.rename('renamed'), error => error === failure);
  f.render();
  assert.equal(f.writes, 1);
  assert.notEqual(f.api.custom, before, 'persistence did not return false, so no rollback ran');
  assert.equal(f.api.custom[0].name, 'renamed');
  assert.equal(JSON.parse(f.stored.get('moment-templates-v1'))[0].name, 'original');
});

test('failed in-place Save and favorites preserve their separate mounted aliases', () => {
  const f = fixture(() => { throw Error('write failure'); });
  const before = f.api.custom, favorites = f.api.favorites, snapshot = JSON.stringify(before);
  f.api.save(); f.query('#customTemplateName').value = 'unsaved'; f.query('#saveCustomTemplate').onclick();
  assert.equal(f.api.custom, before);
  assert.equal(JSON.stringify(before), snapshot);
  f.api.favorite('custom-a');
  assert.equal(f.api.favorites, favorites);
  assert.deepEqual(favorites, []);
});
