import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateWorkspace } from '../dist/template-workspace.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { saveCustomTemplate } from '../dist/template-catalog.mjs';

function workspace(templates = []) {
  const stored = new Map([['moment-templates-v1', JSON.stringify(templates)]]);
  const controls = new Map();
  const query = selector => {
    if (!controls.has(selector)) controls.set(selector, { value: '', focus() { this.focused = true; } });
    return controls.get(selector);
  };
  const result = { project: createDemoProject(), events: [], query, stored };
  const controller = createTemplateWorkspace({
    getProject: () => result.project,
    query,
    modal: { close: () => result.events.push('close') },
    openModal: title => result.events.push(title),
    thumbnail() {}, preview: item => result.events.push(item.id),
    refresh: () => controller.render({}),
    navigate: panel => { result.events.push(panel); controller.render({}); },
    toast: message => result.events.push(message),
  }, {
    readStorage: key => stored.get(key) ?? null,
    writeStorage: (key, value) => stored.set(key, value),
    mount: (_, options) => { result.api = options; },
  });
  result.render = () => controller.render({});
  result.render();
  return result;
}

test('template workspace retains gallery choices while reading the latest replaced project', () => {
  const a = workspace(), b = workspace();
  a.api.ui.query = '검색';
  a.api.ui.category = '즐겨찾기';
  a.api.favorite('clean');
  a.project = { ...createDemoProject(), templateId: 'punch', name: '새 프로젝트' };
  a.render();
  assert.equal(a.api.active, 'punch');
  assert.deepEqual(a.api.ui, { query: '검색', category: '즐겨찾기' });
  assert.deepEqual(b.api.favorites, []);
  assert.equal(b.api.ui.query, '');
  a.api.preview({ id: 'clean' });
  assert.equal(a.events.at(-1), 'clean');
  a.api.favorite('clean');
  assert.deepEqual(a.api.favorites, []);
});

test('template workspace preserves empty-name, cancel and capacity boundaries', () => {
  const a = workspace();
  a.api.save();
  a.query('#customTemplateName').value = '   ';
  a.query('#saveCustomTemplate').onclick();
  assert.equal(a.query('#customTemplateName').focused, true);
  assert.equal(a.api.custom.length, 0);
  a.query('#customTemplateName').value = '내 스타일';
  a.query('#saveCustomTemplate').onclick();
  assert.equal(a.api.custom.length, 1);
  assert.equal(a.api.ui.category, '내 템플릿');
  const saved = a.api.custom[0];
  a.api.remove(saved.id);
  a.query('#cancelRemoveTemplate').onclick();
  assert.equal(a.api.custom.length, 1);
  a.api.remove(saved.id);
  a.query('#confirmRemoveTemplate').onclick();
  assert.equal(a.api.custom.length, 0);
  const template = saveCustomTemplate('가득 찬 보관함', createDemoProject());
  const full = workspace(Array.from({ length: 20 }, (_, i) => ({ ...template, id: `custom-fixture-${i}` })));
  full.api.save();
  assert.match(full.events.at(-1), /20개까지/);
  assert.equal(full.events.length, 1);
  assert.equal(full.api.custom.length, 20);
});
