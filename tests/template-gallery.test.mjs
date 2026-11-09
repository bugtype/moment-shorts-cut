import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTemplateGallery } from '../dist/template-gallery.mjs';
import { TEMPLATES, saveCustomTemplate } from '../dist/template-catalog.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { setLocale, initLocale, translateFor } from '../dist/i18n.mjs';

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
    duplicate:id=>events.push(['duplicate',id]), update:id=>events.push(['update',id]), save:()=>events.push('save'), exportCollection:()=>events.push('collection'), import:async file=>events.push(file), export:id=>events.push(id), rename:id=>events.push(['rename',id]),
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
  assert.match(root.innerHTML, /id="exportTemplateCollection" >.*내 템플릿 모음 내보내기/);
  query('#exportTemplateCollection').onclick({isComposing:true});
  query('#exportTemplateCollection').onclick();
  assert.equal(events.pop(), 'collection');
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

test('collection export is disabled when empty and ignores detached or composing controls', () => {
  const nodes = new Map();
  const query = id => {
    if (!nodes.has(id)) nodes.set(id, {setAttribute() {}, removeAttribute() {}});
    return nodes.get(id);
  };
  const root = {innerHTML:'',querySelector:query,querySelectorAll:()=>[]};
  let exports = 0;
  const api = {ui:{query:'',category:'전체'},custom:[],favorites:[],exportCollection(){exports++;}};
  mountTemplateGallery(root,api);
  assert.match(root.innerHTML,/id="exportTemplateCollection" disabled/);
  query('#exportTemplateCollection').onclick();
  assert.equal(exports,0);
  api.custom=[saveCustomTemplate('My style',createDemoProject())];
  mountTemplateGallery(root,api);
  const old = query('#exportTemplateCollection').onclick;
  old({keyCode:229});
  assert.equal(exports,0);
  mountTemplateGallery(root,api);
  old();
  assert.equal(exports,0);
  query('#exportTemplateCollection').onclick();
  assert.equal(exports,1);
});


test('one failed thumbnail does not disable other previews or custom template controls', () => {
  try { for (const locale of ['ko', 'en', 'zh-CN']) {
    setLocale(locale, {persist:false});
    const custom = saveCustomTemplate('Custom', createDemoProject()), items = [TEMPLATES[0], TEMPLATES[1], custom];
    const nodes = new Map(), events = [], attempts = [];
    const query = key => {
      if (!nodes.has(key)) {
        const attrs = new Map();
        nodes.set(key, {textContent:'', value:'',
          setAttribute:(name,value)=>attrs.set(name,String(value)),
          getAttribute:name=>attrs.get(name)??null, removeAttribute:name=>attrs.delete(name)});
      }
      return nodes.get(key);
    };
    const canvases = items.map(item => ({dataset:{templateCanvas:item.id},style:{removeProperty(name) {delete this[name];}}}));
    const previews = items.map(item => ({dataset:{previewTemplate:item.id}}));
    const controls = new Map(['update','duplicate','rename','export','remove'].map(action =>
      ['[data-' + action + '-template]', [{dataset:{[action + 'Template']:custom.id}}]]));
    const root = {innerHTML:'',querySelector:query,querySelectorAll:selector =>
      selector === '[data-template-canvas]' ? canvases : selector === '[data-preview-template]' ? previews : controls.get(selector) || []};
    let failing = true;
    const api = {ui:{query:'',category:'전체'},custom:[custom],favorites:[],
      thumbnail(canvas, item) { attempts.push(item.id); if (failing && item.id === items[0].id) throw Error('unavailable canvas'); },
      preview:item=>events.push(['preview',item.id])};
    for (const action of ['update','duplicate','rename','export','remove']) api[action] = id => events.push([action,id]);
    assert.doesNotThrow(() => mountTemplateGallery(root,api));
    assert.deepEqual(attempts, items.map(item=>item.id));
    const status = query('#templateThumbnailStatus');
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, translateFor(locale,'templates.thumbnailUnavailable'));
    assert.equal(canvases[0].style.visibility, 'hidden');
    assert.ok(canvases.slice(1).every(canvas => !canvas.style.visibility));
    for (const preview of previews) preview.onclick();
    for (const [selector, [control]] of controls) control.onclick();
    assert.deepEqual(events, [...items.map(item=>['preview',item.id]), ...['update','duplicate','rename','export','remove'].map(action=>[action,custom.id])]);
    failing = false;
    query('#templateSearch').oninput({target:{value:''}});
    assert.equal(status.hidden,true); assert.equal(status.textContent,'');
    assert.equal(status.getAttribute('data-i18n'),null);
    assert.ok(canvases.every(canvas=>!canvas.style.visibility));
  }} finally { initLocale(); }
});
