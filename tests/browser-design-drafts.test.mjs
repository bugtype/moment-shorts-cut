import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {initLocale,getLocale,t} from '../dist/i18n.mjs';

async function fixture(locale='ko',seed='') {
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
   input.reportValidity=()=>false;input.validity={badInput:false};
   if(input.type==='number')Object.defineProperty(input,'valueAsNumber',{get:()=>input.value.trim()===''?NaN:Number(input.value)});
   input.value=decode(tag==='textarea'?body||'':/value="([^"]*)"/.exec(attrs)?.[1]||'');
   if(input.type==='text')input.value=input.value.replace(/[\r\n]/g,'');
   if(input.type==='textarea')input.value=input.value.replace(/\r\n?/g,'\n').replace(/^\n/,'');
   if(input.type==='color')input.value=/^#[0-9a-f]{6}$/i.test(input.value)?input.value.toLowerCase():'#000000';
   controls.push(input);
  }
 }
 root.querySelector=query;root.querySelectorAll=all;f.doc.querySelector=query;
 Object.defineProperty(root,'innerHTML',{get:()=>markup,set:value=>{markup=value;parse(value);}});
 const target=f.element('#effectControls');target.querySelector=query;target.querySelectorAll=all;
 let effects='';Object.defineProperty(target,'innerHTML',{get:()=>effects,set:value=>{effects=value;parse(value);}});
 vm.runInContext("state.overlays=[newCard(12)];selectedCard=state.overlays[0].id;history=[];future=[];renderInspector();",f.context);
 vm.runInContext(seed+';globalThis.designSaves=0;scheduleSave=()=>designSaves++;',f.context);
 return {...f,root,query,all,open:(panel,layer='title')=>vm.runInContext(`textLayer=${JSON.stringify(layer)};effectTab='cards';switchPanel(${JSON.stringify(panel)})`,f.context)};
}


const state=f=>f.evaluate('({state,history,future,current,playRequest})');
const control=(f,kind,key='start')=>f.query(kind==='card'?`[data-card="${key}"]`:`[data-design="design.${kind}.${key}"]`);
const open=(f,kind)=>f.open(kind==='card'?'effects':'text',kind==='card'?'title':kind);
const edit=f=>f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}});
const textKey=kind=>kind==='title'?'lines.0':'text';

for(const locale of ['ko','en','zh-CN'])test(`design/card numeric drafts reject API commits without changing focus/state (${locale})`,async()=>{
 try {for(const kind of ['title','credit','card'])for(const [key,value] of [['start','1.23456789'],['end','2.5'],['start','']]) {
  const f=await fixture(locale);open(f,kind);const input=control(f,kind,key);input.value=value;input.focus();const before=state(f);
  const result=await edit(f);assert.equal(result.error?.code,'CONFLICT');assert.equal(result.error.message,t('errors.designDraftConflict'));
  assert.deepEqual(state(f),before);assert.equal(f.evaluate('designSaves'),0);assert.equal(control(f,kind,key),input);assert.equal(f.doc.activeElement,input);
 }}finally{initLocale();}
});

test('active text and numeric composition blocks even before its value changes',async()=>{
 for(const kind of ['title','credit','card'])for(const key of ['start',textKey(kind)])for(const changed of [false,true]) {
  const f=await fixture();open(f,kind);const input=control(f,kind,key),initial=input.value;
  input.oncompositionstart?.();if(changed)input.value=key==='start'?'1.25':'Draft 中文';
  if(key!=='start')input.oninput({isComposing:true});const before=state(f);
  assert.equal((await edit(f)).error?.code,'CONFLICT');assert.deepEqual(state(f),before);
  input.value=initial;input.oncompositionend?.();assert.equal((await edit(f)).ok,true);
 }
});

test('ordinary committed text and explicit timing change allow retry without scaling output seconds',async()=>{
 for(const kind of ['title','credit','card'])for(const speed of [.25,1,4]) {
  const f=await fixture('ko',`state.speed=${speed}`);open(f,kind);
  const input=control(f,kind,textKey(kind));input.value='Committed 中文';input.oninput();
  const start=control(f,kind);start.value='1.125';assert.equal((await edit(f)).error?.code,'CONFLICT');start.onchange();
  const before=state(f).state;assert.equal((await edit(f)).ok,true);
  vm.runInContext('undo()',f.context);assert.deepEqual(state(f).state,before);
  assert.equal(control(f,kind).value,'1.125');assert.equal(control(f,kind,textKey(kind)).value,'Committed 中文');
 }
});

test('null end, exact numeric spelling and untouched display normalization are not drafts',async()=>{
 for(const kind of ['title','credit','card']) {
  const seed=String.raw`state.design.title.lines[0]='A\r\nB';state.design.credit.text='C\rD';state.overlays[0].text='\nE\r\nF';state.design.title.x=.501234;state.design.credit.color='#11223344';`;
  const f=await fixture('ko',seed);open(f,kind);const before=state(f).state;
  control(f,kind).value='0.000e0';
  assert.equal((await edit(f)).ok,true);const after=state(f).state;after.effects.brightness=before.effects.brightness;assert.deepEqual(after,before);
 }
});

