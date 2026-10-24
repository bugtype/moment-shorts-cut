import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProject } from '../dist/core/project.mjs';
import { saveCustomTemplate } from '../dist/template-catalog.mjs';
import { createTemplateDocument, MAX_TEMPLATE_FILE_BYTES } from '../dist/template-library.mjs';
import {
  createTemplateCollectionDocument,
  readTemplateCollectionDocument,
  MAX_TEMPLATE_COLLECTION_BYTES,
} from '../dist/template-collection.mjs';

function template(index = 0) {
  const saved = saveCustomTemplate(`구성 ${index}`, createDemoProject());
  saved.id = `custom-collection-${index}`;
  return saved;
}

const bytes = value => new TextEncoder().encode(JSON.stringify(value, null, 2)).byteLength;

test('empty and twenty-template collections round trip in authored order with detached values', () => {
  assert.deepEqual(readTemplateCollectionDocument(createTemplateCollectionDocument([])), []);
  const templates = Array.from({ length: 20 }, (_, index) => template(index));
  templates[0].title = ['한글 <literal>\r\n text', '保留'];
  const before = structuredClone(templates);
  const document = createTemplateCollectionDocument(templates);
  assert.equal(document.format, 'moment-template-collection');
  assert.equal(document.formatVersion, 1);
  assert.deepEqual(readTemplateCollectionDocument(document), before);
  assert.deepEqual(templates, before);
  document.templates[0].template.title[0] = 'changed';
  assert.deepEqual(templates, before);
  const result = readTemplateCollectionDocument(document);
  result[1].settings.design.title.lines[0] = 'detached';
  assert.notEqual(document.templates[1].template.settings.design.title.lines[0], 'detached');
});

test('closed wrapper, count, identities and all nested portable fields are validated atomically', () => {
  const valid = createTemplateCollectionDocument([template()]);
  const invalid = [
    null, [], {},
    { ...valid, format: 'moment-template' },
    { ...valid, formatVersion: 2 },
    { ...valid, favorites: [] },
    { ...valid, templates: null },
    { ...valid, templates: Array(1) },
    { ...valid, templates: Array(21).fill(valid.templates[0]) },
    { ...valid, templates: [valid.templates[0], valid.templates[0]] },
  ];
  for (const document of invalid) assert.throws(() => readTemplateCollectionDocument(document));
  assert.throws(() => createTemplateCollectionDocument([template(), template()]));
  assert.throws(() => createTemplateCollectionDocument(Array.from({ length: 21 }, (_, i) => template(i))));
  for (const change of [
    item => { item.mediaPath = '/private/video.mp4'; },
    item => { item.settings.mediaPath = '/private/video.mp4'; },
    item => { item.settings.design.title.size = NaN; },
    item => { item.custom = false; },
    item => { item.id = 'reference'; },
  ]) {
    const document = createTemplateCollectionDocument([template(0), template(1)]);
    change(document.templates[1].template);
    const before = structuredClone(document);
    assert.throws(() => readTemplateCollectionDocument(document));
    assert.deepEqual(document, before);
  }
});

test('hidden properties, custom prototypes, accessors and non-JSON values cannot disappear during cloning', () => {
  for (const change of [
    value => { value[Symbol('hidden')] = true; },
    value => { Object.defineProperty(value, 'secret', { value: true }); },
    value => { Object.setPrototypeOf(value, { inherited: true }); },
    value => { value.name = 1n; },
    value => { value.settings.loop = value; },
  ]) {
    const saved = template();
    change(saved);
    assert.throws(() => createTemplateCollectionDocument([saved]));
  }
  let accessed = false;
  const saved = template();
  Object.defineProperty(saved, 'secret', { enumerable: true, get() { accessed = true; return 'secret'; } });
  assert.throws(() => createTemplateCollectionDocument([saved]));
  assert.equal(accessed, false);
  const customArray = [];
  Object.setPrototypeOf(customArray, Object.create(Array.prototype));
  assert.throws(() => createTemplateCollectionDocument(customArray));
  const document = createTemplateCollectionDocument([]);
  document.templates.extra = 'hidden array data';
  assert.throws(() => readTemplateCollectionDocument(document));
  const wrapper = createTemplateCollectionDocument([]);
  Object.defineProperty(wrapper, 'secret', { value: 'hidden' });
  assert.throws(() => readTemplateCollectionDocument(wrapper));
});

test('per-template UTF-8 bounds remain enforced while collection node budgets are independent', () => {
  const large = template();
  large.flow = Array(10000).fill('한글');
  assert.ok(bytes(createTemplateDocument(large)) < MAX_TEMPLATE_FILE_BYTES);
  const templates = Array.from({ length: 20 }, (_, index) => ({ ...large, id: `custom-large-${index}` }));
  const document = createTemplateCollectionDocument(templates);
  assert.equal(readTemplateCollectionDocument(document).length, 20);
  assert.ok(bytes(document) < MAX_TEMPLATE_COLLECTION_BYTES);
  assert.equal(MAX_TEMPLATE_COLLECTION_BYTES, 6 * 1024 * 1024);
  large.flow = Array(10000).fill('한글한글한글한글');
  assert.ok(bytes({ format: 'moment-template', formatVersion: 1, template: large }) > MAX_TEMPLATE_FILE_BYTES);
  assert.throws(() => createTemplateCollectionDocument([large]));
});
