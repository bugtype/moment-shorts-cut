import {formatError, setLocale, initLocale} from '../dist/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateWorkspace } from '../dist/template-workspace.mjs';
import { createDemoProject } from '../dist/core/project.mjs';
import { newCard } from '../dist/effects.mjs';
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
    openModal: (title, body, foot) => { result.events.push(title); result.dialog = { title, body, foot }; },
    thumbnail() {}, preview: item => result.events.push(item.id),
    refresh: () => controller.render({}),
    navigate: panel => { result.events.push(panel); controller.render({}); },
    toast: message => result.events.push(formatError(message)),
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


test('rename preserves identity, favorites and project at full capacity and updates export name', () => {
  const item=saveCustomTemplate('<기존 "이름">',createDemoProject());
  const a=workspace(Array.from({length:20},(_,i)=>({...item,id:`custom-${i}`})));
  a.api.favorite('custom-0'); const before=structuredClone(a.api.custom), project=structuredClone(a.project);
  a.api.rename('custom-0'); assert.match(a.dialog.body,/&lt;기존 &quot;이름&quot;&gt;/);
  a.query('#renameTemplateName').value='  새 이름 🎬  '; a.query('#confirmRenameTemplate').onclick();
  assert.deepEqual(a.api.custom,[{...before[0],name:'새 이름 🎬'},...before.slice(1)]);
  assert.deepEqual(a.project,project); assert.deepEqual(a.api.favorites,['custom-0']);
  assert.deepEqual(a.writes,['moment-favorites-v1','moment-templates-v1']);
  a.api.export('custom-0'); assert.equal(a.downloads[0].name,'새 이름 🎬.moment-template.json');
});

test('rename validates without truncation, no-ops unchanged names, cancels and retries write failure', () => {
  const item=saveCustomTemplate('기존',createDemoProject()),a=workspace([item]);
  a.api.rename(item.id);
  for(const name of ['   ','🎬'.repeat(21)]){a.query('#renameTemplateName').value=name;a.query('#confirmRenameTemplate').onclick();}
  assert.equal(a.writes.length,0); assert.equal(a.query('#renameTemplateName').focused,true);
  a.query('#renameTemplateName').value=' 기존 ';a.query('#confirmRenameTemplate').onclick();assert.equal(a.writes.length,0);
  a.api.rename(item.id);a.query('#cancelRenameTemplate').onclick();assert.equal(a.writes.length,0);
  a.api.rename(item.id);a.query('#renameTemplateName').value='변경';a.failKey='moment-templates-v1';
  const closes=a.events.filter(x=>x==='close').length;a.query('#confirmRenameTemplate').onclick();a.render();
  assert.deepEqual(a.api.custom,[item]);assert.equal(a.events.filter(x=>x==='close').length,closes);
  a.failKey='';a.query('#confirmRenameTemplate').onclick();assert.equal(a.api.custom[0].name,'변경');
});

test('rename resolves current library on confirmation and never resurrects a deleted item', async () => {
  const item=saveCustomTemplate('기존',createDemoProject()),a=workspace([item]);
  a.api.rename(item.id); const confirm=a.query('#confirmRenameTemplate').onclick;
  a.api.remove(item.id);a.query('#confirmRemoveTemplate').onclick();
  a.query('#renameTemplateName').value='복원 안됨';confirm();assert.deepEqual(a.api.custom,[]);assert.equal(a.writes.length,1);
  assert.match(a.events.at(-1),/찾을 수 없습니다/);
  const b=workspace([item]),file=pendingFile(),pending=b.api.import(file);
  b.api.rename(item.id);b.query('#renameTemplateName').value='대기 중 변경';b.query('#confirmRenameTemplate').onclick();
  file.resolve(await templateFile(item).arrayBuffer());await pending;
  assert.equal(b.api.custom[0].name,'대기 중 변경');assert.equal(b.api.custom.length,2);
  const blocked=workspace([],{raw:'invalid'});blocked.api.rename(item.id);assert.match(blocked.events.at(-1),/차단/);assert.equal(blocked.writes.length,0);
});

