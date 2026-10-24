import { message as msg } from './i18n.mjs';
import {createDemoProject, validateProject} from './core/project.mjs';
import {assertJson, validate, object, string, array, boolean, choice, fail} from './core/validation.mjs';
import {newCard} from './effects.mjs';
import {TEMPLATES, VISUAL_KEYS, visualPreset, applyTemplate} from './template-catalog.mjs';

const templateSchema={...object({
  id:string(200),custom:choice(true),relativeTiming:boolean,name:string(40),category:string(200),
  accent:string(9),tag:string(200),title:array(string(200),2,2),description:string(2000),flow:array(string(200)),
  settings:object(Object.fromEntries(VISUAL_KEYS.map(key=>[key,{}])),VISUAL_KEYS),cards:array({type:'object'},12),
},['id','custom','name','category','accent','tag','title','description','flow','settings']),additionalProperties:true};

export function validateTemplateLibrary(templates,favorites){
  assertJson({templates,favorites});
  validate(array(templateSchema,20),templates);validate(array(string(200)),favorites);
  const ids=new Set(TEMPLATES.map(template=>template.id));
  for(const template of templates){
    if(!template.id.trim()||!template.name.trim()||ids.has(template.id))fail(msg('errors.templateIdentity'));
    ids.add(template.id);
    const project=createDemoProject();
    applyTemplate(project,template,true);validateProject(project);
  }
}

export function readTemplateLibrary(templatesRaw,favoritesRaw){
  const templates=JSON.parse(templatesRaw??'[]'),favorites=JSON.parse(favoritesRaw??'[]');
  validateTemplateLibrary(templates,favorites);
  return {templates,favorites};
}


export const MAX_TEMPLATE_FILE_BYTES = 256 * 1024;
const templateDocumentSchema = object({
  format: choice('moment-template'), formatVersion: choice(1),
  template: {...templateSchema, additionalProperties: false},
}, ['format', 'formatVersion', 'template']);

// Portable files are a deliberately closed format. Do not carry unrelated hidden
// project/media fields through permissive legacy browser-storage objects.
function knownFields(value, example, path) {
  if (Array.isArray(value)) {
    if (Array.isArray(example) && example.length)
      value.forEach((item, i) => knownFields(item, example[0], `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!example || !Object.hasOwn(example, key)) fail(msg('errors.templateField'), `${path}.${key}`);
      knownFields(child, example[key], `${path}.${key}`);
    }
  }
}

function validatePortableTemplate(template) {
  validateTemplateLibrary([template], []);
  knownFields(template.settings, visualPreset(createDemoProject()), 'template.settings');
  if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(template.accent)) fail(msg('errors.templateColor'), 'template.accent');
  const project = createDemoProject();
  applyTemplate(project, template, true);
  for (const [i, card] of (template.cards || []).entries()) {
    knownFields(card, newCard(1), `template.cards[${i}]`);
    // Legacy defaults may fill omitted fields, but must not conceal malformed
    // supplied fields such as a stroke that migration would otherwise replace.
    project.overlays[i] = {...project.overlays[i], ...card};
  }
  validateProject(project);
}

export function createTemplateDocument(template) {
  const document = {format: 'moment-template', formatVersion: 1, template: structuredClone(template)};
  assertJson(document);
  validate(templateDocumentSchema, document, 'document');
  validatePortableTemplate(document.template);
  if (new TextEncoder().encode(JSON.stringify(document, null, 2)).byteLength > MAX_TEMPLATE_FILE_BYTES)
    fail(msg('errors.templateBytes'));
  return document;
}

export function readTemplateDocument(document) {
  assertJson(document);
  validate(templateDocumentSchema, document, 'document');
  // Validate and detach the source; importing into a library assigns a new ID.
  return createTemplateDocument(document.template).template;
}
