import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateWorkspace } from '../dist/template-workspace.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { saveCustomTemplate } from '../dist/template-catalog.mjs';

function workspace(templates = [], options = {}) {
  const stored = new Map([['moment-templates-v1', options.raw ?? JSON.stringify(templates)]]);
  const controls = new Map();
  const query = selector => {
    if (!controls.has(selector)) controls.set(selector, { value: '', focus() { this.focused = true; } });
    return controls.get(selector);
  };
  const result = { project: createDemoProject(), events: [], writes: [], failKey: '', downloads: [], query, stored };
  const controller = createTemplateWorkspace({
    getProject: () => result.project,
    query,
    modal: { close: () => result.events.push('close') },
    openModal: title => result.events.push(title),
    thumbnail() {}, preview: item => result.events.push(item.id),
    refresh: () => controller.render({}),
    navigate: panel => { result.events.push(panel); controller.render({}); },
    toast: message => result.events.push(message),
    download: (blob, name) => result.downloads.push({ blob, name }),
  }, {
    readStorage: key => stored.get(key) ?? null,
    writeStorage: (key, value) => {
      result.writes.push(key);
      if (key === result.failKey) throw new Error('synthetic quota failure');
      stored.set(key, value);
    },
    mount: (_, options) => { result.api = options; },
    ...(options.makeId ? { makeId: options.makeId } : {}),
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


test('template save and delete do not rewrite unchanged favorites', () => {
  const a = workspace();
  a.failKey = 'moment-favorites-v1';
  a.api.save();
  a.query('#customTemplateName').value = '나의 구성';
  a.query('#saveCustomTemplate').onclick();
  assert.equal(a.api.custom.length, 1, 'an unrelated favorites write must not roll back a saved template');
  assert.deepEqual(JSON.parse(a.stored.get('moment-templates-v1')), a.api.custom);
  a.api.remove(a.api.custom[0].id);
  a.query('#confirmRemoveTemplate').onclick();
  assert.deepEqual(a.api.custom, []);
  assert.deepEqual(JSON.parse(a.stored.get('moment-templates-v1')), []);
  assert.deepEqual(a.writes, ['moment-templates-v1', 'moment-templates-v1']);
});

test('favorites do not rewrite templates and failed writes retain both UI and storage', () => {
  const a = workspace();
  const original = a.stored.get('moment-templates-v1');
  a.failKey = 'moment-templates-v1';
  a.api.favorite('clean');
  assert.deepEqual(a.api.favorites, ['clean']);
  assert.deepEqual(JSON.parse(a.stored.get('moment-favorites-v1')), ['clean']);
  assert.equal(a.stored.get('moment-templates-v1'), original);
  assert.deepEqual(a.writes, ['moment-favorites-v1']);
  a.failKey = 'moment-favorites-v1';
  a.api.favorite('clean');
  assert.deepEqual(a.api.favorites, ['clean']);
  assert.deepEqual(JSON.parse(a.stored.get('moment-favorites-v1')), ['clean']);
});

test('failed template deletion remains intact in storage and on screen, then retries', () => {
  const template = saveCustomTemplate('기존 구성', createDemoProject());
  const a = workspace([template]);
  a.failKey = 'moment-templates-v1';
  a.api.remove(template.id);
  a.query('#confirmRemoveTemplate').onclick();
  a.render();
  assert.deepEqual(a.api.custom, [template]);
  assert.deepEqual(JSON.parse(a.stored.get('moment-templates-v1')), [template]);
  a.failKey = '';
  a.query('#confirmRemoveTemplate').onclick();
  assert.deepEqual(a.api.custom, []);
  assert.deepEqual(JSON.parse(a.stored.get('moment-templates-v1')), []);
});


const templateFile = template => new Blob([JSON.stringify({format: 'moment-template', formatVersion: 1, template})]);
function pendingFile() {
  let finish;
  return { size: 1, arrayBuffer: () => new Promise(resolve => { finish = resolve; }), resolve: bytes => finish(bytes) };
}

test('template file round trip adds a fresh copy without replacing project or favorites', async () => {
  const item = saveCustomTemplate('공유 스타일', createDemoProject());
  const a = workspace([item]), original = structuredClone(a.project);
  a.api.favorite('clean');
  a.api.export(item.id);
  assert.equal(a.downloads[0].name, '공유 스타일.moment-template.json');
  assert.equal(a.downloads[0].blob.type, 'application/json');
  await a.api.import(a.downloads[0].blob);
  assert.equal(a.api.custom.length, 2);
  assert.notEqual(a.api.custom[1].id, item.id);
  assert.deepEqual(a.api.custom[1], {...item, id: a.api.custom[1].id, category: '내 템플릿'});
  assert.deepEqual(a.api.favorites, ['clean']);
  assert.deepEqual(a.project, original);
  assert.deepEqual(a.writes, ['moment-favorites-v1', 'moment-templates-v1']);
});

test('template import rejects encoding, version, actual byte budget and ID collisions without writes', async () => {
  const item = saveCustomTemplate('스타일', createDemoProject());
  const a = workspace([item], { makeId: () => item.id });
  const inputs = [new Blob([new Uint8Array([0xff])]), new Blob(['{']),
    new Blob([JSON.stringify({format:'moment-template',formatVersion:99,template:item})]),
    {size:1,arrayBuffer:async()=>new ArrayBuffer(256*1024+1)},
    {size:256*1024+1,arrayBuffer:()=>{throw Error('must not read')}}, templateFile(item)];
  for (const file of inputs) await a.api.import(file);
  a.render();
  assert.equal(a.events.length, inputs.length);
  assert.deepEqual(a.api.custom, [item]);
  assert.deepEqual(a.writes, []);
});

test('latest template selection wins while completed local saves remain in the merged library', async () => {
  const item = saveCustomTemplate('가져온 스타일', createDemoProject()), a = workspace();
  const first = pendingFile(), second = pendingFile();
  const p1 = a.api.import(first), p2 = a.api.import(second);
  a.api.save(); a.query('#customTemplateName').value = '대기 중 저장'; a.query('#saveCustomTemplate').onclick();
  second.resolve(await templateFile(item).arrayBuffer()); await p2;
  first.resolve(await templateFile({...item,name:'오래된 요청'}).arrayBuffer()); await p1;
  assert.deepEqual(a.api.custom.map(t=>t.name), ['대기 중 저장','가져온 스타일']);
  assert.equal(a.writes.length, 2);
});

test('template import rechecks capacity after reading and rolls back a failed storage write', async () => {
  const item = saveCustomTemplate('스타일', createDemoProject());
  const a = workspace(Array.from({length:19}, (_,i)=>({...item,id:'custom-'+i})));
  const file = pendingFile(), pending = a.api.import(file);
  a.api.save(); a.query('#customTemplateName').value='마지막 자리'; a.query('#saveCustomTemplate').onclick();
  file.resolve(await templateFile(item).arrayBuffer()); await pending;
  assert.equal(a.api.custom.length,20); assert.equal(a.writes.length,1);
  assert.match(a.events.at(-1),/20개/);
  const b = workspace(); b.failKey='moment-templates-v1';
  await b.api.import(templateFile(item)); b.render();
  assert.deepEqual(b.api.custom,[]); assert.deepEqual(JSON.parse(b.stored.get('moment-templates-v1')),[]);
  b.failKey=''; await b.api.import(templateFile(item)); assert.equal(b.api.custom.length,1);
});

test('unreadable template recovery blocks import without reading or writing', async () => {
  const a = workspace([], {raw:'invalid JSON'});
  await a.api.import({arrayBuffer:()=>{throw Error('must not read')}});
  assert.match(a.events.at(-1),/차단/);
  assert.deepEqual(a.writes,[]);
});

test('template export refuses missing IDs and oversized UTF-8 output without partial downloads', () => {
  const item = saveCustomTemplate('큰 스타일', createDemoProject());
  item.flow = Array.from({length:1000},()=> '가'.repeat(100));
  const a = workspace([item]);
  a.api.export('missing');
  a.api.export(item.id);
  assert.deepEqual(a.downloads,[]);
  assert.equal(a.events.length,2);
  assert.match(a.events.at(-1),/256 KiB/);
  assert.deepEqual(a.writes,[]);
});