test('card textarea leading newlines survive clean checks, append edits and Undo/Redo',async()=>{
 for(const field of ['text','detail']) {
  const authored='\n\n한글\r\n& </textarea> \"',displayed=authored.replace(/\r\n?/g,'\n');
  const f=await fixture('ko',`state.overlays[0].${field}=${JSON.stringify(authored)}`);open(f,'card');
  assert.equal(control(f,'card',field).value,displayed);
  const before=state(f).state;
  assert.equal((await edit(f)).ok,true);
  assert.equal(f.evaluate(`state.overlays[0].${field}`),authored);
  const input=control(f,'card',field);input.value+='!';input.oninput();
  assert.equal(f.evaluate(`state.overlays[0].${field}`),displayed+'!');
  const accepted=state(f).state;
  vm.runInContext('undo()',f.context);assert.deepEqual(state(f).state.overlays,before.overlays);
  vm.runInContext('undo(true)',f.context);assert.deepEqual(state(f).state,accepted);
 }
});

test('bad input cannot masquerade as the unchanged nullable blank end',async()=>{
 for(const kind of ['title','credit']) {
  const f=await fixture();open(f,kind);const end=control(f,kind,'end');assert.equal(end.value,'');
  end.validity.badInput=true;assert.equal((await edit(f)).error?.code,'CONFLICT');
  end.validity.badInput=false;assert.equal((await edit(f)).ok,true);
 }
});

test('invalid numeric commit keeps its draft; restored values and committed nullable end permit retry',async()=>{
 for(const kind of ['title','credit','card']) {
  const f=await fixture();open(f,kind);const input=control(f,kind),initial=input.value;
  input.value='-1';input.onchange();const before=state(f);assert.equal((await edit(f)).error?.code,'CONFLICT');assert.deepEqual(state(f),before);
  input.value=initial;assert.equal((await edit(f)).ok,true);
 }
 for(const kind of ['title','credit']) {
  const f=await fixture('ko',`state.design.${kind}.end=8`);open(f,kind);const end=control(f,kind,'end');end.value='';
  assert.equal((await edit(f)).error?.code,'CONFLICT');end.onchange();assert.equal((await edit(f)).ok,true);assert.equal(f.evaluate(`state.design.${kind}.end`),null);
 }
});

test('read, preview and genuine no-op remain available; equal-value commits and whole batches reject',async()=>{
 const f=await fixture();open(f,'card');control(f,'card').value='1.25';const before=state(f);
 const operation={command:'effects.update',arguments:{patch:{brightness:1.1}}};
 for(const [name,args] of [['project.get',{}],['project.preview',{operations:[operation]}],['captions.text.replace',{find:'missing synthetic phrase',replacement:'unused'}]]) {
  assert.equal((await f.context.window.moment.execute(name,args)).ok,true);assert.deepEqual(state(f),before);
 }
 for(const [name,args] of [['effects.update',{patch:{brightness:1}}],['project.batch',{operations:[operation,{command:'project.update',arguments:{patch:{name:'Batch name'}}}]}]]) {
  assert.equal((await f.context.window.moment.execute(name,args)).error?.code,'CONFLICT');assert.deepEqual(state(f),before);
 }
});

test('commit-time checking sees newly entered drafts before the caller hook',async()=>{
 for(const kind of ['title','credit','card']) {
  const f=await fixture();open(f,kind);let hooks=0;
  const pending=f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},()=>hooks++);
  const input=control(f,kind),initial=input.value;input.value='1.25';
  assert.equal((await pending).error?.code,'CONFLICT');assert.equal(hooks,0);input.value=initial;
  assert.equal((await f.context.window.moment.execute('effects.update',{patch:{brightness:1.1}},()=>hooks++)).ok,true);assert.equal(hooks,1);
 }
});

test('explicit local navigation/import/Undo retains replacement semantics and old composition cannot block new controls',async()=>{
 for(const kind of ['title','credit','card']) {
  const f=await fixture();open(f,kind);const old=control(f,kind,textKey(kind));old.oncompositionstart();old.value='Discarded by explicit action';
  const document=f.evaluate('createProjectDocument(state)');assert.equal((await f.context.window.moment.importProject(new Blob([JSON.stringify(document)]))).ok,true);
  old.oncompositionstart();old.oncompositionend();assert.equal((await edit(f)).ok,true);
  control(f,kind).value='1.25';vm.runInContext('undo()',f.context);assert.equal((await edit(f)).ok,true);
  control(f,kind).value='1.5';f.open('media');assert.equal((await edit(f)).ok,true);
 }
});

test('Dialogue text inputs share the existing design owner, while committed typing stays allowed',async()=>{
 for(const path of ['globalKeywords','speakerLabels.0']) {
  const f=await fixture();f.open('text','caption');const input=f.query(`[data-design="${path}"]`);
  input.oncompositionstart();assert.equal((await edit(f)).error?.code,'CONFLICT');
  input.value='New label';input.oncompositionend();assert.equal((await edit(f)).ok,true);
 }
});


test('explicit card duplicate/reorder/remove does not transfer old pending ownership',async()=>{
 for(const action of ['duplicateSceneCard','sceneToFront','removeSceneCard']) {
  const f=await fixture('ko','state.overlays.push(newCard(12));');open(f,'card');const old=control(f,'card');old.value='1.25';
  assert.equal((await edit(f)).error?.code,'CONFLICT');f.query('#'+action).onclick();
  assert.notEqual(control(f,'card'),old);old.oncompositionstart();old.oncompositionend();assert.equal((await edit(f)).ok,true);
 }
});
