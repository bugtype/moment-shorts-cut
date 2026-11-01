import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale, initLocale, localize, t} from '../dist/i18n.mjs';

// Synthetic DOM ownership model, not browser layout, inertness or screen-reader QA.
// Unlike the base fixture, a feedback query succeeds only when current modal
// markup declares the descendant, and each replacement creates a fresh node.
async function fixture() {
 const f=await createAppFixture(), modal=f.element('#modal');
 let html=modal.innerHTML, local=null;
 const query=f.doc.querySelector, nested=modal.querySelector, queryAll=f.doc.querySelectorAll;
 f.doc.querySelectorAll=selector=>{
  const nodes=queryAll(selector);
  return selector.includes('[data-i18n]') && local?.getAttribute('data-i18n') ? [...nodes,local] : nodes;
 };
 const visible=new Set();
 f.element('#toast').classList={add:name=>visible.add(name),remove:name=>visible.delete(name),contains:name=>visible.has(name)};
 f.doc.querySelector=selector=>selector==='#modalFeedback'?local:query(selector);
 modal.querySelector=selector=>selector==='#modalFeedback'?local:nested(selector);
 Object.defineProperty(modal,'innerHTML',{get:()=>html,set(value){
  html=value;local=null;
  const tag=value.match(/<[^>]*\bid="modalFeedback"[^>]*>/);
  if(tag){const attrs=new Map([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,v]));
   local={textContent:'',hidden:/\bhidden(?:\s|>)/.test(tag[0]),
    getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,String(v)),removeAttribute:k=>attrs.delete(k),
    classList:{add(){},remove(){},toggle(){}}};}
 }});
 f.feedback=()=>local;
 f.timers=[];f.context.setTimeout=(callback,delay)=>{f.timers.push({callback,delay});return f.timers.length;};f.context.clearTimeout=()=>{};
 f.run=code=>vm.runInContext(code,f.context);
 f.run("switchPanel('captions');history=[];future=['keep'];globalThis.feedbackSaves=0;scheduleSave=()=>feedbackSaves++");
 f.snapshot=()=>f.evaluate('({state,history,future,feedbackSaves})');
 f.open=()=>f.element('#importSrt').onclick({});
 f.file=file=>{f.element('#subtitleImportFile').files=[file];f.element('#subtitleImportFile').onchange();};
 f.confirm=()=>f.element('#confirmSubtitleImport').onclick({});
 return f;
}
const valid=()=>new Blob(['1\n00:00:00,000 --> 00:00:01,000\nfixed']);

test('modal feedback is primed, localized, exclusive and focus/write neutral; outside toast remains global',async()=>{
 const f=await fixture(),before=f.snapshot();
 f.run("toast('outside')");assert.equal(f.element('#toast').textContent,'outside');
 f.open();const node=f.feedback();assert.ok(node);
 assert.equal(node.textContent,'');assert.equal(node.getAttribute('role'),'status');
 assert.equal(node.getAttribute('aria-live'),'polite');assert.equal(node.getAttribute('aria-atomic'),'true');
 assert.equal(node.hidden,false);assert.notEqual(node.getAttribute('aria-hidden'),'true');
 const focus=f.doc.activeElement;
 try{for(const locale of ['ko','en','zh-CN']){
  setLocale(locale,{persist:false});f.file(new Blob([new Uint8Array([255])]));await f.confirm();
  assert.match(node.textContent,/UTF-8/);assert.equal(f.element('#toast').textContent,'');
  assert.equal(f.element('#toast').getAttribute('data-i18n'),null);
  assert.equal(f.doc.activeElement,focus);assert.deepEqual(f.snapshot(),before);
 }}finally{initLocale();}
 f.element('#cancelSubtitleImport').onclick();f.run("toast('closed')");assert.equal(f.element('#toast').textContent,'closed');
});

test('four import failure classes stay local and allow read-only review followed by explicit successful retry',async()=>{
 for(const file of [new Blob([new Uint8Array([255])]),new Blob(['invalid']),
  {size:1,arrayBuffer:async()=>{throw new Error('synthetic read rejection');}},
  {size:2097153,arrayBuffer:async()=>{throw new Error('oversize must not read');}}]){
  const f=await fixture();f.open();f.file(file);const before=f.snapshot();await f.confirm();
  assert.ok(f.feedback()?.textContent);assert.equal(f.element('#toast').textContent,'');
  assert.equal(f.element('#modal').open,true);assert.equal(f.element('#subtitleImportReport').innerHTML,'');
  assert.equal(f.element('#confirmSubtitleImport').disabled,false);assert.deepEqual(f.snapshot(),before);
  f.file(valid());await f.confirm();assert.ok(f.element('#subtitleImportReport').innerHTML);assert.deepEqual(f.snapshot(),before);
  await f.confirm();assert.equal(f.element('#modal').open,false);assert.equal(f.evaluate('state.captions[0].text'),'fixed');
  assert.ok(f.element('#toast').textContent);
 }
});

