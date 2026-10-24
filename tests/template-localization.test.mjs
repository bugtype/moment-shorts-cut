import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from '../dist/i18n/catalogs/templates.mjs';
import { TEMPLATES, templateDisplay, templateSearchText, templateCategoryKey, applyTemplate } from '../dist/template-catalog.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

test('template catalogs have matching keys and interpolation parameters', () => {
  const keys=Object.keys(messages.ko).sort();
  for(const locale of ['en','zh-CN']) {
    assert.deepEqual(Object.keys(messages[locale]).sort(),keys);
    for(const key of keys) {
      const placeholders=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
      assert.deepEqual(placeholders(messages[locale][key]),placeholders(messages.ko[key]),key);
      assert.ok(messages[locale][key].trim(),key);
    }
  }
});

test('built-in template presentation localizes without changing authored examples', () => {
  const original=structuredClone(TEMPLATES);
  for(const template of TEMPLATES) {
    for(const locale of ['ko','en','zh-CN']) {
      const view=templateDisplay(template,locale);
      assert.equal(view.name,messages[locale]['templates.builtin.'+template.id+'.name']);
      assert.equal(view.category,messages[locale][templateCategoryKey(template.category)]);
      assert.equal(view.flow.length,template.flow.length);
      assert.ok(templateSearchText(template).includes(view.name));
    }
  }
  assert.deepEqual(TEMPLATES,original);
  const project=createDemoProject(), template=TEMPLATES.find(item=>item.id==='explainer');
  templateDisplay(template,'en'); templateDisplay(template,'zh-CN');
  applyTemplate(project,template,true);
  assert.deepEqual(project.design.title.lines,template.title);
  assert.equal(project.design.credit.text,'나의 채널');
  assert.match(project.overlays[0].text,/왜 같은 장면/);
});

test('custom names, description and authored flow remain literal; legacy category is display-only', () => {
  const template={custom:true,id:'custom-test',name:'<내 이름>',category:'내 템플릿',tag:'原稿',
    description:'User description <script>',flow:['내 문구','My words']};
  const original=structuredClone(template);
  for(const locale of ['ko','en','zh-CN']) {
    const view=templateDisplay(template,locale);
    assert.equal(view.name,template.name); assert.equal(view.description,template.description);
    assert.deepEqual(view.flow,template.flow);
    assert.equal(view.category,messages[locale]['templates.category.custom']);
    view.flow[0]='changed'; assert.equal(template.flow[0],'내 문구');
  }
  assert.deepEqual(template,original);
  assert.equal(templateDisplay({...template,category:'My own category'},'zh-CN').category,'My own category');
});

test('search aliases cover English and Simplified Chinese without rewriting stable template IDs', () => {
  const recipe=TEMPLATES.find(item=>item.id==='recipe'), search=templateSearchText(recipe).toLowerCase();
  assert.match(search,/cooking/); assert.match(search,/烹饪/); assert.match(search,/레시피/);
  assert.equal(recipe.id,'recipe');
});