test('custom update captures confirmation-time composition while preserving identity and full library', async () => {
  const item = {...saveCustomTemplate('<Saved>', createDemoProject()), tag:'custom tag', description:'my description', flow:['my flow']};
  const a = workspace(Array.from({length:20},(_,i)=>({...item,id:`custom-${i}`})));
  a.api.favorite('custom-0');
  const before = structuredClone(a.api.custom), favorites = [...a.api.favorites];
  a.api.update('custom-0');
  assert.match(a.dialog.body,/&lt;Saved&gt;/);
  assert.match(a.dialog.body,/먼저 파일로 저장/);
  a.project.speed=2;
  a.project.captionAccent='#123456';
  a.project.design.title.lines=['New title','Second line'];
  a.project.design.title.start=2;
  a.project.design.title.end=null;
  a.project.design.credit.text='New credit';
  a.project.overlays=[{...newCard(6),id:'timed-card',text:'Captured card',start:1,end:5}];
  const project=structuredClone(a.project), captured=saveCustomTemplate(item.name,project);
  const confirm=a.query('#confirmUpdateTemplate').onclick;
  confirm(); confirm();
  assert.deepEqual(a.project,project);
  assert.equal(a.api.custom.length,20);
  assert.deepEqual(a.api.favorites,favorites);
  assert.deepEqual(a.api.custom.slice(1),before.slice(1));
  assert.deepEqual(a.api.custom[0],{...before[0],settings:captured.settings,cards:captured.cards,title:captured.title,accent:captured.accent,relativeTiming:true});
  assert.equal(a.api.custom[0].settings.design.title.start,1/3);
  assert.equal(a.api.custom[0].settings.design.title.end,null);
  assert.equal(a.api.custom[0].cards[0].start,1/6);
  assert.equal(a.api.custom[0].cards[0].end,5/6);
  assert.notEqual(a.api.custom[0],before[0]);
  assert.equal(a.writes.filter(key=>key==='moment-templates-v1').length,1);
  a.api.export('custom-0');
  assert.deepEqual(JSON.parse(await a.downloads[0].blob.text()).template,a.api.custom[0]);
});

test('custom update cancel, replaced dialogs and missing targets never overwrite', () => {
  const item=saveCustomTemplate('Saved',createDemoProject()), a=workspace([item]);
  a.api.update(item.id); const canceled=a.query('#confirmUpdateTemplate').onclick;
  a.query('#cancelUpdateTemplate').onclick(); canceled();
  a.api.update(item.id); const stale=a.query('#confirmUpdateTemplate').onclick;
  a.api.rename(item.id); stale();
  assert.deepEqual(a.writes,[]);
  a.api.remove(item.id); a.query('#confirmRemoveTemplate').onclick();
  a.api.update(item.id);
  assert.match(a.events.at(-1),/찾을 수 없습니다/);
  assert.deepEqual(a.api.custom,[]);
  const blocked=workspace([],{raw:'broken'});
  blocked.api.update(item.id);
  assert.deepEqual(blocked.writes,[]);
});

test('custom update rolls back failed writes and retries with the latest project', () => {
  const item=saveCustomTemplate('Saved',createDemoProject()), a=workspace([item]);
  a.api.update(item.id); const confirm=a.query('#confirmUpdateTemplate').onclick;
  a.failKey='moment-templates-v1'; a.project.captionAccent='#123456';
  confirm();
  assert.deepEqual(a.api.custom,[item]);
  assert.deepEqual(JSON.parse(a.stored.get('moment-templates-v1')),[item]);
  assert.ok(!a.events.includes('close'));
  a.failKey=''; a.project.captionAccent='#654321'; confirm();
  assert.equal(a.api.custom[0].accent,'#654321');
  assert.equal(a.events.filter(value=>value==='close').length,1);
});

