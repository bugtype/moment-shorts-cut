import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,getLocale} from '../dist/i18n.mjs';

async function fixture(locale='ko') {
 const f=await createAppFixture(),root=f.element('#panelContent'),baseQuery=f.doc.querySelector;
 initLocale({languages:[locale],storage:null,document:f.doc});
 assert.equal(getLocale(),locale);assert.equal(f.doc.documentElement.lang,locale);
 let generation=0,controls=[],markup='';
 // Synthetic emitted markup/handler ownership, not native DOM event ordering.
 const decode=s=>s.replace(/&(amp|lt|gt|quot|#39);/g,(_,x)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[x]));
 const matches=(input,selector)=>selector==='#'+input.id || ['design','card'].some(key=>selector===`[data-${key}="${input.dataset[key]}"]`);
 const query=selector=>controls.find(input=>matches(input,selector))||baseQuery(selector);
 const all=selector=>controls.filter(input=>selector==='[data-design]'?input.dataset.design:selector==='[data-card]'?input.dataset.card:false);
 function parse(html) {
  for(const input of controls)input.isConnected=false;
  controls=[];generation++;
  for(const match of html.matchAll(/<input\b([^>]*)>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
   const tag=match[1]===undefined?'textarea':'input',attrs=match[1]??match[2],body=match[3];
   const design=/data-design="([^"]+)"/.exec(attrs)?.[1],card=/data-card="([^"]+)"/.exec(attrs)?.[1],id=/\bid="([^"]+)"/.exec(attrs)?.[1];
   if(!design&&!card&&!['panelTrimStart','panelTrimEnd'].includes(id))continue;
   const input=f.element(`audit-${generation}-${design||card||id}`);input.id=id||'';
   input.type=tag==='textarea'?'textarea':/type="([^"]+)"/.exec(attrs)?.[1]||'text';
   input.dataset=design?{design}:card?{card}:{};input.isConnected=true;
   input.reportValidity=()=>false;
   input.value=decode(tag==='textarea'?body||'':/value="([^"]*)"/.exec(attrs)?.[1]||'');
   if(input.type==='textarea')input.value=input.value.replace(/\r\n?/g,'\n').replace(/^\n/,'');
   controls.push(input);
  }
 }
 root.querySelector=query;root.querySelectorAll=all;f.doc.querySelector=query;
 Object.defineProperty(root,'innerHTML',{get:()=>markup,set:value=>{markup=value;parse(value);}});
 const target=f.element('#effectControls');target.querySelector=query;target.querySelectorAll=all;
 let effects='';Object.defineProperty(target,'innerHTML',{get:()=>effects,set:value=>{effects=value;parse(value);}});
 vm.runInContext("state.overlays=[newCard(12)];selectedCard=state.overlays[0].id;history=[];future=[];renderInspector();",f.context);
 return {...f,root,query,all,open:(panel,layer='title')=>vm.runInContext(`textLayer=${JSON.stringify(layer)};effectTab='cards';switchPanel(${JSON.stringify(panel)})`,f.context)};
}

const state=f=>f.evaluate('({state,history,future,current,playRequest})');
const control=(f,kind,timing=false)=>f.query(kind==='card'?`[data-card="${timing?'start':'text'}"]`:`[data-design="design.${kind}.${timing?'start':kind==='title'?'lines.0':'text'}"]`);
const open=(f,kind)=>f.open(kind==='card'?'effects':'text',kind==='card'?'title':kind);

