import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTemplateGallery } from '../dist/template-gallery.mjs';
import { saveCustomTemplate } from '../dist/template-catalog.mjs';
import { createDemoProject } from '../dist/core/project.mjs';

test('gallery imports selected files, resets the picker and exports only custom cards', async () => {
  const item = saveCustomTemplate('<내 스타일>', createDemoProject());
  const nodes = new Map(), events = [];
  const query = key => {
    if (!nodes.has(key)) {
      const attributes=new Map();
      nodes.set(key, {innerHTML:'', value:'', click:()=>events.push('picker'),
        setAttribute:(name,value)=>attributes.set(name,String(value)),
        getAttribute:name=>attributes.get(name)??null,
        removeAttribute:name=>attributes.delete(name)});
    }
    return nodes.get(key);
  };
  const duplicateButton = {dataset:{duplicateTemplate:item.id}};
  const updateButton = {dataset:{updateTemplate:item.id}};
  const renameButton = {dataset:{renameTemplate:item.id}};
  const exportButton = {dataset:{exportTemplate:item.id}};
  const root = {
    innerHTML: '', querySelector: query,
    querySelectorAll: selector => selector === '[data-duplicate-template]' ? [duplicateButton] : selector === '[data-update-template]' ? [updateButton] : selector === '[data-export-template]' ? [exportButton] : selector === '[data-rename-template]' ? [renameButton] : [],
  };
  mountTemplateGallery(root, {
    ui:{query:'',category:'전체'},custom:[item],favorites:[],
    duplicate:id=>events.push(['duplicate',id]), update:id=>events.push(['update',id]), save:()=>events.push('save'), import:async file=>events.push(file), export:id=>events.push(id), rename:id=>events.push(['rename',id]),
  });
  assert.match(root.innerHTML,/id="importMyTemplate"><span data-i18n="templates.import"[^>]*>불러오기<\/span>/);
  assert.match(root.innerHTML,/id="templateFileInput" type="file"[^>]*hidden/);
  const cards = query('#templateGrid').innerHTML;
  assert.equal([...cards.matchAll(/data-export-template=/g)].length,1);
  assert.match(cards,/&lt;내 스타일&gt; 템플릿 파일 저장/);
  assert.match(cards,/role="group" aria-label="&lt;내 스타일&gt; 템플릿 관리"/);
  assert.equal([...cards.matchAll(/data-update-template=/g)].length,1);
  assert.match(cards,/&lt;내 스타일&gt; 현재 구성으로 업데이트/);
  assert.equal([...cards.matchAll(/data-duplicate-template=/g)].length,1);
  duplicateButton.onclick();assert.deepEqual(events.pop(),['duplicate',item.id]);
  updateButton.onclick();
  renameButton.onclick();
  exportButton.onclick();
  query('#importMyTemplate').onclick();
  const file = new Blob(['{}']), picker=query('#templateFileInput');
  picker.files=[file]; picker.value='chosen.json'; await picker.onchange();
  assert.equal(picker.value,'');
  picker.files=[]; await picker.onchange();
  assert.deepEqual(events,[['update',item.id],['rename',item.id],item.id,'picker',file]);
});
