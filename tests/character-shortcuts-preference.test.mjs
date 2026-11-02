import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {bindEditorKeyboard} from '../dist/editor-interactions.mjs';
import {createAppFixture} from './fixtures/app.mjs';
import {setLocale,initLocale,localize,translateFor} from '../dist/i18n.mjs';

import {createProjectDocument} from '../dist/core/project.mjs';

// Actual app events and explicit marked DOM leaves; no native browser/AT or IME QA.
const characters=[',','.','[',']'];
function keyboard(optional=false){let handler,enabled=true,busy=false;const calls=[];
 const ports={blocked:()=>busy,stepBlocked:()=>false,stepOutput:delta=>calls.push(['step',delta]),navigateCut:delta=>{calls.push(['cut',delta]);return true;},togglePlayback:()=>calls.push('play'),undo:redo=>calls.push(redo?'redo':'undo'),save:()=>calls.push('save'),seekBy:delta=>calls.push(['seek',delta])};
 if(!optional)ports.characterShortcutsEnabled=()=>enabled;
 bindEditorKeyboard({addEventListener:(_,callback)=>handler=callback},ports);
 return {calls,set:value=>enabled=value,block:value=>busy=value,press:(key,extra={})=>handler({key,code:key===' '?'Space':'',target:{tagName:'BODY'},preventDefault:()=>calls.push('prevent'),...extra})};
}
async function fixture(){const f=await createAppFixture(),writes=[];f.context.localStorage.setItem=(...args)=>writes.push(args);
 vm.runInContext("state.clips=[{start:0,end:4},{start:4,end:8},{start:8,end:12}];history=[];future=[];current=5;globalThis.shortcutSaves=0;scheduleSave=()=>shortcutSaves++;globalThis.shortcutPauses=0;globalThis.originalPause= pause;pause=()=>{shortcutPauses++;originalPause();};",f.context);
 f.open=()=>f.element('#helpButton').onclick();f.toggle=value=>{const node=f.element('#characterShortcuts');node.checked=value;assert.equal(typeof node.onchange,'function');node.onchange({});};
 f.press=(key,extra={})=>{let prevented=0;f.documentEvents.get('keydown')({key,code:key===' '?'Space':'',target:{tagName:'BODY'},preventDefault:()=>prevented++,...extra});return prevented;};f.writes=writes;return f;
}
const read=f=>f.evaluate('({state,history,future,shortcutSaves})');
test('controller optional port preserves default four keys and live false suppresses actions and defaults',()=>{
 for(const optional of [true,false]){const f=keyboard(optional);for(const key of characters){f.calls.length=0;f.press(key);assert.equal(f.calls.length,2);assert.ok(f.calls.includes('prevent'));}
  if(!optional){f.set(false);for(const key of characters){f.calls.length=0;f.press(key);assert.deepEqual(f.calls,[]);}f.set(true);f.press('.');assert.deepEqual(f.calls,['prevent',['step',1]]);}
 }
});
test('disabled character preference leaves Save Undo Redo arrows and Space available',()=>{
 const f=keyboard();f.set(false);f.press('s',{ctrlKey:true});f.press('z',{ctrlKey:true});f.press('z',{ctrlKey:true,shiftKey:true});f.press('ArrowLeft');f.press('ArrowRight');f.press(' ');
 assert.deepEqual(f.calls,['prevent','save','prevent','undo','prevent','redo',['seek',-1],['seek',1],'prevent','play']);
});
test('enabled character keys still respect IME native editing modifiers and busy guards',()=>{
 const f=keyboard();for(const key of characters)for(const extra of [{isComposing:true},{keyCode:229},{defaultPrevented:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},...['INPUT','TEXTAREA','SELECT','SUMMARY'].map(tagName=>({target:{tagName}})),{target:{tagName:'DIV',isContentEditable:true}}])f.press(key,extra);
 f.block(true);for(const key of characters)f.press(key);assert.deepEqual(f.calls,[]);
});
test('actual Help preference immediately disables four keys without pause seek or default cancellation, then re-enables',async()=>{
 const f=await fixture();for(const key of characters){vm.runInContext('current=5',f.context);assert.equal(f.press(key),1);assert.notEqual(f.evaluate('current'),5);}
 f.open();f.toggle(false);f.element('#modal').close();const before=read(f);vm.runInContext('current=5;playing=true;shortcutPauses=0',f.context);
 for(const key of characters)assert.equal(f.press(key),0);assert.equal(f.evaluate('current'),5);assert.equal(f.evaluate('playing'),true);assert.equal(f.evaluate('shortcutPauses'),0);assert.deepEqual(read(f),before);
 f.open();assert.equal(f.element('#characterShortcuts').checked,false);f.toggle(true);f.element('#modal').close();for(const key of characters){vm.runInContext('current=5',f.context);assert.equal(f.press(key),1);assert.notEqual(f.evaluate('current'),5);}
 assert.deepEqual(f.writes,[]);
});
test('preference is session-only and leaves committed state history storage and unrelated drafts untouched',async()=>{
 const f=await fixture(),draft=f.element('#projectName');draft.value='Uncommitted name';const before=read(f);f.open();f.toggle(false);assert.deepEqual(read(f),before);assert.equal(draft.value,'Uncommitted name');assert.deepEqual(f.writes,[]);
 f.element('#modal').close();f.open();assert.equal(f.element('#characterShortcuts').checked,false);
 const fresh=await fixture();fresh.open();assert.equal(fresh.element('#characterShortcuts').checked,true);assert.deepEqual(f.writes,[]);
});
test('closed replaced reopened and composing Help callbacks cannot change the preference',async()=>{
 for(const scenario of ['closed','replaced','reopened','node','ime','229']){
  const f=await fixture();f.open();const node=f.element('#characterShortcuts'),callback=node.onchange;assert.equal(typeof callback,'function');node.checked=false;
  if(scenario==='closed')f.element('#modal').close();
  if(scenario==='replaced')vm.runInContext("modalOpen('Other','Other')",f.context);
  if(scenario==='reopened'){f.open();node.checked=false;}
  if(scenario==='node'){const query=f.doc.querySelector;f.doc.querySelector=s=>s==='#characterShortcuts'?f.element('replacement-checkbox'):query(s);}
  callback(scenario==='ime'?{isComposing:true}:scenario==='229'?{keyCode:229}:{});
  assert.equal(f.evaluate('characterShortcutsEnabled'),true,scenario);
 }
});
for(const locale of ['ko','en','zh-CN'])test(`Help native checkbox has its translated wrapping label and description: ${locale}`,async()=>{
 try {
 const f=await fixture();setLocale(locale,{persist:false});f.open();const html=f.element('#modal').innerHTML;
 const label=/<label><input\b[^>]*id="characterShortcuts"[^>]*>([\s\S]*?)<\/label>/.exec(html);assert.ok(label);assert.match(label[0],/type="checkbox"/);assert.match(label[0],/aria-describedby="characterShortcutsDescription"/);assert.ok(label[1].includes(translateFor(locale,'shell.characterShortcuts')));assert.ok(html.includes(translateFor(locale,'shell.characterShortcutsDescription')));assert.equal(f.element('#characterShortcuts').checked,true);
 } finally { initLocale(); }
});
test('live localization preserves checked value focused checkbox and callback while translating actual markers',async()=>{
 try {
 const f=await fixture();f.open();f.toggle(false);const checkbox=f.element('#characterShortcuts');checkbox.focus();const callback=checkbox.onchange,before=read(f),html=f.element('#modal').innerHTML;
 const nodes=[];for(const key of ['shell.characterShortcuts','shell.characterShortcutsDescription']){assert.ok(html.includes(`data-i18n="${key}"`));const n=f.element('marked-'+key);n.tagName='SPAN';n.children=[];n.setAttribute('data-i18n',key);n.setAttribute('data-i18n-params','{}');nodes.push(n);}
 for(const locale of ['en','zh-CN','ko']){setLocale(locale,{persist:false});localize({querySelectorAll:()=>nodes});assert.equal(checkbox.checked,false);assert.equal(f.doc.activeElement,checkbox);assert.equal(checkbox.onchange,callback);for(const node of nodes)assert.equal(node.textContent,translateFor(locale,node.getAttribute('data-i18n')));assert.deepEqual(read(f),before);assert.deepEqual(f.writes,[]);}
 } finally { initLocale(); }
});
test('actual cut buttons and arrow navigation remain usable when printable navigation is disabled',async()=>{
 const f=await fixture();f.open();f.toggle(false);f.element('#modal').close();const before=read(f);
 f.element('#previousCutButton').onclick();assert.equal(f.evaluate('current'),4);f.element('#nextCutButton').onclick();assert.equal(f.evaluate('current'),8);
 f.press('ArrowLeft');assert.equal(f.evaluate('current'),7);f.press('ArrowRight');assert.equal(f.evaluate('current'),8);assert.deepEqual(read(f),before);assert.deepEqual(f.writes,[]);
});

test('actual project import retains session preference and project documents exclude it',async()=>{
 const f=await fixture();f.open();f.toggle(false);f.element('#modal').close();
 const document=createProjectDocument(f.evaluate('state'));document.project.name='Imported project';
 assert.equal(Object.hasOwn(document.project,'characterShortcutsEnabled'),false);
 const result=await f.context.window.moment.execute('project.import',{document});assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(f.evaluate('state.name'),'Imported project');
 f.open();assert.equal(f.element('#characterShortcuts').checked,false);f.element('#modal').close();
 const exported=await f.context.window.moment.execute('project.get',{});assert.equal(exported.ok,true);
 assert.equal(Object.hasOwn(exported.data.project,'characterShortcutsEnabled'),false);assert.deepEqual(exported.data,document);
 // Import legitimately publishes a project/history/save request; unlike toggling,
 // it is intentionally not asserted to be an editing no-op.
});
