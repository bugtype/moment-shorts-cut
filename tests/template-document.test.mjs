import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoProject,validateProject} from '../dist/core/project.mjs';
import {TEMPLATES,applyTemplate,saveCustomTemplate} from '../dist/template-catalog.mjs';
import {createTemplateDocument,readTemplateDocument,MAX_TEMPLATE_FILE_BYTES} from '../dist/template-library.mjs';

function saved(){const project=createDemoProject();applyTemplate(project,TEMPLATES.find(t=>t.id==='recipe'),true);project.design.credit.text='내 채널';return saveCustomTemplate('내 구성',project);}
test('single template document preserves authored styles/text/relative timing and detaches both directions',()=>{
 const template=saved(),before=structuredClone(template),document=createTemplateDocument(template);
 assert.equal(document.format,'moment-template');assert.equal(document.formatVersion,1);
 const restored=readTemplateDocument(JSON.parse(JSON.stringify(document)));
 assert.deepEqual(restored,template);assert.notEqual(document.template,template);assert.notEqual(restored,document.template);
 const short=createDemoProject(),long=createDemoProject();long.duration=24;long.clips=[{start:0,end:24}];
 applyTemplate(short,restored,true);applyTemplate(long,restored,true);validateProject(short);validateProject(long);
 assert.equal(long.overlays[1].start,short.overlays[1].start*2);assert.equal(long.overlays[1].end,short.overlays[1].end*2);
 assert.equal(long.design.credit.text,'내 채널');assert.deepEqual(template,before);
 restored.settings.design.title.lines[0]='changed';assert.deepEqual(document.template,template);
 assert.ok(Buffer.byteLength(JSON.stringify(document,null,2))<MAX_TEMPLATE_FILE_BYTES);
 assert.equal(Object.hasOwn(document.template.settings,'fileName'),false);
});
test('supported legacy optional fields round-trip without changing application behavior',()=>{
 const template=saved();delete template.relativeTiming;
 for(const card of template.cards)for(const key of ['presentation','backgroundOpacity','stroke','role','enabled','x'])delete card[key];
 const restored=readTemplateDocument(createTemplateDocument(template));assert.deepEqual(restored,template);
 const a=createDemoProject(),b=createDemoProject();applyTemplate(a,template,true);applyTemplate(b,restored,true);assert.deepEqual(a,b);
});
test('portable documents reject foreign wrappers, invalid version and unknown nested/media fields without mutation',()=>{
 const valid=createTemplateDocument(saved());
 for(const modify of [
  d=>{d.format='moment-project';},d=>{d.formatVersion=2;},d=>{d.extra='hidden';},d=>{d.template.media='secret';},
  d=>{d.template.settings.fileName='source.mp4';},d=>{d.template.settings.design.media='hidden';},
  d=>{d.template.cards[0].payload='hidden';},d=>{d.template.accent='#zzzzzz';},
  d=>{d.template.settings.captionColor='invalid';},d=>{d.template.cards[0].end=-1;},
  d=>{delete d.template.cards[0].presentation;d.template.cards[0].stroke=-1;},
  d=>{d.template.cards[0].id=d.template.cards[1].id;},d=>{d.template.name='';},d=>{d.template.custom=false;},
 ]){
  const document=structuredClone(valid);modify(document);const before=structuredClone(document);
  assert.throws(()=>readTemplateDocument(document));assert.deepEqual(document,before);
 }
 for(const invalid of [null,{},[],1])assert.throws(()=>readTemplateDocument(invalid));
});
test('portable template output enforces bounded encoded size, not only character count',()=>{
 const template=saved();template.flow=Array.from({length:700},()=> '가'.repeat(200));
 assert.throws(()=>createTemplateDocument(template),/256 KiB/);
 assert.equal(template.flow.length,700);
});
