import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from '../dist/i18n/catalogs/templates.mjs';
import { TEMPLATES, templateDisplay, templateSearchText, templateCategoryKey, applyTemplate, saveCustomTemplate } from '../dist/template-catalog.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { createAppFixture } from './fixtures/app.mjs';
import { setLocale } from '../dist/i18n.mjs';
import { createTemplateDocument } from '../dist/template-library.mjs';
import { createTemplateWorkspace } from '../dist/template-workspace.mjs';

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

test('real app modal renders template descriptors and escapes custom heading once', async () => {
  const f=await createAppFixture();
  try {
    f.evaluate('templatePreview.open(TEMPLATES[0]); true');
    const modal=f.element('#modal'), markup=modal.innerHTML;
    assert.match(markup, /<h2 id="modalTitle"><span data-i18n="templates.builtin.reference.name"/);
    assert.doesNotMatch(markup, /<h2 id="modalTitle">&lt;span/);
    // This synthetic DOM does not parse innerHTML: model its actual marked heading
    // leaf so locale updates exercise the shared in-place translation path.
    const heading=f.element('#modal h2 span');
    heading.setAttribute('data-i18n','templates.builtin.reference.name');
    heading.setAttribute('data-i18n-params','{}');
    heading.textContent=messages.ko['templates.builtin.reference.name'];
    setLocale('en',{persist:false});
    assert.equal(heading.textContent,messages.en['templates.builtin.reference.name']);
    setLocale('zh-CN',{persist:false});
    assert.equal(heading.textContent,messages['zh-CN']['templates.builtin.reference.name']);
    assert.equal(modal.innerHTML,markup,'Locale updates do not replace the modal tree');
    f.evaluate("templatePreview.open(saveCustomTemplate('<img src=x>&名字',createDemoProject())); true");
    assert.match(modal.innerHTML, /<h2 id="modalTitle">&lt;img src=x&gt;&amp;名字<\/h2>/);
    assert.doesNotMatch(modal.innerHTML, /<h2 id="modalTitle">&amp;lt;|<h2 id="modalTitle"><img/);
    // New custom heading is literal data, not a translation key.
    assert.doesNotMatch(modal.innerHTML.match(/<h2 id="modalTitle">(.*?)<\/h2>/s)[1],/data-i18n/);
  } finally { setLocale('ko',{persist:false}); }
});

test('template errors retain translation metadata through visible app toasts', async () => {
  const f=await createAppFixture();
  let actions;
  const workspace=createTemplateWorkspace({
    getProject:createDemoProject, query:()=>null, modal:{}, openModal:()=>{},
    thumbnail:()=>'', preview:()=>{}, refresh:()=>{}, navigate:()=>{}, download:()=>{},
    toast(value) { f.context.templateToast=value; f.evaluate('toast(templateToast); true'); },
  }, {readStorage:()=>null, writeStorage:()=>{}, mount(_target,api) { actions=api; }});
  try {
    workspace.render({});
    const single = createTemplateDocument(saveCustomTemplate('Single template', createDemoProject()));
    // The unified picker reads the format before applying the smaller single-file limit.
    await actions.import(new Blob([JSON.stringify(single), ' '.repeat(256 * 1024)]));
    const node=f.element('#toast');
    assert.equal(node.getAttribute('data-i18n'),'templates.importSize');
    setLocale('en',{persist:false});
    assert.equal(node.textContent,messages.en['templates.importSize']);
    setLocale('zh-CN',{persist:false});
    assert.equal(node.textContent,messages['zh-CN']['templates.importSize']);
    actions.rename('missing');
    assert.equal(node.getAttribute('data-i18n'),'templates.renameMissing');
    setLocale('en',{persist:false});
    assert.equal(node.textContent,messages.en['templates.renameMissing']);
  } finally { setLocale('ko',{persist:false}); }
});