test('pending template import merges the newly updated library without reverting its contents', async () => {
  const {createTemplateDocument}=await import('../dist/template-library.mjs');
  const item=saveCustomTemplate('Saved',createDemoProject()), a=workspace([item],{makeId:()=> 'custom-imported'});
  let resolve;
  const pending=a.api.import({size:10,arrayBuffer:()=>new Promise(done=>{resolve=done;})});
  a.api.update(item.id); a.project.captionAccent='#987654'; a.query('#confirmUpdateTemplate').onclick();
  resolve(new TextEncoder().encode(JSON.stringify(createTemplateDocument(item))).buffer);
  await pending;
  assert.equal(a.api.custom.length,2);
  assert.equal(a.api.custom[0].accent,'#987654');
  assert.equal(a.api.custom[1].id,'custom-imported');
});


test('custom update rejects unexportable saved metadata and invalid captured settings before writing', () => {
  const item=saveCustomTemplate('Large',createDemoProject());
  item.flow=Array.from({length:1000},()=> '가'.repeat(100));
  const a=workspace([item]);
  a.api.update(item.id); a.query('#confirmUpdateTemplate').onclick();
  assert.match(a.events.at(-1),/256 KiB/);
  assert.deepEqual(a.writes,[]);
  assert.deepEqual(a.api.custom,[item]);
  const valid=saveCustomTemplate('Valid',createDemoProject()), b=workspace([valid]);
  b.api.update(valid.id); b.project.captionSize=-1;
  b.query('#confirmUpdateTemplate').onclick();
  assert.deepEqual(b.writes,[]);
  assert.deepEqual(b.api.custom,[valid]);
  assert.ok(!b.events.includes('close'));
});

test('duplicate branches stored template exactly, not active project; independent nested fields and one write', () => {
  const sourceProject=createDemoProject();sourceProject.overlays=[newCard(12)];
  const source=saveCustomTemplate('Original',sourceProject);source.extraLegacy={note:'retained'};source.category='Custom collection';
  const a=workspace([source],{makeId:()=> 'custom-copy'});a.project.design.title.lines=['Different','Project'];
  a.api.favorite(source.id);a.writes.length=0;
  const before=structuredClone(a.api.custom[0]), project=structuredClone(a.project), favorites=[...a.api.favorites];
  a.api.duplicate(source.id);a.query('#duplicateTemplateName').value='Variant';
  const confirm=a.query('#confirmDuplicateTemplate').onclick;confirm();confirm();
  assert.equal(a.api.custom.length,2);const copy=a.api.custom[1];
  assert.deepEqual(copy,{...before,id:'custom-copy',name:'Variant'});
  assert.notEqual(copy.settings,a.api.custom[0].settings);assert.notEqual(copy.cards[0],a.api.custom[0].cards[0]);
  assert.deepEqual(a.api.custom[0],before);assert.deepEqual(a.project,project);assert.deepEqual(a.api.favorites,favorites);
  assert.deepEqual(a.writes,['moment-templates-v1']);
  assert.equal(copy.category,'Custom collection');assert.equal(a.api.ui.category,'전체');assert.equal(a.api.ui.query,'');
});

test('duplicate validates names, IME, ID collisions and corrupt library without writes', () => {
  const source=saveCustomTemplate('Baseline',createDemoProject());
  const a=workspace([source],{makeId:()=>source.id});a.api.duplicate(source.id);
  const confirm=a.query('#confirmDuplicateTemplate').onclick,input=a.query('#duplicateTemplateName');
  for(const name of ['', ' '.repeat(2),'x'.repeat(41)]){input.value=name;confirm();}
  input.value='Valid';input.oncompositionstart();confirm();input.oncompositionend();confirm({isComposing:true});confirm({keyCode:229});
  assert.deepEqual(a.writes,[]);confirm();assert.deepEqual(a.writes,[]);assert.equal(a.api.custom.length,1);
  const corrupt=workspace([],{raw:'{invalid'});corrupt.api.duplicate(source.id);assert.deepEqual(corrupt.writes,[]);assert.equal(corrupt.dialog,undefined);
});

