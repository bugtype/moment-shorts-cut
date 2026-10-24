import { message } from './i18n.mjs';
import { assertJson, fail } from './core/validation.mjs';
import { createTemplateDocument, readTemplateDocument } from './template-library.mjs';

export const MAX_TEMPLATE_COLLECTION_BYTES = 6 * 1024 * 1024;
const encoder = new TextEncoder();
const invalid = () => fail(message('templates.collectionInvalid'));

// Check container properties before cloning, which would discard hidden fields.
function container(value, array = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array) invalid();
  const prototype = Object.getPrototypeOf(value);
  const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  if (prototype !== null && (typeof constructor !== 'function' ||
      constructor.name !== (array ? 'Array' : 'Object'))) invalid();
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) invalid();
  }
}

function entries(templates) {
  container(templates, true);
  if (templates.length > 20) invalid();
  for (let index = 0; index < templates.length; index++) {
    if (!Object.hasOwn(templates, index)) invalid();
  }
}

function portableInput(value) {
  // Per-document budgets deliberately do not combine twenty valid documents
  // into the generic validator's single 100,000-node budget.
  let count = 0;
  const seen = new WeakSet();
  function visit(item, depth = 0) {
    if (++count > 100000 || depth > 30) invalid();
    if (!item || typeof item !== 'object') return;
    if (seen.has(item)) invalid();
    seen.add(item);
    container(item, Array.isArray(item));
    for (const child of Object.values(item)) visit(child, depth + 1);
    seen.delete(item);
  }
  visit(value);
  assertJson(value);
}

function checked(document) {
  const ids = new Set();
  for (const entry of document.templates) {
    if (ids.has(entry.template.id)) fail(message('templates.collectionDuplicates'));
    ids.add(entry.template.id);
  }
  if (encoder.encode(JSON.stringify(document, null, 2)).byteLength > MAX_TEMPLATE_COLLECTION_BYTES)
    fail(message('templates.collectionSize'));
  return document;
}

export function createTemplateCollectionDocument(templates) {
  entries(templates);
  const documents = templates.map(template => {
    portableInput(template);
    return createTemplateDocument(template);
  });
  return checked({ format: 'moment-template-collection', formatVersion: 1, templates: documents });
}

export function readTemplateCollectionDocument(document) {
  container(document);
  const keys = Object.keys(document);
  if (keys.length !== 3 || !['format', 'formatVersion', 'templates'].every(key => keys.includes(key)) ||
      document.format !== 'moment-template-collection' || document.formatVersion !== 1) invalid();
  entries(document.templates);
  const templates = document.templates.map(entry => {
    portableInput(entry);
    return readTemplateDocument(entry);
  });
  checked(document);
  return templates;
}