for(const locale of ['ko','en','zh-CN'])test(`late design/card callbacks cannot overwrite an explicit imported project (${locale})`,async()=>{
 try {for(const kind of ['title','credit','card'])for(const timing of [false,true]) {
  const f=await fixture(locale);open(f,kind);const old=control(f,kind,timing);
  if(!timing)old.oncompositionstart();old.value=timing?'1.25':'Stale synthetic draft';
  if(!timing)old.oninput({isComposing:true});
  const document=f.evaluate('createProjectDocument(state)');
  const layer=kind==='card'?document.project.overlays[0]:document.project.design[kind];
  if(timing)layer.start=2;else if(kind==='title')layer.lines[0]='Imported title';else layer.text='Imported content';
  assert.equal((await f.context.window.moment.importProject(new Blob([JSON.stringify(document)]))).ok,true);
  assert.notEqual(control(f,kind,timing),old);assert.equal(old.isConnected,false);const before=state(f);
  // A retained queued callback runs after explicit replacement, not a new edit.
  await Promise.resolve();if(timing)old.onchange();else old.oncompositionend();
  old.onblur?.();assert.deepEqual(state(f),before);
 }}finally{initLocale();}
});

test('leaving or rebuilding a panel invalidates its old numeric and text handlers',async()=>{
 for(const kind of ['title','credit','card'])for(const timing of [false,true])for(const leave of [false,true]) {
  const f=await fixture();open(f,kind);const old=control(f,kind,timing);
  if(!timing)old.oncompositionstart();old.value=timing?'1.25':'Detached text';
  if(leave)f.open('media');else vm.runInContext('renderPanel()',f.context);
  const before=state(f);if(timing)old.onchange();else old.oncompositionend();assert.deepEqual(state(f),before);
 }
});

test('card identity and effective selection are not reduced to a reused ID',async()=>{
 for(const change of ['state.overlays[0]=structuredClone(state.overlays[0]);',
  'state.overlays.push(newCard(12));selectedCard=state.overlays[1].id;',
  'selectedCard=null;state.overlays.unshift(newCard(12));']) {
  const f=await fixture();open(f,'card');const old=control(f,'card',true);old.value='1.25';
  vm.runInContext(change,f.context);const before=state(f);old.onchange();assert.deepEqual(state(f),before);
 }
 const f=await fixture();open(f,'title');const old=control(f,'title',true);old.value='1.25';
 vm.runInContext("textLayer='credit';",f.context);const before=state(f);old.onchange();assert.deepEqual(state(f),before);
});

test('current text edits, final change, numeric changes and Undo retain their explicit behavior',async()=>{
 for(const kind of ['title','credit','card']) {
  const f=await fixture();open(f,kind);const input=control(f,kind);input.focus();
  input.value='First';input.oninput();input.value='Final';input.onchange();input.onblur();
  assert.equal(f.evaluate('history.length'),1);
  const timing=control(f,kind,true);timing.value='1.25';timing.onchange();assert.equal(f.evaluate('history.length'),2);
  vm.runInContext('undo()',f.context);const current=control(f,kind);assert.equal(current.value,'Final');
  current.value='After Undo';current.oninput();assert.equal(f.evaluate('history.length'),2);assert.equal(f.evaluate('future.length'),0);
 }
});

test('old blur/change events cannot split the replacement input history group',async()=>{
 for(const event of ['onblur','onchange']) {
  const f=await fixture();open(f,'title');const old=control(f,'title');
  vm.runInContext('renderPanel()',f.context);const current=control(f,'title');
  current.value='First';current.oninput();old[event]();current.value='Second';current.oninput();
  assert.equal(f.evaluate('history.length'),1,event);assert.equal(f.evaluate('state.design.title.lines[0]'),'Second');
 }
});

test('card duplicate, reorder and remove keep current controls usable and old handlers inert',async()=>{
 for(const action of ['duplicateSceneCard','sceneToFront','removeSceneCard']) {
  const f=await fixture();vm.runInContext('state.overlays.push(newCard(12));',f.context);open(f,'card');
  const old=control(f,'card');old.oncompositionstart();old.value='Stale card text';old.oncompositionend();
  // Finish a legitimate edit before the explicit action; only later callbacks are stale.
  f.query('#'+action).onclick();const before=state(f);old.value='Late old edit';old.oninput();assert.deepEqual(state(f),before);
  const current=control(f,'card');current.value='Current card edit';current.oninput();
  assert.equal(f.evaluate('state.overlays.find(c=>c.id===selectedCard).text'),'Current card edit');
 }
});