test('duplicate storage failure rolls back, supports retry and never changes favorites',()=>{
  const source=saveCustomTemplate('Baseline',createDemoProject()),a=workspace([source],{makeId:()=> 'custom-retry'});
  const original=a.stored.get('moment-templates-v1');a.api.duplicate(source.id);a.query('#duplicateTemplateName').value='Retry';
  a.failKey='moment-templates-v1';a.query('#confirmDuplicateTemplate').onclick();
  assert.equal(a.stored.get('moment-templates-v1'),original);a.render();assert.equal(a.api.custom.length,1);
  a.failKey='';a.query('#confirmDuplicateTemplate').onclick();assert.equal(a.api.custom.length,2);assert.deepEqual(a.api.favorites,[]);
});

test('duplicate rejects stale source, canceled or replaced dialog, and confirm-time capacity',()=>{
  const source=saveCustomTemplate('Baseline',createDemoProject());
  for(const mutation of ['rename','update','remove']){
    const a=workspace([source]);a.api.duplicate(source.id);a.query('#duplicateTemplateName').value='Copy';
    const confirm=a.query('#confirmDuplicateTemplate').onclick;
    if(mutation==='rename'){a.api.custom[0].name='Changed';}
    if(mutation==='update'){a.api.custom[0].settings.zoom=1.2;}
    if(mutation==='remove'){a.api.custom.splice(0,1);}
    confirm();assert.deepEqual(a.writes,[]);
  }
  const a=workspace([source]);a.api.duplicate(source.id);a.query('#duplicateTemplateName').value='Copy';
  const stale=a.query('#confirmDuplicateTemplate').onclick;a.query('#cancelDuplicateTemplate').onclick();stale();
  a.api.duplicate(source.id);const replaced=a.query('#confirmDuplicateTemplate').onclick;a.api.rename(source.id);replaced();assert.deepEqual(a.writes,[]);
  const full=workspace(Array.from({length:20},(_,i)=>({...source,id:`custom-${i}`})));full.api.duplicate('custom-0');assert.equal(full.dialog,undefined);
  const race=workspace([source]);race.api.duplicate(source.id);race.query('#duplicateTemplateName').value='Copy';
  for(let i=1;i<20;i++)race.api.custom.push({...source,id:`custom-${i}`});race.query('#confirmDuplicateTemplate').onclick();assert.deepEqual(race.writes,[]);
});

test('duplicate preserves unrelated library changes and bounds Unicode default names',()=>{
  const source=saveCustomTemplate('😀'.repeat(20),createDemoProject()),a=workspace([source],{makeId:()=> 'custom-copy'});
  a.api.duplicate(source.id);const match=a.dialog.body.match(/value="([^"]*)"/),value=match[1];
  assert.ok(value.length<=40);assert.ok(!/[\uD800-\uDBFF]$/.test(value.replace(/ 사본$/,'')));
  a.api.custom.push({...source,id:'custom-unrelated',name:'Unrelated'});
  a.query('#duplicateTemplateName').value=source.name;a.query('#confirmDuplicateTemplate').onclick();
  assert.equal(a.api.custom.length,3);assert.equal(a.api.custom[1].id,'custom-unrelated');assert.equal(a.api.custom[2].name,source.name);
});


test('duplicate dialogs use three locales and retain authored names',()=>{
  const source=saveCustomTemplate('原文 😀',createDemoProject());
  try { for(const [locale,label,suffix] of [['ko','템플릿 복제',' 사본'],['en','Duplicate template',' copy'],['zh-CN','创建模板副本',' 副本']]){
    setLocale(locale);const a=workspace([source]);a.api.duplicate(source.id);
    assert.equal(formatError(a.dialog.title),label);assert.ok(a.dialog.body.includes(source.name+suffix));
    a.query('#duplicateTemplateName').value=source.name+suffix;a.query('#confirmDuplicateTemplate').onclick();
    assert.equal(a.api.custom[0].name,source.name);assert.equal(a.api.custom[1].name,source.name+suffix);
  }}finally{initLocale();}
});
