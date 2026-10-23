import {createDemoProject, validateProject} from './core/project.mjs';
import {assertJson, validate, object, string, array, boolean, choice, fail} from './core/validation.mjs';
import {TEMPLATES, VISUAL_KEYS, applyTemplate} from './template-catalog.mjs';

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
    if(!template.id.trim()||!template.name.trim()||ids.has(template.id))fail('템플릿 이름과 고유 ID를 확인하세요.');
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