test('captured timers cannot clear newer messages or new modal descendants',async()=>{
 const f=await fixture();f.open();f.run("toast('first')");const oldNode=f.feedback(),old=f.timers.at(-1);
 assert.equal(old.delay,5000);f.run("toast('second')");old.callback();assert.equal(oldNode.textContent,'second');
 f.run("modalOpen('new','new body');toast('new message')");const newNode=f.feedback();assert.notEqual(newNode,oldNode);
 for(const timer of f.timers.slice(0,-1))timer.callback();assert.equal(newNode.textContent,'new message');
 f.timers.at(-1).callback();assert.equal(newNode.textContent,'');assert.equal(newNode.getAttribute('data-i18n'),null);
 assert.notEqual(newNode.getAttribute('aria-hidden'),'true');
});

test('cancel, new file and replacement modal suppress stale file-read failures',async()=>{
 for(const action of ['cancel','file','replace']){
  const f=await fixture();f.open();let reject;f.file({size:1,arrayBuffer:()=>new Promise((_,no)=>reject=no)});
  const before=f.snapshot(),pending=f.confirm();
  if(action==='cancel')f.element('#cancelSubtitleImport').onclick();
  if(action==='file')f.file(valid());
  if(action==='replace')f.run("modalOpen('replacement','body');toast('new owner')");
  const node=f.feedback(),text=node?.textContent,global=f.element('#toast').textContent;
  reject(new Error('stale rejection'));await pending;
  assert.equal(node?.textContent,text);assert.equal(f.element('#toast').textContent,global);assert.deepEqual(f.snapshot(),before);
 }
});

test('an open dialog without the feedback descendant safely falls back to global toast',async()=>{
 const f=await fixture();f.element('#modal').innerHTML='<p>legacy modal</p>';f.element('#modal').open=true;
 f.run("toast('fallback')");assert.equal(f.feedback(),null);assert.equal(f.element('#toast').textContent,'fallback');
});


test('visible localized feedback updates in place, then expiration removes both markers permanently',async()=>{
 const f=await fixture();f.open();const before=f.snapshot(),focus=f.doc.activeElement,node=f.feedback();
 try {
  setLocale('ko',{persist:false});
  f.run("toast(message('errors.captionsGenerated',{count:7}))");
  const korean=node.textContent,expiry=f.timers.at(-1);
  assert.equal(node.getAttribute('data-i18n'),'errors.captionsGenerated');
  assert.deepEqual(JSON.parse(node.getAttribute('data-i18n-params')),{count:7});
  assert.equal(expiry.delay,5000);
  for(const locale of ['en','zh-CN']){
   setLocale(locale,{persist:false});localize(f.doc);
   assert.equal(node.textContent,t('errors.captionsGenerated',{count:7}));
   assert.notEqual(node.textContent,korean);assert.equal(f.feedback(),node);
  }
  expiry.callback();assert.equal(node.textContent,'');
  assert.equal(node.getAttribute('data-i18n'),null);assert.equal(node.getAttribute('data-i18n-params'),null);
  setLocale('ko',{persist:false});localize(f.doc);assert.equal(node.textContent,'');
  assert.equal(f.doc.activeElement,focus);assert.deepEqual(f.snapshot(),before);
 }finally{initLocale();}
});

test('old global and local timer callbacks cannot hide or clear the other current route',async()=>{
 const f=await fixture(),global=f.element('#toast');
 f.run("toast('global before modal')");const oldGlobal=f.timers.at(-1);
 assert.equal(global.classList.contains('visible'),true);
 f.open();f.run("toast(message('errors.captionsGenerated',{count:3}))");
 const local=f.feedback(),localText=local.textContent,oldLocal=f.timers.at(-1);
 assert.equal(global.classList.contains('visible'),false);assert.equal(global.textContent,'');
 oldGlobal.callback();assert.equal(local.textContent,localText);
 assert.equal(local.getAttribute('data-i18n'),'errors.captionsGenerated');
 f.element('#cancelSubtitleImport').onclick();f.run("toast('new global')");
 oldLocal.callback();assert.equal(global.textContent,'new global');assert.equal(global.classList.contains('visible'),true);
 f.timers.at(-1).callback();assert.equal(global.classList.contains('visible'),false);
});
